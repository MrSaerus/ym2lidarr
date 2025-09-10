// apps/api/src/workers.ts
import { startRun, endRun, patchRunStats, log as dblog } from './log';
import { notify } from './notify';
import { prisma } from './prisma';
import {
  pushArtistWithConfirm,
  pushAlbumWithConfirm,
} from './services/lidarr';

import { mbFindArtist, mbFindReleaseGroup } from './services/mb';
import { yandexPullLikes, setPyproxyUrl } from './services/yandex';
import { request } from 'undici';

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/* ========================= structured logging helpers =========================
 * Единый шаблон события + метрики времени. Не заменяет существующие точечные логи,
 * а добавляет «скелет» start/finish/error для каждой крупной операции.
 * ---------------------------------------------------------------------------- */
type Lvl = 'info'|'warn'|'error'|'debug';
async function ev(runId: number, level: Lvl, event: string, data?: any) {
  await dblog(runId, level, event, { event, ...(data ?? {}) });
}
function now() { return Date.now(); }
function elapsedMs(t0: number) { return Date.now() - t0; }

// Шорткаты
const evStart  = (runId: number, meta?: any) => ev(runId, 'info',  'start',  meta);
const evFinish = (runId: number, meta?: any) => ev(runId, 'info',  'finish', meta);
const evError  = (runId: number, meta?: any) => ev(runId, 'error', 'error',  meta);
/* ============================================================================ */

async function getRunWithRetry(id: number, tries = 3, ms = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await prisma.syncRun.findUnique({ where: { id } });
      if (r) return r;
    } catch {}
    await new Promise(r => setTimeout(r, ms));
  }
  return prisma.syncRun.findUnique({ where: { id } });
}

/* ===== helper: soft-cancel ===== */
function parseRunStats(stats?: string | null): any {
  try { return stats ? JSON.parse(stats) : {}; } catch { return {}; }
}
async function isCancelled(runId: number): Promise<boolean> {
  const r = await getRunWithRetry(runId);
  const s = parseRunStats(r?.stats);
  return !!s?.cancel;
}
async function bailIfCancelled(runId: number, phase?: string) {
  if (await isCancelled(runId)) {
    await dblog(runId, 'warn', 'Cancelled by user', phase ? { phase } : undefined);
    await patchRunStats(runId, { phase: 'cancelled' });
    await endRun(runId, 'error', 'Cancelled by user');
    return true;
  }
  return false;
}

async function startRunWithKind(kind: string, initialStats: any, reuseRunId?: number) {
  if (reuseRunId) return { id: reuseRunId };
  return startRun(kind, initialStats);
}

