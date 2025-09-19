// apps/api/src/workers/_common.ts
import { prisma } from '../prisma';
import { startRun, endRun, patchRunStats, log as dblog } from '../log';

export function nkey(s: string) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

type Lvl = 'info'|'warn'|'error'|'debug';
export async function ev(runId: number, level: Lvl, event: string, data?: any) {
  await dblog(runId, level, event, { event, ...(data ?? {}) });
}
export function now() { return Date.now(); }
export function elapsedMs(t0: number) { return Date.now() - t0; }

export const evStart  = (runId: number, meta?: any) => ev(runId, 'info',  'start',  meta);
export const evFinish = (runId: number, meta?: any) => ev(runId, 'info',  'finish', meta);
export const evError  = (runId: number, meta?: any) => ev(runId, 'error', 'error',  meta);

export async function getRunWithRetry(id: number, tries = 3, ms = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await prisma.syncRun.findUnique({ where: { id } });
      if (r) return r;
    } catch {}
    await new Promise(r => setTimeout(r, ms));
  }
  return prisma.syncRun.findUnique({ where: { id } });
}

function parseRunStats(stats?: string | null): any {
  try { return stats ? JSON.parse(stats) : {}; } catch { return {}; }
}

export async function isCancelled(runId: number): Promise<boolean> {
  const r = await getRunWithRetry(runId);
  const s = parseRunStats(r?.stats);
  return !!s?.cancel;
}

export async function bailIfCancelled(runId: number, phase?: string) {
  if (await isCancelled(runId)) {
    await dblog(runId, 'warn', 'Cancelled by user', phase ? { phase } : undefined);
    await patchRunStats(runId, { phase: 'cancelled' });
    await endRun(runId, 'error', 'Cancelled by user');
    return true;
  }
  return false;
}

export async function startRunWithKind(kind: string, initialStats: any, reuseRunId?: number) {
  if (reuseRunId) return { id: reuseRunId };
  return startRun(kind, initialStats);
}

export { prisma, startRun, endRun, patchRunStats, dblog };
