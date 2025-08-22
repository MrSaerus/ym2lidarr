// apps/api/src/routes/sync.ts
import { Router } from 'express';

import { startRun } from '../log';
import { prisma } from '../prisma';
import {
  runYandexPull,
  runLidarrPull,
  runMbMatch,
  runLidarrPush,
  runCustomMatchAll,
  runCustomPushAll,
  runYandexPullAll,
  runYandexMatch,
  runYandexPush,
  runLidarrPullEx,
} from '../workers';

const r = Router();

r.post('/yandex/pull', async (req, res) => {
  const override =
      typeof req.body?.token === 'string' && req.body.token.trim()
          ? req.body.token.trim()
          : undefined;

  const run = await startRun('yandex', {
    phase: 'start',
    a_total: 0,
    a_done: 0,
    al_total: 0,
    al_done: 0,
  });

  runYandexPull(override, run.id).catch(() => {});
  res.json({ started: true, runId: run.id });
});

r.post('/lidarr/pull', async (req, res) => {
  // если передан target — используем расширенный вариант с kind
  const target = (req.body?.target || req.query.target) as 'artists'|'albums'|'both'|undefined;
  if (target) {
    const kind =
        target === 'artists' ? 'lidarr.pull.artists' :
            target === 'albums'  ? 'lidarr.pull.albums'  : 'lidarr.pull.all';

    const run = await startRun(kind, { phase: 'start', total: 0, done: 0, albumsTotal: 0, albumsDone: 0 });
    runLidarrPullEx(target, run.id).catch(() => {});
    return res.json({ started: true, runId: run.id, target });
  }

  const run = await startRun('lidarr', { phase: 'start', total: 0, done: 0 });
  runLidarrPull(run.id).catch(() => {});
  res.json({ started: true, runId: run.id, target: 'both' });
});

r.post('/match', async (req, res) => {
  const force = req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';
  const target = (req.body?.target || req.query.target) as any; // 'artists' | 'albums' | 'both'

  const run = await startRun('match', {
    phase: 'start',
    a_total: 0,
    a_done: 0,
    a_matched: 0,
    al_total: 0,
    al_done: 0,
    al_matched: 0,
  });

  runMbMatch(run.id, {
    force,
    target: ['artists', 'albums', 'both'].includes(target) ? target : 'both',
  }).catch(() => {});
  res.json({ started: true, runId: run.id });
});

r.post('/lidarr', async (req, res) => {
  const t =
      req.body?.target === 'albums'
          ? 'albums'
          : req.body?.target === 'artists'
              ? 'artists'
              : undefined;
  const src = req.body?.source === 'custom' ? 'custom' : 'yandex';
  runLidarrPush(t, src).catch(() => {});
  res.json({ started: true, target: t ?? 'from-settings', source: src });
});

r.post('/runs/:id/stop', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad runId' });

  const run = await prisma.syncRun.findUnique({ where: { id } });
  if (!run) return res.status(404).json({ ok: false, error: 'not found' });
  if (run.status !== 'running') return res.json({ ok: true, alreadyFinished: true });

  let stats: any = {};
  try { stats = run.stats ? JSON.parse(run.stats) : {}; } catch {}
  stats.cancel = true;

  await prisma.syncRun.update({
    where: { id },
    data: { stats: JSON.stringify(stats), message: 'Cancel requested' },
  });

  return res.json({ ok: true });
});

r.post('/custom/match', async (req, res) => {
  const force = req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';
  const run = await startRun('custom.match.all', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
  runCustomMatchAll(run.id, { force }).catch(() => {});
  res.json({ started: true, runId: run.id });
});

r.post('/custom/push', async (_req, res) => {
  const run = await startRun('custom.push.all', { phase: 'start', total: 0, done: 0, ok: 0, failed: 0 });
  runCustomPushAll(run.id).catch(() => {});
  res.json({ started: true, runId: run.id });
});

r.post('/yandex/pull-all', async (_req, res) => {
  const run = await startRun('yandex.pull.all', { phase: 'start', a_total: 0, a_done: 0, al_total: 0, al_done: 0 });
  runYandexPullAll(run.id).catch(() => {});
  res.json({ started: true, runId: run.id });
});

r.post('/yandex/match', async (req, res) => {
  const target = (req.body?.target || req.query.target || 'both') as 'artists'|'albums'|'both';
  const force  = req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';
  const kind   = target==='artists'?'yandex.match.artists':target==='albums'?'yandex.match.albums':'yandex.match.all';
  const run = await startRun(kind, { phase: 'start', a_total: 0, a_done: 0, a_matched: 0, al_total: 0, al_done: 0, al_matched: 0 });
  runYandexMatch(target, { force, reuseRunId: run.id }).catch(() => {});
  res.json({ started: true, runId: run.id, target, force });
});

r.post('/yandex/push', async (req, res) => {
  const target = (req.body?.target || req.query.target || 'artists') as 'artists'|'albums'|'both';
  const kind   = target==='artists'?'yandex.push.artists':target==='albums'?'yandex.push.albums':'yandex.push.all';
  const run = await startRun(kind, { phase: 'start', total: 0, done: 0, ok: 0, failed: 0, target });
  runYandexPush(target, { reuseRunId: run.id }).catch(() => {});
  res.json({ started: true, runId: run.id, target });
});

r.get('/runs', async (req, res) => {
  const kind = (req.query.kind as string) || undefined;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 20;
  const items = await prisma.syncRun.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  res.json({ ok: true, runs: items });
});

r.get('/runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const run = await prisma.syncRun.findUnique({ where: { id } });
  res.json(run);
});

r.get('/runs/:id/logs', async (req, res) => {
  const id = Number(req.params.id);
  const afterId = req.query.after ? Number(req.query.after) : 0;
  const logs = await prisma.syncLog.findMany({
    where: { runId: id, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: 'asc' },
    take: 200,
  });
  res.json(logs);
});

export default r;