/** ===== 1) Yandex Pull (pyproxy) — без сброса present, с watermark и yGone ===== */
export async function runYandexPull(tokenOverride?: string, reuseRunId?: number) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');

  // ВАЖНО: больше НЕ сбрасываем present=false в начале
  const watermark = new Date();

  const token =
    tokenOverride ||
    setting?.yandexToken ||
    process.env.YANDEX_MUSIC_TOKEN ||
    process.env.YM_TOKEN;

  if (!token) {
    await prisma.syncRun.create({ data: { kind: 'yandex', status: 'error', message: 'No Yandex token (db/env)' } });
    return;
  }

  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('yandex', { phase: 'pull', a_total: 0, a_done: 0, al_total: 0, al_done: 0 });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'yandex.pull', driver: 'pyproxy' });
  try {
    await dblog(runId, 'info', 'Pulling likes from Yandex (pyproxy)…', { driver: 'pyproxy' });
    if (await bailIfCancelled(runId, 'pull-start')) return;

    const { artists, albums } = await yandexPullLikes(token);

    await patchRunStats(runId, { a_total: artists.length, al_total: albums.length });
    await dblog(runId, 'info', `Got ${artists.length} artists, ${albums.length} albums`);

    // YandexArtist
    let a_done = 0;
    for (const a of artists as Array<{ id?: number | string; name: string }>) {
      if (await bailIfCancelled(runId, 'pull-artists')) return;

      const name = String(a?.name || '').trim();
      if (!name) continue;
      const ymIdStr = String(a?.id ?? '').trim();
      if (/^\d+$/.test(ymIdStr)) {
        await prisma.yandexArtist.upsert({
          where: { ymId: ymIdStr },
          create: {
            ymId: ymIdStr,
            name,
            key: nkey(name),
            present: true,
            lastSeenAt: watermark,
            yGone: false,
            yGoneAt: null,
          },
          update: {
            name,
            key: nkey(name),
            present: true,
            lastSeenAt: watermark,
            yGone: false,
            yGoneAt: null,
          },
        });
      }
      a_done++;
      if (a_done % 50 === 0) await patchRunStats(runId, { a_done });
    }
    await patchRunStats(runId, { a_done });

    // YandexAlbum
    let al_done = 0;
    for (const alb of albums as Array<{ id?: number | string; title: string; artistName: string; year?: number; artistId?: number | string }>) {
      if (await bailIfCancelled(runId, 'pull-albums')) return;

      const title = String(alb?.title || '').trim();
      const artistName = String(alb?.artistName || '').trim();
      if (!title) continue;

      const ymAlbumIdStr = String(alb?.id ?? '').trim();
      const ymArtistIdStr = String(alb?.artistId ?? '').trim();
      const year = Number.isFinite(Number(alb?.year)) ? Number(alb!.year) : null;

      if (/^\d+$/.test(ymAlbumIdStr)) {
        await prisma.yandexAlbum.upsert({
          where: { ymId: ymAlbumIdStr },
          create: {
            ymId: ymAlbumIdStr,
            title,
            artist: artistName || null,
            year,
            key: nkey(`${artistName}|||${title}`),
            present: true,
            lastSeenAt: watermark,
            yGone: false,
            yGoneAt: null,
            yandexArtistId: /^\d+$/.test(ymArtistIdStr) ? ymArtistIdStr : null,
          },
          update: {
            title,
            artist: artistName || null,
            year,
            key: nkey(`${artistName}|||${title}`),
            present: true,
            lastSeenAt: watermark,
            yGone: false,
            yGoneAt: null,
            yandexArtistId: /^\d+$/.test(ymArtistIdStr) ? ymArtistIdStr : null,
          },
        });
      }

      al_done++;
      if (al_done % 50 === 0) await patchRunStats(runId, { al_done });
    }
    await patchRunStats(runId, { al_done });

    // Финализация — мягко пометить отсутствующих как "gone" (НЕ трогаем present)
    await prisma.$transaction([
      prisma.yandexArtist.updateMany({
        where: { OR: [{ lastSeenAt: { lt: watermark } }, { lastSeenAt: null }] },
        data: { yGone: true, yGoneAt: new Date() },
      }),
      prisma.yandexAlbum.updateMany({
        where: { OR: [{ lastSeenAt: { lt: watermark } }, { lastSeenAt: null }] },
        data: { yGone: true, yGoneAt: new Date() },
      }),
    ]);

    await patchRunStats(runId, { phase: 'done' });
    await evFinish(runId, {
      kind: 'yandex.pull',
      a_total: (await prisma.yandexArtist.count()),
      al_total: (await prisma.yandexAlbum.count()),
      elapsedMs: elapsedMs(t0),
    });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Yandex Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('yandex', 'error', stats); } catch {}
    await evError(runId, { kind: 'yandex.pull', error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

/* ------------------------ Lidarr: helpers ------------------------ */
async function lidarrApi<T = any>(base: string, key: string, path: string): Promise<T> {
  const url = `${base.replace(/\/+$/, '')}${path}`;
  const res = await request(url, { headers: { 'X-Api-Key': key } });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`Lidarr ${path} ${res.statusCode}: ${text?.slice(0, 180)}`);
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

/** ===== 2) Lidarr Pull (варианты: artists | albums | both) ===== */
export async function runLidarrPull(reuseRunId?: number) {
  return runLidarrPullEx('both', reuseRunId);
}

export async function runLidarrPullEx(target: 'artists'|'albums'|'both' = 'both', reuseRunId?: number) {
  const kind =
    target === 'artists' ? 'lidarr.pull.artists' :
      target === 'albums'  ? 'lidarr.pull.albums'  : 'lidarr.pull.all';

  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind, status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind(kind, { phase: 'pull', total: 0, done: 0, albumsTotal: 0, albumsDone: 0 }, reuseRunId);
  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind, target });
  try {
    const base = (setting.lidarrUrl || '').replace(/\/+$/, '');
    const apiKey = setting.lidarrApiKey!;
    await dblog(runId, 'info', 'Lidarr pull start', { target });

    // 1) Artists
    await dblog(runId, 'info', 'Lidarr pull: fetching artists');
    const artists: any[] = await lidarrApi(base, apiKey, '/api/v1/artist');
    await patchRunStats(runId, { total: artists.length });

    let done = 0;
    if (target !== 'albums') await dblog(runId, 'info', `Lidarr pull: upserting ${artists.length} artists`);
    for (const a of artists) {
      if (await bailIfCancelled(runId, 'lidarr-pull-artists')) return;

      await prisma.lidarrArtist.upsert({
        where: { id: Number(a.id) },
        create: {
          id: Number(a.id),
          name: String(a.artistName || a.name || ''),
          mbid: a.foreignArtistId || a.mbid || null,
          monitored: !!a.monitored,
          path: a.path || null,
          added: a.added ? new Date(a.added) : null,
          albums: a.statistics?.albumCount ?? null,
          tracks: a.statistics?.trackCount ?? null,
          sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
          removed: false,
          lastSyncAt: new Date(),
        },
        update: {
          name: String(a.artistName || a.name || ''),
          mbid: a.foreignArtistId || a.mbid || null,
          monitored: !!a.monitored,
          path: a.path || null,
          added: a.added ? new Date(a.added) : null,
          albums: a.statistics?.albumCount ?? null,
          tracks: a.statistics?.trackCount ?? null,
          sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
          removed: false,
          lastSyncAt: new Date(),
        },
      });

      done++;
      if (done % 25 === 0) await patchRunStats(runId, { done });
    }
    await patchRunStats(runId, { done });

    // 2) Albums
    if (target === 'albums' || target === 'both') {
      let alTotal = 0, alDone = 0;
      await dblog(runId, 'info', 'Lidarr pull: fetching albums per artist');
      for (const a of artists) {
        if (await bailIfCancelled(runId, 'lidarr-pull-albums')) return;

        const albums: any[] = await lidarrApi(base, apiKey, `/api/v1/album?artistId=${a.id}`);
        alTotal += albums.length;
        for (const alb of albums) {
          await prisma.lidarrAlbum.upsert({
            where: { id: Number(alb.id) },
            create: {
              id: Number(alb.id),
              title: String(alb.title || ''),
              artistId: Number(alb.artistId) || null,
              artistName: String(a.artistName || a.name || ''),
              mbid: alb.foreignAlbumId || alb.mbid || null,
              monitored: !!alb.monitored,
              added: alb.added ? new Date(alb.added) : null,
              path: alb.path || null,
              sizeOnDisk: alb.statistics?.sizeOnDisk ?? null,
              tracks: alb.statistics?.trackCount ?? null,
              removed: false,
              lastSyncAt: new Date(),
            },
            update: {
              title: String(alb.title || ''),
              artistId: Number(alb.artistId) || null,
              artistName: String(a.artistName || a.name || ''),
              mbid: alb.foreignAlbumId || alb.mbid || null,
              monitored: !!alb.monitored,
              added: alb.added ? new Date(alb.added) : null,
              path: alb.path || null,
              sizeOnDisk: alb.statistics?.sizeOnDisk ?? null,
              tracks: alb.statistics?.trackCount ?? null,
              removed: false,
              lastSyncAt: new Date(),
            },
          });
          alDone++;
          if (alDone % 50 === 0) await patchRunStats(runId, { albumsDone: alDone, albumsTotal: alTotal });
        }
      }
      await patchRunStats(runId, { albumsDone: alDone, albumsTotal: alTotal });
    }

    await patchRunStats(runId, { phase: 'done' });
    await evFinish(runId, {
      kind, target,
      totalArtists: (await prisma.lidarrArtist.count({ where: { removed: false } })),
      totalAlbums:  (await prisma.lidarrAlbum.count({ where: { removed: false } })),
      elapsedMs: elapsedMs(t0),
    });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
    await evError(runId, { kind, target, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

/** ===== 3) Match (MB) — с ретраями и пропуском уже сматченных ===== */
export async function runMbMatch(reuseRunId?: number, opts?: { force?: boolean; target?: 'artists'|'albums'|'both' }) {
  const force = !!(opts?.force);
  const target = opts?.target || 'both';
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const retryDays = Math.max(1, Number(setting?.matchRetryDays ?? 3));
  const retryBefore = new Date(Date.now() - retryDays * 24 * 60 * 60 * 1000);

  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('match', {
      phase: 'match',
      a_total: 0, a_done: 0, a_matched: 0,
      al_total: 0, al_done: 0, al_matched: 0,
    });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'mb.match', target, force });

  try {
    // ===== ARTISTS =====
    if (target === 'artists' || target === 'both') {
      const base = await prisma.yandexArtist.findMany({
        where: force ? { present: true } : { present: true, mbid: null },
        orderBy: { id: 'asc' },
        select: { id: true, ymId: true, name: true, mbid: true },
      });

      let candidates = base;
      if (!force) {
        const syncItems = await prisma.mbSyncItem.findMany({
          where: { kind: 'yandex-artist', targetId: { in: base.map(x => x.id) } },
          select: { targetId: true, lastCheckedAt: true },
        });
        const lastById = new Map(syncItems.map(s => [s.targetId, s.lastCheckedAt]));
        candidates = base.filter(x => {
          if (x.mbid) return false;
          const last = lastById.get(x.id);
          return !last || last < retryBefore;
        });
      }

      await patchRunStats(runId, { a_total: candidates.length });
      await dblog(runId, 'info', 'MB Match (artists) started', {
        target, force,
        totalArtists:  await prisma.yandexArtist.count({ where: { present: true } }),
        matchedArtists: await prisma.yandexArtist.count({ where: { present: true, mbid: { not: null } } }),
      });

      let a_done = 0, a_matched = 0;
      for (const y of candidates) {
        if (await bailIfCancelled(runId, 'match-artists')) return;

        try {
          const r = await mbFindArtist(y.name);
          await prisma.cacheEntry.upsert({
            where: { key: `ya:artist:${y.ymId}` },
            create: { scope: 'ya:artist', key: `ya:artist:${y.ymId}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          if (r.externalId) {
            await prisma.$transaction([
              prisma.yandexArtist.update({ where: { id: y.id }, data: { mbid: r.externalId } }),
              prisma.mbSyncItem.upsert({
                where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
                create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
                update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
              }),
            ]);
            a_matched++;
            await dblog(runId, 'info', `✔ Artist matched: ${y.name}`, { yaId: y.ymId, name: y.name, mbid: r.externalId });
          } else {
            await prisma.mbSyncItem.upsert({
              where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
              create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastError: 'not-found' },
              update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: 'not-found' },
            });
            await dblog(runId, 'info', `✖ Artist not matched: ${y.name}`, { yaId: y.ymId, name: y.name });
          }
        } catch (e: any) {
          await prisma.mbSyncItem.upsert({
            where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
            create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
            update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
          });
          await dblog(runId, 'warn', 'MB lookup failed', { id: y.id, name: y.name, error: String(e?.message || e) });
        }

        a_done++;
        if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched });
      }
      await patchRunStats(runId, { a_done, a_matched });
    }

    // ===== ALBUMS =====
    if (target === 'albums' || target === 'both') {
      const base = await prisma.yandexAlbum.findMany({
        where: force ? { present: true } : { present: true, rgMbid: null },
        orderBy: { id: 'asc' },
        select: { id: true, ymId: true, title: true, artist: true, rgMbid: true },
      });

      let candidates = base;
      if (!force) {
        const syncItems = await prisma.mbSyncItem.findMany({
          where: { kind: 'yandex-album', targetId: { in: base.map(x => x.id) } },
          select: { targetId: true, lastCheckedAt: true },
        });
        const lastById = new Map(syncItems.map(s => [s.targetId, s.lastCheckedAt]));
        candidates = base.filter(x => {
          if (x.rgMbid) return false;
          const last = lastById.get(x.id);
          return !last || last < retryBefore;
        });
      }

      await patchRunStats(runId, { al_total: candidates.length });
      await dblog(runId, 'info', 'MB Match (albums) started', {
        target, force,
        totalAlbums:  await prisma.yandexAlbum.count({ where: { present: true } }),
        matchedAlbums: await prisma.yandexAlbum.count({ where: { present: true, rgMbid: { not: null } } }),
      });

      let al_done = 0, al_matched = 0;
      for (const rec of candidates) {
        if (await bailIfCancelled(runId, 'match-albums')) return;

        try {
          const r = await mbFindReleaseGroup(rec.artist || '', rec.title);
          await prisma.cacheEntry.upsert({
            where: { key: `ya:album:${rec.ymId}` },
            create: { scope: 'ya:album', key: `ya:album:${rec.ymId}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          if (r.externalId) {
            await prisma.$transaction([
              prisma.yandexAlbum.update({ where: { id: rec.id }, data: { rgMbid: r.externalId } }),
              prisma.mbSyncItem.upsert({
                where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
                create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
                update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
              }),
            ]);
            al_matched++;
            await dblog(runId, 'info', `✔ Album matched: ${rec.artist} - ${rec.title}`, { yaId: rec.ymId, artist: rec.artist, title: rec.title, rgMbid: r.externalId });
          } else {
            await prisma.mbSyncItem.upsert({
              where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
              create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastError: 'not-found' },
              update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: 'not-found' },
            });
            await dblog(runId, 'info', `✖ Album not matched: ${rec.artist} - ${rec.title}`, { yaId: rec.ymId, artist: rec.artist, title: rec.title });
          }
        } catch (e: any) {
          await prisma.mbSyncItem.upsert({
            where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
            create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
            update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
          });
          await dblog(runId, 'warn', 'MB lookup failed', { id: rec.id, title: rec.title, error: String(e?.message || e) });
        }

        al_done++;
        if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched });
      }
      await patchRunStats(runId, { al_done, al_matched });
    }

    await patchRunStats(runId, { phase: 'done' });
    await evFinish(runId, { kind: 'mb.match', target, force, elapsedMs: elapsedMs(t0) });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'MB Match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'error', stats); } catch {}
    await evError(runId, { kind: 'mb.match', target, force, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

/** ===== 3b) Custom Artists MB Match (без изменений базовой логики) ===== */
export async function runCustomArtistsMatch(
  reuseRunId?: number,
  opts?: { onlyId?: number; force?: boolean }
) {
  const force = !!opts?.force;

  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('custom', { phase: 'match', c_total: 0, c_done: 0, c_matched: 0 });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'custom.match', onlyId: opts?.onlyId ?? null, force });
  try {
    let items: { id: number; name: string; mbid: string | null }[] = [];

    if (opts?.onlyId) {
      const one = await prisma.customArtist.findUnique({
        where: { id: opts.onlyId },
        select: { id: true, name: true, mbid: true },
      });
      items = one ? [one] : [];
    } else {
      items = await prisma.customArtist.findMany({
        select: { id: true, name: true, mbid: true },
        orderBy: { id: 'asc' },
      });
    }

    await patchRunStats(runId, { c_total: items.length });
    await dblog(runId, 'info', `Custom match started`, {
      total: items.length,
      onlyId: opts?.onlyId ?? null,
      force,
    });

    let c_done = 0;
    let c_matched = 0;

    for (const it of items) {
      if (await bailIfCancelled(runId, 'custom-match')) return;

      if (it.mbid && !force) {
        c_done++;
        if (c_done % 5 === 0) await patchRunStats(runId, { c_done, c_matched });
        continue;
      }

      try {
        const r = await mbFindArtist(it.name);

        await prisma.cacheEntry.upsert({
          where: { key: `custom:artist:${it.id}` },
          create: { scope: 'custom:artist', key: `custom:artist:${it.id}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });

        if (r.externalId) {
          await prisma.customArtist.update({
            where: { id: it.id },
            data: { mbid: r.externalId, matchedAt: new Date() },
          });
          c_matched++;
          await dblog(runId, 'info', `✔ Custom artist matched: ${it.name}`, { id: it.id, name: it.name, mbid: r.externalId });
        } else {
          await dblog(runId, 'info', `✖ Custom artist not matched: ${it.name}`, { id: it.id, name: it.name });
        }
      } catch (e: any) {
        await dblog(runId, 'warn', 'MB lookup failed', { id: it.id, name: it.name, error: String(e?.message || e) });
      }

      c_done++;
      if (c_done % 5 === 0) await patchRunStats(runId, { c_done, c_matched });
    }

    await patchRunStats(runId, { c_done, c_matched, phase: 'done' });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'ok', stats);} catch {}
    await evFinish(runId, { kind: 'custom.match', force, onlyId: opts?.onlyId ?? null, elapsedMs: elapsedMs(t0) });
  } catch (e: any) {
    await dblog(runId, 'error', 'Custom match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'error', stats); } catch {}
    await evError(runId, { kind: 'custom.match', force, onlyId: opts?.onlyId ?? null, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

/** ===== 4) Lidarr push — не репушим, если уже отправляли (настраивается) ===== */
export async function runLidarrPush(
  overrideTarget?: 'artists' | 'albums',
  source?: 'yandex' | 'custom',
) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const target: 'artists' | 'albums' =
    overrideTarget ?? (setting?.pushTarget === 'albums' ? 'albums' : 'artists');
  const src: 'yandex' | 'custom' = source === 'custom' ? 'custom' : 'yandex';
  const allowRepush = !!setting?.allowRepush;

  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({
      data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' },
    });
    return;
  }

  const run = await startRun('lidarr', {
    phase: 'push',
    total: 0,
    done: 0,
    ok: 0,
    failed: 0,
    target,
    source: src,
  });
  if (!run) return;
  const t0 = now();
  await evStart(run.id, { kind: 'lidarr.push', target, source: src, allowRepush });
  try {
    let items: any[] = [];

    if (target === 'albums') {
      const base = await prisma.yandexAlbum.findMany({
        where: { present: true, rgMbid: { not: null } },
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      });
      if (allowRepush) {
        items = base;
      } else {
        const already = await prisma.albumPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter(x => x.rgMbid && !pushed.has(x.rgMbid));
      }
    } else {
      const base = src === 'custom'
        ? await prisma.customArtist.findMany({ where: { mbid: { not: null } }, orderBy: { name: 'asc' } })
        : await prisma.yandexArtist.findMany({ where: { present: true, mbid: { not: null } }, orderBy: { name: 'asc' } });

      if (allowRepush) {
        items = base;
      } else {
        const already = await prisma.artistPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter((x: any) => x.mbid && !pushed.has(x.mbid));
      }
    }

    await patchRunStats(run.id, { total: items.length });
    await dblog(run.id, 'info', `Pushing ${items.length} ${target} to Lidarr (source=${src})`);

    let done = 0, ok = 0, failed = 0;

    const effSetting = { ...(setting as any) };

    for (const it of items as any[]) {
      if (await bailIfCancelled(run.id, 'lidarr-push')) return;

      try {
        if (target === 'albums') {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) => dblog(run.id, level, msg, extra);
          const result = await pushAlbumWithConfirm(
            effSetting,
            { artist: it.artist, title: it.title, rgMbid: it.rgMbid! },
            log,
            { maxAttempts: 1, initialDelayMs: 1000 }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const title    = confirmed?.title || it.title;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            if (it.rgMbid) {
              const existing = await prisma.albumPush.findFirst({ where: { mbid: it.rgMbid } });
              if (existing) {
                await prisma.albumPush.update({
                  where: { id: existing.id },
                  data: { title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
                });
              } else {
                await prisma.albumPush.create({
                  data: { mbid: it.rgMbid, title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: 'push' },
                });
              }
            }
            ok++;
          } else {
            failed++;
            await dblog(run.id, 'warn', `✖ Album push failed: ${it.artist} — ${it.title}`, { target, rgMbid: it.rgMbid, reason: result.reason });
          }
        } else {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) => dblog(run.id, level, msg, extra);
          const result = await pushArtistWithConfirm(
            effSetting,
            { name: it.name, mbid: it.mbid! },
            log,
            { maxAttempts: 1, initialDelayMs: 1000 }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const name     = confirmed?.artistName || it.name;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            const existing = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
            if (existing) {
              await prisma.artistPush.update({
                where: { id: existing.id },
                data: { name, path, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
              });
            } else {
              await prisma.artistPush.create({
                data: {
                  mbid: it.mbid,
                  name,
                  path,
                  lidarrArtistId: lidarrId ?? null,
                  status: action === 'exists' ? 'EXISTS' : 'CREATED',
                  source: src === 'custom' ? 'custom-push' : 'push',
                },
              });
            }
            ok++;
          } else {
            failed++;
            await dblog(run.id, 'warn', `✖ Push failed: ${it.name}`, { target, mbid: it.mbid, reason: result.reason });
          }
        }
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `Push exception: ${String(e?.message || e)}`, { target });
      }
      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    await patchRunStats(run.id, { done, ok, failed, phase: 'done' });
    await endRun(run.id, 'ok');

    const finalRun = await getRunWithRetry(run.id);
    await evFinish(run.id, {
      kind: 'lidarr.push', target, source: src, allowRepush,
      totals: { done, ok, failed }, elapsedMs: elapsedMs(t0),
    });
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(run.id);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
    await evError(run.id, { kind: 'lidarr.push', target, source: src, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

/* ===== 4b) Расширенные обёртки под ТЗ (ALL/варианты и специальные kind) ===== */

type PushExOpts = {
  target?: 'artists'|'albums';
  source?: 'yandex'|'custom';
  reuseRunId?: number;
  noFinalize?: boolean;
  kindOverride?: string;
  allowRepushOverride?: boolean;
};

async function runLidarrPushEx(opts: PushExOpts = {}) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const target: 'artists'|'albums' = opts.target ?? 'artists';
  const source: 'yandex'|'custom' = opts.source ?? 'yandex';
  const allowRepush = opts.allowRepushOverride ?? !!setting?.allowRepush;

  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: opts.kindOverride || 'lidarr.push', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind(
    opts.kindOverride || (source === 'custom' ? `custom.push.${target}` : `yandex.push.${target}`),
    { phase: 'push', total: 0, done: 0, ok: 0, failed: 0, target, source },
    opts.reuseRunId
  );
  if (!run) return;

  await dblog(run.id, 'info', `Push start`, { target, source });
  const t0 = now();
  await evStart(run.id, { kind: 'lidarr.push.ex', target, source, allowRepush });

  try {
    let items: any[] = [];

    if (target === 'albums') {
      const base = await prisma.yandexAlbum.findMany({
        where: { present: true, rgMbid: { not: null } },
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      });
      if (allowRepush) {
        items = base;
      } else {
        const already = await prisma.albumPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter(x => x.rgMbid && !pushed.has(x.rgMbid));
      }
    } else {
      const base = source === 'custom'
        ? await prisma.customArtist.findMany({ where: { mbid: { not: null } }, orderBy: { name: 'asc' } })
        : await prisma.yandexArtist.findMany({ where: { present: true, mbid: { not: null } }, orderBy: { name: 'asc' } });

      if (allowRepush) {
        items = base;
      } else {
        const already = await prisma.artistPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter((x: any) => x.mbid && !pushed.has(x.mbid));
      }
    }

    const total = items.length;
    await patchRunStats(run.id, { total });

    let done = 0, ok = 0, failed = 0;
    const effSetting = { ...(setting as any) };

    for (const it of items as any[]) {
      if (await bailIfCancelled(run.id, 'lidarr-push')) return;

      try {
        if (target === 'albums') {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) => dblog(run.id, level, msg, extra);
          const result = await pushAlbumWithConfirm(
            effSetting,
            { artist: it.artist, title: it.title, rgMbid: it.rgMbid! },
            log,
            { maxAttempts: 1, initialDelayMs: 1000 }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const title    = confirmed?.title || it.title;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            if (it.rgMbid) {
              const existing = await prisma.albumPush.findFirst({ where: { mbid: it.rgMbid } });
              if (existing) {
                await prisma.albumPush.update({
                  where: { id: existing.id },
                  data: { title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
                });
              } else {
                await prisma.albumPush.create({
                  data: { mbid: it.rgMbid, title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: 'push' },
                });
              }
            }
            ok++;
          } else {
            failed++;
            await dblog(run.id, 'warn', `✖ Album push failed: ${it.artist} — ${it.title}`, { target, rgMbid: it.rgMbid, reason: result.reason });
          }
        } else {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) => dblog(run.id, level, msg, extra);
          const result = await pushArtistWithConfirm(
            effSetting,
            { name: it.name, mbid: it.mbid! },
            log,
            { maxAttempts: 1, initialDelayMs: 1000 }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const name     = confirmed?.artistName || it.name;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            const existing = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
            if (existing) {
              await prisma.artistPush.update({
                where: { id: existing.id },
                data: { name, path, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
              });
            } else {
              await prisma.artistPush.create({
                data: {
                  mbid: it.mbid,
                  name,
                  path,
                  lidarrArtistId: lidarrId ?? null,
                  status: action === 'exists' ? 'EXISTS' : 'CREATED',
                  source: source === 'custom' ? 'custom-push' : 'push',
                },
              });
            }
            ok++;
          } else {
            failed++;
            await dblog(run.id, 'warn', `✖ Push failed: ${it.name}`, { target, mbid: it.mbid, reason: result.reason });
          }
        }
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `✖ Push exception: ${String(e?.message || e)}`, { target });
      }

      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    // Финальный лог сводки
    const skipped = Math.max(0, total - (ok + failed));
    await dblog(run.id, 'info', `Push finished: target ${target}, source ${source}, allowRepush ${allowRepush}, total ${total}, ok ${ok}, failed ${failed}, skipped ${skipped}`, {
      target, source, allowRepush, total, ok, failed, skipped,
    });
    await evFinish(run.id, {
      kind: 'lidarr.push.ex', target, source, allowRepush,
      totals: { done, ok, failed, skipped }, elapsedMs: elapsedMs(t0),
    });
    await patchRunStats(run.id, { done, ok, failed });
    if (!opts.noFinalize) {
      await patchRunStats(run.id, { phase: 'done' });
      await endRun(run.id, 'ok');
      const finalRun = await getRunWithRetry(run.id);
      try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
    }
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    if (!opts.noFinalize) {
      await endRun(run.id, 'error', String(e?.message || e));
      await evError(run.id, { kind: 'lidarr.push.ex', target, source, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
      const finalRun = await getRunWithRetry(run.id);
      try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
    }
  }
}

/** Обёртки под ТЗ */
export async function runCustomMatchAll(reuseRunId?: number, opts?: { force?: boolean }) {
  const run = await startRunWithKind('custom.match.all', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 }, reuseRunId);
  if (!run) return;
  await dblog(run.id, 'info', 'Custom match (ALL) started');
  return runCustomArtistsMatch(run.id, { force: !!opts?.force });
}

export async function runCustomPushAll(
  reuseRunId?: number,
  opts?: { force?: boolean }
) {
  return runLidarrPushEx({
    target: 'artists',
    source: 'custom',
    reuseRunId,
    kindOverride: 'custom.push.all',
    allowRepushOverride: !!opts?.force,
  });
}

export async function runYandexPullAll(reuseRunId?: number) {
  const run = await startRunWithKind('yandex.pull.all', { phase: 'start', a_total: 0, a_done: 0, al_total: 0, al_done: 0 }, reuseRunId);
  if (!run) return;
  await dblog(run.id, 'info', 'Yandex pull (ALL) started');
  await evStart(run.id, { kind: 'yandex.pull.all' });
  return runYandexPull(undefined, run.id);
}

export async function runYandexMatch(target: 'artists'|'albums'|'both' = 'both', opts?: { force?: boolean; reuseRunId?: number }) {
  const kind = target === 'artists' ? 'yandex.match.artists' : target === 'albums' ? 'yandex.match.albums' : 'yandex.match.all';
  const run = await startRunWithKind(kind, { phase: 'start', a_total: 0, a_done: 0, a_matched: 0, al_total: 0, al_done: 0, al_matched: 0 }, opts?.reuseRunId);
  if (!run) return;
  await dblog(run.id, 'info', `Yandex match start`, { target, force: !!opts?.force });
  await evStart(run.id, { kind, target, force: !!opts?.force });
  return runMbMatch(run.id, { target, force: !!opts?.force });
}

export async function runYandexPush(target: 'artists'|'albums'|'both' = 'artists', opts?: { reuseRunId?: number }) {
  const kind = target === 'artists' ? 'yandex.push.artists' : target === 'albums' ? 'yandex.push.albums' : 'yandex.push.all';
  const run = await startRunWithKind(kind, { phase: 'start', total: 0, done: 0, ok: 0, failed: 0, target }, opts?.reuseRunId);
  if (!run) return;
  const t0 = now();
  await dblog(run.id, 'info', `Yandex push start`, { target });
  await evStart(run.id, { kind, target });

  if (target === 'both') {
    await runLidarrPushEx({ target: 'artists', source: 'yandex', reuseRunId: run.id, noFinalize: true, kindOverride: kind });
    await runLidarrPushEx({ target: 'albums',  source: 'yandex', reuseRunId: run.id, noFinalize: true, kindOverride: kind });
    await patchRunStats(run.id, { phase: 'done' });
    await endRun(run.id, 'ok');
    const finalRun = await getRunWithRetry(run.id);
    await evFinish(run.id, { kind, target, mode: 'both', elapsedMs: elapsedMs(t0) });
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } else {
    await runLidarrPushEx({ target, source: 'yandex', reuseRunId: run.id, kindOverride: kind });
  }
}

// --- Mass search for all Lidarr artists ---
export async function runLidarrSearchArtists(reuseRunId?: number, opts?: { delayMs?: number }) {

  const MIN_DELAY_MS = 50;
  const MAX_DELAY_MS = 10_000;
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: 'lidarr.search.artists', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind(
    'lidarr.search.artists',
    { phase: 'search', total: 0, done: 0, ok: 0, failed: 0 },
    reuseRunId
  );
  if (!run) return;
  const runId = run.id;

  const base = setting.lidarrUrl.replace(/\/+$/, '');
  const key  = setting.lidarrApiKey;
  const delayRaw = Number(opts?.delayMs ?? 150);
  const delay = Number.isFinite(delayRaw)
    ? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delayRaw))
    : 150;

  const t0 = now();
  await evStart(runId, { kind: 'lidarr.search.artists', delayMs: delay });
  await dblog(runId, 'info', 'Lidarr search all artists is started');

  try {
    const artists = await prisma.lidarrArtist.findMany({ where: { removed: false }, select: { id: true } });
    await patchRunStats(runId, { total: artists.length });

    let done = 0, ok = 0, failed = 0;

    for (const a of artists) {
      try {
        const url = `${base}/api/v1/command`;
        const body = JSON.stringify({ name: 'ArtistSearch', artistId: a.id });
        const res = await request(url, { method: 'POST', body, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' } });
        if (res.statusCode >= 400) throw new Error(`ArtistSearch ${a.id} -> ${res.statusCode}`);
        ok++;
      } catch (e: any) {
        failed++;
        await dblog(runId, 'warn', `ArtistSearch failed: ${a.id}`, { artistId: a.id, error: String(e?.message || e) });
      }
      done++;
      if (done % 25 === 0) await patchRunStats(runId, { done, ok, failed });
      if (delay) await new Promise(r => setTimeout(r, delay));
    }

    await patchRunStats(runId, { done, ok, failed, phase: 'done' });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    await evFinish(runId, { kind: 'lidarr.search.artists', totals: { done, ok, failed }, elapsedMs: elapsedMs(t0), delayMs: delay });
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr mass ArtistSearch failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
    await evError(runId, { kind: 'lidarr.search.artists', error: String(e?.message || e), elapsedMs: elapsedMs(t0), delayMs: delay });
  }
  await dblog(runId, 'info', 'Lidarr search all artists is done');
}
