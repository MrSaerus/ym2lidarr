// apps/api/src/workers.ts
import { startRun, endRun, patchRunStats, log as dblog } from './log';
import { notify } from './notify';
import { prisma } from './prisma';
import {
  ensureArtistInLidarr,
  ensureAlbumInLidarr,
  // + (для Lidarr Pull ниже понадобится сервис получения артистов из Лидара)
  // listLidarrArtists,
} from './services/lidarr';
import { mbFindArtist, mbFindReleaseGroup } from './services/mb';
import { yandexPullLikes, setPyproxyUrl, getDriver } from './services/yandex';
import { upsertYandexArtistCache, upsertYandexAlbumCache } from './services/yandex-cache';

function nkey(s: string) { return s.trim().toLowerCase(); }
const RECHECK_HOURS = parseInt(process.env.MB_RECHECK_HOURS || '168', 10);
function shouldRecheck(last?: Date | null, force = false) {
  if (force) return true;
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) >= RECHECK_HOURS * 3600_000;
}
async function getRunWithRetry(id: number, tries = 3, ms = 200) {
  for (let i = 0; i < tries; i++) { try { const r = await prisma.syncRun.findUnique({ where: { id } }); if (r) return r; } catch {} await new Promise(r => setTimeout(r, ms)); }
  return prisma.syncRun.findUnique({ where: { id } });
}

/** ===== 1) Yandex Pull (без MB) ===== */
export async function runYandexPull(tokenOverride?: string, reuseRunId?: number) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
  const driver = getDriver(setting?.yandexDriver);

  const token = tokenOverride || setting?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN;
  if (!token) {
    await prisma.syncRun.create({ data: { kind: 'yandex', status: 'error', message: 'No Yandex token (db/env)' } });
    return;
  }

  const run = reuseRunId
      ? { id: reuseRunId }
      : await startRun('yandex', { phase: 'pull', a_total: 0, a_done: 0, al_total: 0, al_done: 0 });

  if (!run) return;
  const runId = run.id;

  try {
    await dblog(runId, 'info', 'Pulling likes from Yandex…', { driver });
    const { artists, albums } = await yandexPullLikes(token, { driver });

    await patchRunStats(runId, { a_total: artists.length, al_total: albums.length });
    await dblog(runId, 'info', `Got ${artists.length} artists, ${albums.length} albums`);

    let a_done = 0;
    for (const aRaw of artists as Array<string | { id?: number|string; name?: string; mbid?: string }>) {
      const name = typeof aRaw === 'string' ? aRaw : (aRaw?.name ?? '');
      const yaArtistId = typeof aRaw === 'object' && aRaw?.id != null ? Number(aRaw.id) : undefined;
      const key = nkey(name);

      // пишем в кеш (при наличии реального YA id)
      if (yaArtistId) {
        await upsertYandexArtistCache({ yandexArtistId: yaArtistId, name, mbid: (aRaw as any)?.mbid ?? undefined });
      }

      // заполняем нашу таблицу Artist (без MB матчинга)
      await prisma.artist.upsert({
        where: { key },
        create: { key, name },
        update: { name },
      });

      a_done++;
      if (a_done % 10 === 0) await patchRunStats(runId, { a_done });
    }
    await patchRunStats(runId, { a_done });

    let al_done = 0;
    for (const alRaw of albums as Array<{ id?: number|string; yandexAlbumId?: number|string; title?: string; artist?: string; artistName?: string; year?: number }>) {
      const yaAlbumId = (alRaw?.yandexAlbumId ?? alRaw?.id) != null ? Number(alRaw.yandexAlbumId ?? alRaw.id) : undefined;
      const title = String(alRaw?.title ?? '');
      const artistName = String(alRaw?.artistName ?? alRaw?.artist ?? '');
      const year = typeof alRaw?.year === 'number' ? alRaw.year : undefined;

      if (yaAlbumId) {
        await upsertYandexAlbumCache({ yandexAlbumId: yaAlbumId, title, artistName, year });
      }

      const key = nkey(`${artistName}|||${title}`);
      await prisma.album.upsert({
        where: { key },
        create: { key, artist: artistName, title, year: year ?? null },
        update: { artist: artistName, title, year: year ?? null },
      });

      al_done++;
      if (al_done % 10 === 0) await patchRunStats(runId, { al_done });
    }
    await patchRunStats(runId, { al_done, phase: 'done' });

    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Yandex Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'error', stats); } catch {}
  }
}

/** ===== 2) Lidarr Pull (инвентаризация) ===== */
export async function runLidarrPull(reuseRunId?: number) {
  // NOTE: тут нужен вызов сервиса получения артистов из Lidarr (API).
  // Если у тебя уже есть утилита — подключи её; если нет — добавим в services/lidarr.ts.
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = reuseRunId
      ? { id: reuseRunId }
      : await startRun('lidarr', { phase: 'pull', total: 0, done: 0 });

  if (!run) return;
  const runId = run.id;

  try {
    // const list = await listLidarrArtists(setting as any); // ← внедри сюда свою функцию
    const list: any[] = []; // временно, чтобы файл собрался — подставь реальный вызов

    await patchRunStats(runId, { total: list.length });

    let done = 0;
    for (const it of list) {
      // ожидаемые поля: id, mbid, artistName, monitored, path, added, albums, tracks, sizeOnDisk
      await prisma.lidarrArtist.upsert({
        where: { id: Number(it.id) },
        create: {
          id: Number(it.id),
          name: String(it.artistName || it.name || ''),
          mbid: it.foreignArtistId || it.mbid || null,
          monitored: !!it.monitored,
          path: it.path || null,
          added: it.added ? new Date(it.added) : null,
          albums: Number.isFinite(Number(it.albums)) ? Number(it.albums) : null,
          tracks: Number.isFinite(Number(it.tracks)) ? Number(it.tracks) : null,
          sizeOnDisk: Number.isFinite(Number(it.sizeOnDisk)) ? Number(it.sizeOnDisk) : null,
          removed: false,
          lastSyncAt: new Date(),
        },
        update: {
          name: String(it.artistName || it.name || ''),
          mbid: it.foreignArtistId || it.mbid || null,
          monitored: !!it.monitored,
          path: it.path || null,
          added: it.added ? new Date(it.added) : null,
          albums: Number.isFinite(Number(it.albums)) ? Number(it.albums) : null,
          tracks: Number.isFinite(Number(it.tracks)) ? Number(it.tracks) : null,
          sizeOnDisk: Number.isFinite(Number(it.sizeOnDisk)) ? Number(it.sizeOnDisk) : null,
          lastSyncAt: new Date(),
        },
      });

      done++;
      if (done % 20 === 0) await patchRunStats(runId, { done });
    }
    await patchRunStats(runId, { done, phase: 'done' });

    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
  }
}

