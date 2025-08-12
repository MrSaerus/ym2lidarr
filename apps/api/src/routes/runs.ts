import { Router } from 'express';

import { prisma } from '../prisma';

const r = Router();

function parseStats(stats?: string | null) {
  if (!stats) return null;
  try {
    return JSON.parse(stats);
  } catch {
    return null;
  }
}

// GET /api/runs/:id — вернуть run
r.get('/:id', async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ ok: false, error: 'Bad id' });

  const run = await prisma.syncRun.findUnique({ where: { id } });
  if (!run) return res.status(404).json({ ok: false, error: 'Not found' });

  res.json({
    id: run.id,
    kind: run.kind,
    status: run.status,
    message: run.message ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    stats: parseStats(run.stats),
  });
});

// GET /api/runs/:id/logs?after=0&limit=200 — инкрементальная подгрузка логов
r.get('/:id/logs', async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ ok: false, error: 'Bad id' });

  const after = Math.max(0, parseInt(String(req.query?.after ?? '0'), 10));
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit ?? '200'), 10)));

  const rows = await prisma.syncLog.findMany({
    where: { runId: id, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' },
    take: limit,
  });

  res.json({
    items: rows.map((l) => {
      // В БД поле называется data (JSON-строка). Для фронта отдаём как "meta".
      const raw = (l as any).meta ?? (l as any).data ?? null;
      let meta: any = undefined;
      if (raw != null) {
        try {
          meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          meta = raw;
        }
      }
      return {
        id: l.id,
        ts: l.ts as any, // Date → ISO уедет при сериализации
        level: l.level as any, // 'debug'|'info'|'warn'|'error'
        message: l.message,
        meta,
      };
    }),
  });
});

export default r;
