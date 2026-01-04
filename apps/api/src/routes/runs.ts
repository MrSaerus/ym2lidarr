// apps/api/src/routes/runs.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';

const router = Router();
const log = createLogger({ scope: 'route.runs' });
const PREFIXES = ['', '/api'];

function toInt(x: any, def: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function safeParseJson(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

function safeParseObj(s: string | null): Record<string, any> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function deriveProgress(stats: Record<string, any>): { total: number; done: number; pct: number } | null {
  let total = 0;
  let done = 0;
  let found = false;

  const addPair = (tRaw: any, dRaw: any) => {
    const t = toNum(tRaw);
    const d = toNum(dRaw);
    if (t == null || d == null) return;
    if (t <= 0) return;

    total += t;
    done += Math.min(d, t);
    found = true;
  };

  if (stats.total != null || stats.done != null) addPair(stats.total, stats.done);

  for (const k of Object.keys(stats)) {
    if (!k.endsWith('_total')) continue;
    const dKey = k.replace(/_total$/, '_done');
    if (!(dKey in stats)) continue;
    addPair(stats[k], stats[dKey]);
  }

  if (!found || total <= 0) return null;

  if (done < 0) done = 0;
  if (done > total) done = total;

  const pct = Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
  return { total, done, pct };
}

function mapRun(run: any) {
  const stats = safeParseObj(run.stats ?? null);
  const progress = deriveProgress(stats);

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    message: run.message ?? null,
    kind: (run as any).kind ?? null,
    progress,
  };
}

for (const p of PREFIXES) {
  router.get(`${p}/runs`, async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId, prefix: p || '(none)' } });

    const limitRaw = toInt(req.query.limit, 20);
    const limit = Math.min(200, Math.max(1, limitRaw));
    lg.info('list runs requested', 'runs.list.start', { limit });

    try {
      const runs = await prisma.syncRun.findMany({
        orderBy: { id: 'desc' },
        take: limit,
      });
      lg.debug('fetched runs from DB', 'runs.list.db', { count: runs.length });
      return res.json({ ok: true, runs: runs.map(mapRun) });
    } catch (e: any) {
      lg.error('list runs failed', 'runs.list.fail', { err: e?.message });
      return res.status(500).json({ ok: false, error: 'failed to list runs' });
    }
  });
}

for (const p of PREFIXES) {
  router.get(`${p}/runs/latest`, async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId, prefix: p || '(none)' } });
    lg.info('latest run requested', 'runs.latest.start');

    try {
      const run = await prisma.syncRun.findFirst({ orderBy: { id: 'desc' } });
      if (!run) {
        lg.debug('no runs found', 'runs.latest.empty');
        return res.json({ ok: false, reason: 'no-runs' });
      }
      lg.debug('latest run fetched', 'runs.latest.done', { id: run.id });
      return res.json({ ok: true, run: mapRun(run) });
    } catch (e: any) {
      lg.error('latest run failed', 'runs.latest.fail', { err: e?.message });
      return res.status(500).json({ ok: false, error: 'failed to fetch latest run' });
    }
  });
}

for (const p of PREFIXES) {
  router.get(`${p}/runs/:id`, async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId, prefix: p || '(none)' } });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      lg.warn('bad run id for details', 'runs.details.badid', { raw: req.params.id });
      return res.status(400).json({ ok: false, error: 'bad runId' });
    }

    lg.info('run details requested', 'runs.details.start', { id });

    try {
      const run = await prisma.syncRun.findUnique({ where: { id } });
      lg.debug('run details fetched', 'runs.details.done', { hasRun: !!run });
      return res.json(run);
    } catch (e: any) {
      lg.error('run details failed', 'runs.details.fail', { id, err: e?.message });
      return res.status(500).json({ ok: false, error: 'failed to fetch run' });
    }
  });
}

for (const p of PREFIXES) {
  router.get(`${p}/runs/:id/logs`, async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId, prefix: p || '(none)' } });

    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      lg.warn('bad run id for logs', 'runs.logs.badid', { raw: req.params.id });
      return res.status(400).json({ ok: false, error: 'bad runId' });
    }
    const after = toInt(req.query.after, 0);
    const limitRaw = toInt(req.query.limit, 200);
    const limit = Math.min(500, Math.max(1, limitRaw)); // 1..500

    lg.info('run logs requested', 'runs.logs.start', { runId, after, limit });

    try {
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
        data: safeParseJson(l.data),
        runId: l.runId,
      }));
      const nextAfter = mapped.length ? mapped[mapped.length - 1].id : after;

      lg.debug('run logs fetched', 'runs.logs.done', { count: mapped.length, nextAfter });

      return res.json({ ok: true, items: mapped, nextAfter });
    } catch (e: any) {
      lg.error('run logs failed', 'runs.logs.fail', { runId, err: e?.message });
      return res.status(500).json({ ok: false, error: 'failed to fetch logs' });
    }
  });
}

for (const p of PREFIXES) {
  router.post(`${p}/runs/:id/stop`, async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId, prefix: p || '(none)' } });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      lg.warn('bad run id for stop', 'runs.stop.badid', { raw: req.params.id });
      return res.status(400).json({ ok: false, error: 'bad runId' });
    }

    lg.info('stop run requested', 'runs.stop.start', { id });

    try {
      const run = await prisma.syncRun.findUnique({ where: { id } });
      if (!run) {
        lg.warn('run not found', 'runs.stop.notfound', { id });
        return res.status(404).json({ ok: false, error: 'not found' });
      }
      if (run.status !== 'running') {
        lg.info('run already finished', 'runs.stop.already', { id, status: run.status });
        return res.json({ ok: true, alreadyFinished: true });
      }

      let stats: any = {};
      try { stats = run.stats ? JSON.parse(run.stats) : {}; } catch {}
      stats.cancel = true;

      await prisma.syncRun.update({
        where: { id },
        data: { stats: JSON.stringify(stats), message: 'Cancel requested' },
      });

      lg.info('stop flag set', 'runs.stop.done', { id });
      return res.json({ ok: true });
    } catch (e: any) {
      lg.error('stop run failed', 'runs.stop.fail', { id, err: e?.message });
      return res.status(500).json({ ok: false, error: 'failed to stop run' });
    }
  });
}

export default router;
