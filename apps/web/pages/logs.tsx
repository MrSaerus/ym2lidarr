// apps/web/pages/logs.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import Footer from '../components/Footer';

type RunShort = {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  message?: string | null;
  kind?: string | null;
};

type LogItem = {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug' | string;
  message: string;
  data?: any;
  runId: number;
};

type Stats = Partial<{
  totalArtists: number | string;
  matchedArtists: number | string;
  totalAlbums: number | string;
  matchedAlbums: number | string;
}>;

type LegacyOverview = {
  artists?: { total?: number | string; matched?: number | string; unmatched?: number | string; found?: number | string };
  albums?:  { total?: number | string; matched?: number | string; unmatched?: number | string; found?: number | string };
  lastRun?: { id: number; status?: string; startedAt?: string | null } | null;
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const coalesceNum = (...vals: any[]) => {
  for (const v of vals) {
    if (v !== undefined && v !== null) {
      const n = toNum(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
};
function normalizeStats(raw: any): Required<Stats> {
  if (raw && (raw.artists || raw.albums)) {
    const d = raw as LegacyOverview;

    const aMatched = coalesceNum(d.artists?.matched, d.artists?.found);
    const aTotal   = (() => {
      const t = coalesceNum(d.artists?.total);
      if (t) return t;
      const u = coalesceNum(d.artists?.unmatched);
      return aMatched || u ? aMatched + u : 0;
    })();

    const rgMatched = coalesceNum(d.albums?.matched, d.albums?.found);
    const rgTotal   = (() => {
      const t = coalesceNum(d.albums?.total);
      if (t) return t;
      const u = coalesceNum(d.albums?.unmatched);
      return rgMatched || u ? rgMatched + u : 0;
    })();

    return {
      totalArtists: aTotal,
      matchedArtists: Math.min(aMatched, aTotal),
      totalAlbums: rgTotal,
      matchedAlbums: Math.min(rgMatched, rgTotal),
    };
  }

  const s = raw as Stats;
  const totalArtists   = coalesceNum((s as any).totalArtists,   (s as any).artistsTotal, (s as any).artists?.total);
  const matchedArtists = coalesceNum((s as any).matchedArtists, (s as any).artistsMatched, (s as any).artists?.matched, (s as any).artists?.found);
  const totalAlbums    = coalesceNum((s as any).totalAlbums,    (s as any).albumsTotal,  (s as any).albums?.total);
  const matchedAlbums  = coalesceNum((s as any).matchedAlbums,  (s as any).albumsMatched, (s as any).albums?.matched, (s as any).albums?.found);

  return {
    totalArtists,
    matchedArtists: Math.min(matchedArtists, totalArtists),
    totalAlbums,
    matchedAlbums: Math.min(matchedAlbums, totalAlbums),
  };
}

function parseData(l: LogItem): any {
  const v = l.data;
  if (v == null) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  return v;
}

export default function LogsPage() {
  const [runs, setRuns] = useState<RunShort[]>([]);
  const [sel, setSel] = useState<number | null>(null);

  const [items, setItems] = useState<LogItem[]>([]);
  const [after, setAfter] = useState(0);
  const [auto, setAuto] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setStats] = useState<Required<Stats> | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);
  const tick = useRef<number | null>(null);
  const prevCount = useRef(0);

  const loadRuns = useCallback(async () => {
    try {
      const r = await api<{ ok: boolean; runs: RunShort[] }>('/api/runs?limit=30');
      if (r.ok) {
        setRuns(r.runs);
        setSel((prev) => prev ?? (r.runs[0]?.id ?? null));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const raw = await api<any>('/api/stats');
      setStats(normalizeStats(raw));
    } catch {
      /* ignore */
    }
  }, []);

  async function pull() {
    if (!sel) return;
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; items: LogItem[]; nextAfter: number }>(
          `/api/runs/${sel}/logs?after=${after}&limit=200`
      );
      if (r.ok) {
        if (r.items?.length) setItems((p) => [...p, ...r.items]);
        setAfter(r.nextAfter ?? after);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => {
    loadRuns();
    loadStats();
  }, [loadRuns, loadStats]);

  // reset buffer when run changes
  useEffect(() => {
    setItems([]);
    setAfter(0);
    prevCount.current = 0;
  }, [sel]);

  useEffect(() => {
    if (!auto || !sel) { if (tick.current) clearInterval(tick.current); tick.current = null; return; }
    tick.current = window.setInterval(() => pull(), 2000) as unknown as number;
    return () => { if (tick.current) clearInterval(tick.current); tick.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, sel, after]);

  const visItems = useMemo(() => (showDebug ? items : items.filter(i => i.level !== 'debug')), [items, showDebug]);

  useEffect(() => {
    if (!auto) return;
    if (visItems.length > prevCount.current) {
      prevCount.current = visItems.length;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    }
  }, [visItems, auto]);

  const finishLine = useMemo(() => items.slice().reverse().find(i => parseData(i).event === 'finish'), [items]);

  // chips + уровни
  const pill = (t: string, cls: string) => (
      <span className={`inline-flex items-center rounded px-1.5 py-[2px] text-[11px] ${cls}`}>{t}</span>
  );
  const lvl = (s: string) =>
      ({
        info:  'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/30',
        warn:  'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
        error: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
        debug: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
      }[s] || 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30');

  return (
      <div className="min-h-screen text-slate-100">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
          {/* controls */}
          <div className="toolbar flex-wrap gap-2">
            <span className="text-sm text-gray-400">Run:</span>
            <select
                className="bg-slate-900 text-slate-100 text-sm border border-slate-700 rounded px-2 py-1"
                value={sel ?? ''}
                onChange={(e) => setSel(Number(e.target.value) || null)}
            >
              {!runs.length && <option value="">No runs yet</option>}
              {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.id} • {r.kind || '—'} • {r.status} • {new Date(r.startedAt).toLocaleString()}
                  </option>
              ))}
            </select>

            <button className="btn btn-outline" onClick={loadRuns}>Refresh runs</button>

            <label className="ml-2 inline-flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto follow
            </label>

            <label className="ml-2 inline-flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
              Show debug
            </label>

            <button className="btn btn-outline" onClick={() => pull()} disabled={loading || !sel}>Pull once</button>
            <button
                className="btn btn-outline"
                onClick={() => { setItems([]); setAfter(0); prevCount.current = 0; }}
                disabled={!sel}
            >
              Clear
            </button>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-2 text-sm text-slate-300 sticky top-0 bg-slate-900/80 backdrop-blur">
              {sel ? `Run #${sel}` : 'Live Logs'}
              {finishLine && (
                <span className="ml-3 text-xs text-slate-400">
                  {(() => {
                    const d = parseData(finishLine);
                    const k = d.kind || '';
                    if (k === 'mb.match') return <>• finished: MB Match ({d.target || 'both'})</>;
                    if (k === 'lidarr.push' || k === 'lidarr.push.ex') {
                      const tt = d.totals || {};
                      return <>• finished: {d.target || 'items'} — ok {toNum(tt.ok)}, failed {toNum(tt.failed)}, skipped {toNum(tt.skipped)}</>;
                    }
                    if (k.startsWith('lidarr.pull')) {
                      if (d.totalArtists != null || d.totalAlbums != null)
                        return <>• finished: artists {toNum(d.totalArtists)}, albums {toNum(d.totalAlbums)}</>;
                      return <>• finished</>;
                    }
                    if (d.added != null || d.failed != null && d.target)
                      return <>• finished: added {toNum(d.added)} {d.target}, failed {toNum(d.failed)}</>;
                    return <>• finished</>;
                  })()}
                </span>
              )}
            </div>

            <div ref={scroller} className="max-h-[70vh] overflow-auto">
              <ul className="log-list">
                {visItems.length === 0 && (
                    <li className="px-4 py-10 text-center text-slate-500">
                      {loading ? 'Loading…' : sel ? 'No logs yet for this run.' : 'Select a run to view logs.'}
                    </li>
                )}

                {visItems.map((l) => (
                    <li key={l.id} className="px-3 py-1.5 flex items-center gap-3">
                      <time className="w-44 shrink-0 font-mono text-[12px] text-slate-300 whitespace-nowrap">
                        {new Date(l.ts).toLocaleString()}
                      </time>
                      {pill(l.level, lvl(l.level))}
                      <div className="min-w-0 truncate text-sm">{l.message}</div>
                    </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-400">
              Showing {visItems.length} lines • After id = {after}
            </div>
          </div>
        </main>
        <Footer />
      </div>
  );
}