/** ===== 3) Match (MB) — только сопоставление ===== */
export async function runMbMatch(reuseRunId?: number, opts?: { force?: boolean; target?: 'artists'|'albums'|'both' }) {
  const force = !!opts?.force;
  const target = opts?.target || 'both';

  const run = reuseRunId
      ? { id: reuseRunId }
      : await startRun('match', { phase: 'match', a_total: 0, a_done: 0, a_matched: 0, al_total: 0, al_done: 0, al_matched: 0 });

  if (!run) return;
  const runId = run.id;

  try {
    // ARTISTS
    if (target === 'artists' || target === 'both') {
      const artists = await prisma.artist.findMany({ orderBy: { id: 'asc' } });
      await patchRunStats(runId, { a_total: artists.length });

      let a_done = 0, a_matched = 0, a_skipped = 0;
      for (const a of artists) {
        if (a.mbid) { a_done++; a_matched++; if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched }); continue; }

        if (!shouldRecheck(a.mbCheckedAt, force)) { a_done++; a_skipped++; if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_skipped }); continue; }

        const r = await mbFindArtist(a.name);
        await prisma.cacheEntry.upsert({
          where: { key: `artist:${a.key}` },
          create: { scope: 'artist', key: `artist:${a.key}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });
        await prisma.artistCandidate.deleteMany({ where: { artistId: a.id } });
        if (Array.isArray(r.candidates) && r.candidates.length) {
          await prisma.artistCandidate.createMany({
            data: r.candidates.map((c: any) => ({
              artistId: a.id, mbid: c.id, name: c.name || '', score: c.score ?? null, type: c.type || null,
              country: c.country || null, url: c.url || null, highlight: !!c.highlight,
            })),
          });
        }
        if (r.mbid) {
          await prisma.artist.update({ where: { id: a.id }, data: { mbid: r.mbid, matched: true, mbCheckedAt: new Date(), mbAttempts: { increment: 1 } } });
          a_matched++;
          await dblog(runId, 'info', 'Artist matched', { name: a.name, mbid: r.mbid });
        } else {
          await prisma.artist.update({ where: { id: a.id }, data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } } });
          await dblog(runId, 'info', 'Artist not matched', { name: a.name });
        }
        a_done++;
        if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched, a_skipped });
      }
      await patchRunStats(runId, { a_done, a_matched, a_skipped });
    }

    // ALBUMS
    if (target === 'albums' || target === 'both') {
      const albums = await prisma.album.findMany({ orderBy: { id: 'asc' } });
      await patchRunStats(runId, { al_total: albums.length });

      let al_done = 0, al_matched = 0, al_skipped = 0;
      for (const rec of albums) {
        if (rec.rgMbid) { al_done++; al_matched++; if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched }); continue; }

        if (!shouldRecheck(rec.mbCheckedAt, force)) { al_done++; al_skipped++; if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_skipped }); continue; }

        const r = await mbFindReleaseGroup(rec.artist, rec.title);
        await prisma.cacheEntry.upsert({
          where: { key: `album:${nkey(`${rec.artist}|||${rec.title}`)}` },
          create: { scope: 'album', key: `album:${nkey(`${rec.artist}|||${rec.title}`)}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });
        await prisma.albumCandidate.deleteMany({ where: { albumId: rec.id } });
        if (Array.isArray(r.candidates) && r.candidates.length) {
          await prisma.albumCandidate.createMany({
            data: r.candidates.map((c: any) => ({
              albumId: rec.id, rgMbid: c.id, title: c.title || '', primaryType: c.primaryType || null,
              firstReleaseDate: c.firstReleaseDate || null, primaryArtist: c.primaryArtist || null,
              score: c.score ?? null, url: c.url || null, highlight: !!c.highlight,
            })),
          });
        }
        if (r.mbid) {
          await prisma.album.update({ where: { id: rec.id }, data: { rgMbid: r.mbid, matched: true, mbCheckedAt: new Date(), mbAttempts: { increment: 1 } } });
          al_matched++;
          await dblog(runId, 'info', 'Album matched', { artist: rec.artist, title: rec.title, mbid: r.mbid });
        } else {
          await prisma.album.update({ where: { id: rec.id }, data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } } });
          await dblog(runId, 'info', 'Album not matched', { artist: rec.artist, title: rec.title });
        }
        al_done++;
        if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched, al_skipped });
      }
      await patchRunStats(runId, { al_done, al_matched, al_skipped });
    }

    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'MB Match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'error', stats); } catch {}
  }
}

/** ===== 4) Push to Lidarr — без изменений ===== */
export async function runLidarrPush() {
  // … твой существующий код без изменений …
}
