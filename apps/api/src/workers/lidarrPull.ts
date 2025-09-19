// apps/api/src/workers/lidarrPull.ts
import {
  prisma, startRunWithKind, patchRunStats, endRun, dblog,
  evStart, evFinish, evError, now, elapsedMs, bailIfCancelled, getRunWithRetry,
} from './_common';

async function lidarrApi<T = any>(base: string, key: string, path: string): Promise<T> {
  const url = `${base.replace(/\/+$/, '')}${path}`;
  const res = await (await import('undici')).request(url, { headers: { 'X-Api-Key': key } });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`Lidarr ${path} ${res.statusCode}: ${text?.slice(0, 180)}`);
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

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
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'error', stats); } catch {}
    await evError(runId, { kind, target, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}
