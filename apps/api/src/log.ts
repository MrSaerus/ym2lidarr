import { prisma } from './prisma';

type Json = Record<string, any>;

export async function startRun(kind: string, initialStats: Json = {}) {
  const run = await prisma.syncRun.create({
    data: { kind, status: 'running', stats: JSON.stringify(initialStats) },
  });
  return run;
}

export async function endRun(
  runId: number,
  status: 'ok' | 'error',
  message?: string,
  patchStats: Json = {},
) {
  const run = await prisma.syncRun.findUnique({ where: { id: runId } });
  const stats = safeMerge(run?.stats, patchStats);
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status,
      message: message || undefined,
      stats: JSON.stringify(stats),
      finishedAt: new Date(),
    },
  });
}

export async function patchRunStats(runId: number, patch: Json) {
  const run = await prisma.syncRun.findUnique({ where: { id: runId } });
  const stats = safeMerge(run?.stats, patch);
  await prisma.syncRun.update({
    where: { id: runId },
    data: { stats: JSON.stringify(stats) },
  });
}

function isLogLevel(x: any): x is 'info' | 'warn' | 'error' | 'debug' {
  return x === 'info' || x === 'warn' || x === 'error' || x === 'debug';
}

export async function log(runId: number, data: Json): Promise<void>;
export async function log(
    runId: number,
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    data?: Json,
): Promise<void>;
export async function log(
    runId: number,
    a: any,
    b?: any,
    c?: Json,
): Promise<void> {
  let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
  let message = 'stats';
  let payload: Json | undefined;

  if (typeof a === 'string') {
    // форма: (runId, level, message, data?)
    level = isLogLevel(a) ? a : 'info';           // <-- ключевая правка
    message = typeof b === 'string' ? b : '';
    payload = c;
  } else {
    // форма: (runId, dataObject)
    payload = a as Json;
  }

  await prisma.syncLog.create({
    data: {
      runId,
      level,
      message,
      data: payload ? JSON.stringify(payload) : null,
    },
  });
}

function safeMerge(statsStr?: string | null, patch: Json = {}) {
  let base: Json = {};
  try {
    base = statsStr ? JSON.parse(statsStr) : {};
  } catch (e) {
    console.warn('[log] write failed', e);
  }
  return { ...base, ...patch };
}
