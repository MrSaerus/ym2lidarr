// apps/api/src/workers.ts
import { startRun, endRun, patchRunStats, log as dblog } from './log';
import { notify } from './notify';
import { prisma } from './prisma';
import {
  ensureArtistInLidarr,
  ensureAlbumInLidarr,
  getRootFolders,
  getQualityProfiles,
  getMetadataProfiles,
} from './services/lidarr';
import { mbFindArtist, mbFindReleaseGroup } from './services/mb';
import { yandexPullLikes, setPyproxyUrl } from './services/yandex';
import { request } from 'undici';

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
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

/** ===== 1) Yandex Pull (ТОЛЬКО pyproxy; в Yandex* пишем ТОЛЬКО с числовым ymId) ===== */
export async function runYandexPull(tokenOverride?: string, reuseRunId?: number) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');

  await prisma.$transaction([
    prisma.yandexArtist.updateMany({ data: { present: false } }),
    prisma.yandexAlbum.updateMany({ data: { present: false } }),
  ]);

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

  try {
    await dblog(runId, 'info', 'Pulling likes from Yandex (pyproxy)…', { driver: 'pyproxy' });
    if (await bailIfCancelled(runId, 'pull-start')) return;

    const { artists, albums } = await yandexPullLikes(token, { driver: 'pyproxy' });

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
          create: { ymId: ymIdStr, name, key: nkey(name), present: true },
          update: { name, key: nkey(name), present: true },
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
            yandexArtistId: /^\d+$/.test(ymArtistIdStr) ? ymArtistIdStr : null,
          },
          update: {
            title,
            artist: artistName || null,
            year,
            key: nkey(`${artistName}|||${title}`),
            present: true,
            yandexArtistId: /^\d+$/.test(ymArtistIdStr) ? ymArtistIdStr : null,
          },
        });
      }

      al_done++;
      if (al_done % 50 === 0) await patchRunStats(runId, { al_done });
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

/* ------------------------ Lidarr: helpers ------------------------ */
async function lidarrApi<T = any>(base: string, key: string, path: string): Promise<T> {
  const url = `${base.replace(/\/+$/, '')}${path}`;
  const res = await request(url, { headers: { 'X-Api-Key': key } });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`Lidarr ${path} ${res.statusCode}: ${text?.slice(0, 180)}`);
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

/** ===== 2) Lidarr Pull ===== */
export async function runLidarrPull(reuseRunId?: number) {
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
    const base = (setting.lidarrUrl || '').replace(/\/+$/, '');
    const apiKey = setting.lidarrApiKey!;

    // 1) Artists
    const artists: any[] = await lidarrApi(base, apiKey, '/api/v1/artist');
    await patchRunStats(runId, { total: artists.length });

    let done = 0;
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
          removed: false,
          lastSyncAt: new Date(),
        },
        update: {
          name: String(a.artistName || a.name || ''),
          mbid: a.foreignArtistId || a.mbid || null,
          monitored: !!a.monitored,
          path: a.path || null,
          added: a.added ? new Date(a.added) : null,
          removed: false,
          lastSyncAt: new Date(),
        },
      });

      done++;
      if (done % 25 === 0) await patchRunStats(runId, { done });
    }

    // 2) Albums per-artist
    let alTotal = 0, alDone = 0;
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
            removed: false,
            lastSyncAt: new Date(),
          },
        });
        alDone++;
        if (alDone % 50 === 0) await patchRunStats(runId, { albumsDone: alDone, albumsTotal: alTotal });
      }
    }

    await patchRunStats(run.id, { phase: 'done', done, albumsDone: alDone, albumsTotal: alTotal });
    await endRun(run.id, 'ok');
    const finalRun = await getRunWithRetry(run.id);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr Pull failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(run.id);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
  }
}

/** ===== 3) Match (MB) — сопоставление + синхронизация в Yandex* ===== */
export async function runMbMatch(reuseRunId?: number, opts?: { force?: boolean; target?: 'artists'|'albums'|'both' }) {
  const force = !!(opts?.force);
  const target = opts?.target || 'both';

  const run = reuseRunId
      ? { id: reuseRunId }
      : await startRun('match', { phase: 'match', a_total: 0, a_done: 0, a_matched: 0, al_total: 0, al_done: 0, al_matched: 0 });

  if (!run) return;
  const runId = run.id;

  try {
    // ARTISTS
    if (target === 'artists' || target === 'both') {
      const ya = await prisma.yandexArtist.findMany({ where: { present: true }, orderBy: { id: 'asc' } });
      await patchRunStats(runId, { a_total: ya.length });

      let a_done = 0, a_matched = 0;
      for (const y of ya) {
        if (await bailIfCancelled(runId, 'match-artists')) return;

        if (y.mbid && !force) { a_done++; if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched }); continue; }

        const r = await mbFindArtist(y.name);
        await prisma.cacheEntry.upsert({
          where: { key: `ya:artist:${y.ymId}` },
          create: { scope: 'ya:artist', key: `ya:artist:${y.ymId}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });

        if (r.externalId) {
          await prisma.yandexArtist.update({ where: { id: y.id }, data: { mbid: r.externalId } });
          a_matched++;
          await dblog(runId, 'info', 'Artist matched', { yaId: y.ymId, name: y.name, mbid: r.externalId });
        } else {
          await dblog(runId, 'info', 'Artist not matched', { yaId: y.ymId, name: y.name });
        }

        a_done++;
        if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched });
      }
      await patchRunStats(runId, { a_done, a_matched });
    }

    // ALBUMS
    if (target === 'albums' || target === 'both') {
      const yalb = await prisma.yandexAlbum.findMany({ where: { present: true }, orderBy: { id: 'asc' } });
      await patchRunStats(runId, { al_total: yalb.length });

      let al_done = 0, al_matched = 0;
      for (const rec of yalb) {
        if (await bailIfCancelled(runId, 'match-albums')) return;

        if (rec.rgMbid && !force) { al_done++; if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched }); continue; }

        const r = await mbFindReleaseGroup(rec.artist || '', rec.title);
        await prisma.cacheEntry.upsert({
          where: { key: `ya:album:${rec.ymId}` },
          create: { scope: 'ya:album', key: `ya:album:${rec.ymId}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });

        if (r.externalId) {
          await prisma.yandexAlbum.update({ where: { id: rec.id }, data: { rgMbid: r.externalId } });
          al_matched++;
          await dblog(runId, 'info', 'Album matched', { yaId: rec.ymId, artist: rec.artist, title: rec.title, rgMbid: r.externalId });
        } else {
          await dblog(runId, 'info', 'Album not matched', { yaId: rec.ymId, artist: rec.artist, title: rec.title });
        }

        al_done++;
        if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched });
      }
      await patchRunStats(runId, { al_done, al_matched });
    }

    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'MB Match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'error', stats); } catch {}
  }
}

