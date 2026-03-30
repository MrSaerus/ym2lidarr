// apps/api/src/utils/progress.ts
export type ProgressInfo = {
  total: number;
  done: number;
  pct: number;
};

export function computeProgress(stats: any): ProgressInfo | null {
  if (!stats || typeof stats !== 'object') return null;

  let total = 0;
  let done = 0;

  const addPair = (t: any, d: any) => {
    const tt = Number(t);
    const dd = Number(d);
    if (!Number.isFinite(tt) || !Number.isFinite(dd)) return;
    if (tt <= 0) return;

    total += tt;
    done += Math.min(Math.max(0, dd), tt);
  };

  if ('total' in stats && 'done' in stats) {
    addPair((stats as any).total, (stats as any).done);
  }

  for (const [k, v] of Object.entries(stats)) {
    if (!k.endsWith('_total')) continue;
    const base = k.slice(0, -'_total'.length);
    const dk = `${base}_done`;
    if (!(dk in stats)) continue;
    addPair(v, (stats as any)[dk]);
  }

  if (total <= 0) return null;

  const pct = Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
  return { total, done, pct };
}
