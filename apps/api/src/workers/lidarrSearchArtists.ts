// apps/api/src/workers/lidarrSearchArtists.ts
import { request } from 'undici';
import {
  prisma, startRunWithKind, patchRunStats, endRun, dblog,
  evStart, evFinish, evError, now, elapsedMs, getRunWithRetry,
} from './_common';

export async function runLidarrSearchArtists(reuseRunId?: number, opts?: { delayMs?: number }) {
  const MIN_DELAY_MS = 50;
  const MAX_DELAY_MS = 10_000;
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: 'lidarr.search.artists', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind('lidarr.search.artists', { phase: 'search', total: 0, done: 0, ok: 0, failed: 0 }, reuseRunId);
  if (!run) return;
  const runId = run.id;

  const base = setting.lidarrUrl.replace(/\/+$/, '');
  const key  = setting.lidarrApiKey;
  const delayRaw = Number(opts?.delayMs ?? 150);
  const delay = Number.isFinite(delayRaw) ? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delayRaw)) : 150;

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
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Lidarr mass ArtistSearch failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('lidarr', 'error', stats); } catch {}
    await evError(runId, { kind: 'lidarr.search.artists', error: String(e?.message || e), elapsedMs: elapsedMs(t0), delayMs: delay });
  }
  await dblog(runId, 'info', 'Lidarr search all artists is done');
}
