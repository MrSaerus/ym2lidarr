import { request } from 'undici';
import {
  prisma, startRunWithKind, patchRunStats, endRun, dblog,
  evStart, evFinish, evError, now, elapsedMs, getRunWithRetry,
} from './_common';

type LidarrSearchScope = 'all' | 'yandexLinked';

type RunLidarrSearchArtistsOpts = {
  delayMs?: number;
  /**
   * all          — old behavior: ArtistSearch for every cached Lidarr artist.
   * yandexLinked — only artists that are linked from Yandex rows to Lidarr.
   */
  scope?: LidarrSearchScope;
};

function normMbid(v: unknown): string {
  return String(v || '')
    .replace(/^mbid:/i, '')
    .trim()
    .toLowerCase();
}

function chunked<T>(xs: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

async function findAllLidarrArtists() {
  return prisma.lidarrArtist.findMany({
    where: { removed: false },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
}

/**
 * Возвращает Lidarr artists, которые реально видны из Yandex как "есть Lidarr".
 * Учитываем два слоя связи:
 *   1. YandexArtist.mbid -> LidarrArtist.mbid
 *   2. YandexAlbum.rgMbid -> LidarrAlbum.mbid -> LidarrAlbum.artistId
 * Второй слой важен, потому что в Yandex часто заполнен rgMbid у альбома,
 * но artist-level mbid может отсутствовать или не совпадать.
 */
async function findYandexLinkedLidarrArtists(runId: number) {
  const artistIds = new Set<number>();

  const yandexArtistMbids = new Set<string>();
  const yandexAlbumRgMbids = new Set<string>();

  const yArtists = await prisma.yandexArtist.findMany({
    where: {
      present: true,
      mbid: { not: null },
    },
    select: { mbid: true },
  });

  for (const a of yArtists) {
    const mbid = normMbid(a.mbid);
    if (mbid) yandexArtistMbids.add(mbid);
  }

  const yAlbums = await prisma.yandexAlbum.findMany({
    where: {
      present: true,
      rgMbid: { not: null },
    },
    select: { rgMbid: true },
  });

  for (const a of yAlbums) {
    const mbid = normMbid(a.rgMbid);
    if (mbid) yandexAlbumRgMbids.add(mbid);
  }

  let linkedByArtistMbid = 0;
  let linkedByAlbumMbid = 0;

  const artistMbids = Array.from(yandexArtistMbids);
  for (const mbids of chunked(artistMbids, 500)) {
    const rows = await prisma.lidarrArtist.findMany({
      where: {
        removed: false,
        mbid: { in: mbids },
      },
      select: { id: true, mbid: true },
    });

    for (const r of rows) {
      const mbid = normMbid(r.mbid);
      if (mbid && yandexArtistMbids.has(mbid)) {
        artistIds.add(r.id);
        linkedByArtistMbid++;
      }
    }
  }

  const albumMbids = Array.from(yandexAlbumRgMbids);
  for (const mbids of chunked(albumMbids, 500)) {
    const rows = await prisma.lidarrAlbum.findMany({
      where: {
        removed: false,
        mbid: { in: mbids },
      },
      select: { id: true, mbid: true, artistId: true },
    });

    for (const r of rows) {
      const mbid = normMbid(r.mbid);
      if (mbid && yandexAlbumRgMbids.has(mbid) && r.artistId) {
        artistIds.add(r.artistId);
        linkedByAlbumMbid++;
      }
    }
  }

  const ids = Array.from(artistIds).sort((a, b) => a - b);
  const artists = ids.length
    ? await prisma.lidarrArtist.findMany({
        where: {
          removed: false,
          id: { in: ids },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    : [];

  await dblog(runId, 'info', 'Selected Lidarr artists linked from Yandex', {
    yandexArtistMbids: artistMbids.length,
    yandexAlbumRgMbids: albumMbids.length,
    linkedByArtistMbid,
    linkedByAlbumMbid,
    distinctArtists: artists.length,
  });

  return artists;
}

export async function runLidarrSearchArtists(
  reuseRunId?: number,
  opts?: RunLidarrSearchArtistsOpts,
) {
  const MIN_DELAY_MS = 50;
  const MAX_DELAY_MS = 10_000;
  const scope: LidarrSearchScope = opts?.scope === 'yandexLinked' ? 'yandexLinked' : 'all';
  const kind = scope === 'yandexLinked'
    ? 'lidarr.search.yandex.artists'
    : 'lidarr.search.artists';

  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind, status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind(kind, { phase: 'search', scope, total: 0, done: 0, ok: 0, failed: 0 }, reuseRunId);
  if (!run) return;
  const runId = run.id;

  const base = setting.lidarrUrl.replace(/\/+$/, '');
  const key  = setting.lidarrApiKey;
  const delayRaw = Number(opts?.delayMs ?? 150);
  const delay = Number.isFinite(delayRaw) ? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delayRaw)) : 150;

  const t0 = now();
  await evStart(runId, { kind, scope, delayMs: delay });
  await dblog(
    runId,
    'info',
    scope === 'yandexLinked'
      ? 'Lidarr search Yandex-linked artists is started'
      : 'Lidarr search all artists is started',
    { scope, delayMs: delay },
  );

  try {
    const artists = scope === 'yandexLinked'
      ? await findYandexLinkedLidarrArtists(runId)
      : await findAllLidarrArtists();

    await patchRunStats(runId, { phase: 'search', scope, total: artists.length });

    let done = 0, ok = 0, failed = 0;

    for (const a of artists) {
      try {
        const url = `${base}/api/v1/command`;
        const body = JSON.stringify({ name: 'ArtistSearch', artistId: a.id });
        const res = await request(url, {
          method: 'POST',
          body,
          headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
        });
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
    await evFinish(runId, { kind, scope, totals: { done, ok, failed }, elapsedMs: elapsedMs(t0), delayMs: delay });
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr mass ArtistSearch failed', { scope, error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'error', stats); } catch {}
    await evError(runId, { kind, scope, error: String(e?.message || e), elapsedMs: elapsedMs(t0), delayMs: delay });
  }

  await dblog(
    runId,
    'info',
    scope === 'yandexLinked'
      ? 'Lidarr search Yandex-linked artists is done'
      : 'Lidarr search all artists is done',
    { scope },
  );
}
