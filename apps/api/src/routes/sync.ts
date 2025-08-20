// apps/api/src/routes/sync.ts
import { Router } from 'express';

import { startRun } from '../log';
import { prisma } from '../prisma';
import { runYandexPull, runLidarrPull, runMbMatch, runLidarrPush } from '../workers';

const r = Router();

r.post('/yandex/pull', async (req, res) => {
  const override =
      typeof req.body?.token === 'string' && req.body.token.trim()
          ? req.body.token.trim()
          : undefined;

  // Унифицируем kind с воркером: 'yandex'
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

r.post('/lidarr/pull', async (_req, res) => {
  // Унифицируем kind с воркером: 'lidarr'
  const run = await startRun('lidarr', { phase: 'start', total: 0, done: 0 });
  runLidarrPull(run.id).catch(() => {});
  res.json({ started: true, runId: run.id });
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

r.post('/lidarr', async (_req, res) => {
  // Воркер сам создаёт Run внутри, поэтому здесь не создаём дубликат
  runLidarrPush().catch(() => {});
  res.json({ started: true });
});

// Список последних забегов
r.get('/runs', async (req, res) => {
  const kind = (req.query.kind as string) || undefined;
  const items = await prisma.syncRun.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  res.json(items);
});

// Детали одного забега (со stats/message)
r.get('/runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const run = await prisma.syncRun.findUnique({ where: { id } });
  res.json(run);
});

// Логи забега (можно запрашивать порциями)
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
