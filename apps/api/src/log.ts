// apps/api/src/log.ts
import { prisma } from './prisma';
import { instanceId } from './instance';
import { createLogger } from './lib/logger';

type Json = Record<string, any>;
const nowIso = () => new Date().toISOString();
const syslog = createLogger({ scope: 'db.runlog' });

export async function startRun(kind: string, initialStats: Json = {}) {
  const stats = {
    ...initialStats,
    instanceId,
    heartbeatAt: nowIso(),
  };
  try {
    const run = await prisma.syncRun.create({
      data: { kind, status: 'running', stats: JSON.stringify(stats) },
    });
    syslog.info('run started', 'run.start', { runId: run.id, kind, statsKeys: Object.keys(initialStats || {}) });
    return run;
  } catch (e: any) {
    syslog.error('run start failed', 'run.start.fail', { kind, err: e?.message || String(e) });
    throw e;
  }
}

export async function endRun(
  runId: number,
  status: 'ok' | 'error',
  message?: string,
  patchStats: Json = {},
) {
  try {
    const run = await prisma.syncRun.findUnique({ where: { id: runId } });
    const stats = safeMerge(run?.stats, { ...patchStats, heartbeatAt: nowIso() });
    await prisma.syncRun.update({
      where: { id: runId },
      data: {
        status,
        message: message || undefined,
        stats: JSON.stringify(stats),
        finishedAt: new Date(),
      },
    });
    syslog.info('run finished', 'run.end', { runId, status, hasMessage: !!message });
  } catch (e: any) {
    syslog.error('run finish failed', 'run.end.fail', { runId, status, err: e?.message || String(e) });
    throw e;
  }
}

export async function patchRunStats(runId: number, patch: Json) {
  try {
    const run = await prisma.syncRun.findUnique({ where: { id: runId } });
    const stats = safeMerge(run?.stats, { ...patch, heartbeatAt: nowIso() });
    await prisma.syncRun.update({
      where: { id: runId },
      data: { stats: JSON.stringify(stats) },
    });
    syslog.debug('run stats patched', 'run.patch', { runId, keys: Object.keys(patch || {}) });
  } catch (e: any) {
    syslog.error('run patch failed', 'run.patch.fail', { runId, err: e?.message || String(e) });
    throw e;
  }
}


export async function log(
  runId: number | null | undefined,
  level: 'info'|'warn'|'error'|'debug',
  message: string,
  data?: any
) {
  try {
    const payload: any = {
      level,
      message,
      data: data != null ? JSON.stringify(data) : null,
    };
    if (typeof runId === 'number') {
      payload.runId = runId; // только если есть валидный runId
    }
    await prisma.syncLog.create({ data: payload });
  } catch (e: any) {
    // чтобы сам логгер не падал маршруты: просто выведем в консоль
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'run log insert failed',
      scope: 'db.runlog',
      evt: 'run.log.insert.fail',
      runId: runId ?? null,
      err: String(e?.message || e),
    }));
  }
}

function safeMerge(statsStr?: string | null, patch: Json = {}) {
  let base: Json = {};
  try {
    base = statsStr ? JSON.parse(statsStr) : {};
  } catch (e: any) {
    syslog.warn('stats parse failed, using empty base', 'run.stats.parse.fail', { err: e?.message || String(e) });
  }
  return { ...base, ...patch };
}
