// apps/api/src/routes/sync.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const router = Router();

// Поддержим и с префиксом, и без него — на случай app.use('/api', router) ИЛИ app.use(router)
const PREFIXES = ['', '/api'];

function toInt(x: any, def: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}
function safeParseJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
function mapRun(run: any) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    message: run.message ?? null,
    kind: (run as any).kind ?? null, // если в схеме есть поле kind
  };
}

// -------- РОУТЫ --------

// Список последних запусков (для селектора на странице логов)
for (const p of PREFIXES) {
  router.get(`${p}/runs`, async (req, res) => {
    const limitRaw = toInt(req.query.limit, 20);
    // небольшой предохранитель: 1..200
    const limit = Math.min(200, Math.max(1, limitRaw));

    const runs = await prisma.syncRun.findMany({
      orderBy: { id: 'desc' },
      take: limit,
    });
    return res.json({ ok: true, runs: runs.map(mapRun) });
  });
}

// Последний запуск; если нет — ok:false (НЕ 400)
for (const p of PREFIXES) {
  router.get(`${p}/runs/latest`, async (_req, res) => {
    const run = await prisma.syncRun.findFirst({ orderBy: { id: 'desc' } });
    if (!run) return res.json({ ok: false, reason: 'no-runs' });
    return res.json({ ok: true, run: mapRun(run) });
  });
}

// Логи запуска инкрементально по id (id > after)
for (const p of PREFIXES) {
  router.get(`${p}/runs/:id/logs`, async (req, res) => {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      return res.status(400).json({ ok: false, error: 'bad runId' });
    }
    const after = toInt(req.query.after, 0);
    const limitRaw = toInt(req.query.limit, 200);
    const limit = Math.min(500, Math.max(1, limitRaw)); // 1..500

    const items = await prisma.syncLog.findMany({
      where: { runId, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, ts: true, level: true, message: true, data: true, runId: true },
    });

    const mapped = items.map((l) => ({
      id: l.id,
      ts: l.ts,
      level: l.level,
      message: l.message,
      data: safeParseJson(l.data), // отдаём уже распарсенным объектом
      runId: l.runId,
    }));
    const nextAfter = mapped.length ? mapped[mapped.length - 1].id : after;

    return res.json({ ok: true, items: mapped, nextAfter });
  });
}

export default router;