/** ===== 3b) Custom Artists MB Match ===== */
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
        await dblog(runId, 'info', 'Skip already matched', { id: it.id, name: it.name, mbid: it.mbid });
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
          await dblog(runId, 'info', 'Custom artist matched', { id: it.id, name: it.name, mbid: r.externalId });
        } else {
          await dblog(runId, 'info', 'Custom artist not matched', { id: it.id, name: it.name });
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
  } catch (e: any) {
    await dblog(runId, 'error', 'Custom match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('match', 'error', stats); } catch {}
  }
}

/** ===== 4) Lidarr push ===== */
export async function runLidarrPush() {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRun('lidarr', {
    phase: 'push', total: 0, done: 0, ok: 0, failed: 0, target: setting.pushTarget || 'artists',
  });
  if (!run) return;

  try {
    const target = setting.pushTarget === 'albums' ? 'albums' : 'artists';

    const items =
        target === 'albums'
            ? await prisma.yandexAlbum.findMany({
              where: { present: true, rgMbid: { not: null } },
              orderBy: [{ artist: 'asc' }, { title: 'asc' }],
            })
            : await prisma.yandexArtist.findMany({
              where: { present: true, mbid: { not: null } },
              orderBy: { name: 'asc' },
            });

    await patchRunStats(run.id, { total: items.length });
    await dblog(run.id, 'info', `Pushing ${items.length} ${target} to Lidarr`);

    let done = 0, ok = 0, failed = 0;

    const effSetting = { ...(setting as any) };

    for (const it of items as any[]) {
      if (await bailIfCancelled(run.id, 'lidarr-push')) return;

      try {
        if (target === 'albums') {
          const res = await ensureAlbumInLidarr(effSetting, {
            artist: it.artist,
            title: it.title,
            rgMbid: it.rgMbid!,
          });

          const title = res?.title || it.title;
          const lidarrId = res?.id;
          const path = res?.path;
          const action = res?.__action || 'created';
          const from = res?.__from;

          await dblog(run.id, 'info', `Pushed album ${title}, action=${action}`, {
            target, action, lidarrId, path, title, rgMbid: it.rgMbid, from,
            payload: res?.__request, response: res?.__response,
          });

          if (it.rgMbid) {
            const existing = await prisma.albumPush.findFirst({ where: { mbid: it.rgMbid } });
            if (existing) {
              await prisma.albumPush.update({
                where: { id: existing.id },
                data: { title, path: path ?? null, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
              });
            } else {
              await prisma.albumPush.create({
                data: { mbid: it.rgMbid, title, path: path ?? null, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: 'push' },
              });
            }
          }
        } else {
          const cached = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
          if (cached && (cached.status === 'CREATED' || cached.status === 'EXISTS')) {
            await dblog(run.id, 'info', `Skip push: "${cached.name}" already in Lidarr`, {
              target, action: 'skip', lidarrId: cached.lidarrArtistId, path: cached.path, name: cached.name, mbid: cached.mbid, from: 'cache',
            });
            continue;
          }

          const res = await ensureArtistInLidarr(effSetting, { name: it.name, mbid: it.mbid! });

          const name = res?.artistName || it.name;
          const lidarrId = res?.id;
          const path = res?.path;
          const action = res?.__action || 'created';
          const from = res?.__from;

          await dblog(run.id, 'info', `Pushed artist ${name}, action=${action}`, {
            target, action, lidarrId, path, name, mbid: it.mbid, from,
            payload: res?.__request, response: res?.__response,
          });

          const existing = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
          if (existing) {
            await prisma.artistPush.update({
              where: { id: existing.id },
              data: { name, path: path ?? null, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
            });
          } else {
            await prisma.artistPush.create({
              data: { mbid: it.mbid, name, path: path ?? null, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: 'push' },
            });
          }
        }
        ok++;
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `Push failed: ${String(e?.message || e)}`, { target });
      }
      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    await patchRunStats(run.id, { done, ok, failed, phase: 'done' });
    await endRun(run.id, 'ok');

    const finalRun = await getRunWithRetry(run.id);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(run.id);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await notify('lidarr', 'error', stats); } catch {}
  }
}
