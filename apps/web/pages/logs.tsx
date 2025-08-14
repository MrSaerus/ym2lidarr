import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';

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

function mbArtistUrl(id?: string) { return id ? `https://musicbrainz.org/artist/${id}` : undefined; }
function mbRGUrl(id?: string)     { return id ? `https://musicbrainz.org/release-group/${id}` : undefined; }
function ymSearchUrl(q?: string)  { return q ? `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` : undefined; }

export default function LogsPage() {
  const [runs, setRuns] = useState<RunShort[]>([]);
  const [sel, setSel] = useState<number | null>(null);

  const [items, setItems] = useState<LogItem[]>([]);
  const [after, setAfter] = useState(0);
  const [auto, setAuto] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Required<Stats> | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);
  const tick = useRef<number | null>(null);
  const prevCount = useRef(0);

  useEffect(() => { loadRuns(); loadStats(); }, []);

  async function loadRuns() {
    try {
      const r = await api<{ ok: boolean; runs: RunShort[] }>('/api/runs?limit=30');
      if (r.ok) {
        setRuns(r.runs);
        if (!sel && r.runs.length) setSel(r.runs[0].id);
      }
    } catch {/* ignore */}
  }

  async function loadStats() {
    try {
      const raw = await api<any>('/api/stats');
      setStats(normalizeStats(raw));
    } catch {/* ignore */}
  }

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
    if (!sel) return;
    setItems([]); setAfter(0);
    pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const startLine  = useMemo(() => items.find(i => parseData(i).event === 'start'), [items]);
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

  const lineText = (l: LogItem) => {
    const d = parseData(l);

    if (l.message?.startsWith('Artist skip (cool-down)')) {
      return <>Artist skip (cool-down) — <b>{d.name || d.artist || '—'}</b>{d.song ? <> — <i>{d.song}</i></> : null}</>;
    }
    if (l.message?.startsWith('Album skip (cool-down)')) {
      return <>Album skip (cool-down) — <b>{d.artist || '—'}</b>{d.title ? <> — <i>{d.title}</i></> : null}</>;
    }

    switch (d.event) {
      case 'artist:found':
        return <>
          ✓ Found artist — <b>{d.name}</b>
          {d.mbid && <a className="text-indigo-300 underline ml-1" href={mbArtistUrl(d.mbid)} target="_blank" rel="noreferrer">MB</a>}
          <a className="text-indigo-300 underline ml-1" href={ymSearchUrl(d.name)} target="_blank" rel="noreferrer">YM</a>
        </>;
      case 'artist:not_found':
        return <>✗ Artist not found — <b>{d.name}</b> <a className="text-indigo-300 underline ml-1" href={ymSearchUrl(d.name)} target="_blank" rel="noreferrer">YM</a></>;
      case 'album:found':
        return <>
          ✓ Found album — <b>{d.artist}</b> — <i>{d.title}</i>
          {d.mbid && <a className="text-indigo-300 underline ml-1" href={mbRGUrl(d.mbid)} target="_blank" rel="noreferrer">MB</a>}
          <a className="text-indigo-300 underline ml-1" href={ymSearchUrl(`${d.artist} ${d.title}`)} target="_blank" rel="noreferrer">YM</a>
        </>;
      case 'album:not_found':
        return <>✗ Album not found — <b>{d.artist}</b> — <i>{d.title}</i> <a className="text-indigo-300 underline ml-1" href={ymSearchUrl(`${d.artist} ${d.title}`)} target="_blank" rel="noreferrer">YM</a></>;
      case 'start':
        return <>Fetch likes from Yandex: artists {d.artists}, albums {d.albums} (driver: {d.driver})</>;
      case 'finish':
        return d.target
            ? <>Added to Lidarr: {d.added} new {d.target}, failed {d.failed}</>
            : <>Matching finished — artists {d.artists?.matched}/{d.artists?.total} (skipped {d.artists?.skipped}); albums {d.albums?.matched}/{d.albums?.total} (skipped {d.albums?.skipped})</>;
      default:
        return <>{l.message}</>;
    }
  };

  return (
      <div className="min-h-screen text-slate-100">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
          {/* controls — как на других страницах */}
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
                    #{r.id} • {r.status} • {new Date(r.startedAt).toLocaleString()}
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

          {/* summary — такие же «панели», как на других страницах */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="panel p-3">
              <div className="text-xs text-slate-400 mb-1">Yandex likes (from log):</div>
              {startLine ? (
                  <div className="flex gap-2 items-center">
                    {pill('Artists ' + (parseData(startLine).artists ?? '—'), 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30')}
                    {pill('Albums ' + (parseData(startLine).albums ?? '—'), 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30')}
                    <span className="text-xs text-slate-500">driver: {parseData(startLine).driver}</span>
                  </div>
              ) : (
                  <div className="text-sm text-slate-500">No start line yet.</div>
              )}
            </div>

            <div className="panel p-3">
              <div className="text-xs text-slate-400 mb-1">Database (current):</div>
              <div className="flex gap-2 items-center">
                {pill(`Matched artists ${toNum(stats?.matchedArtists ?? 0)} / ${toNum(stats?.totalArtists ?? 0)}`, 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30')}
                {pill(`Matched albums ${toNum(stats?.matchedAlbums ?? 0)} / ${toNum(stats?.totalAlbums ?? 0)}`, 'bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30')}
              </div>
            </div>
          </section>

          <div className="panel overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-2 text-sm text-slate-300 sticky top-0 bg-slate-900/80 backdrop-blur">
              {sel ? `Run #${sel}` : 'Live Logs'}
              {finishLine && (
                  <span className="ml-3 text-xs text-slate-400">
                {parseData(finishLine).target ? (
                    <>• finished summary: added {parseData(finishLine).added} {parseData(finishLine).target}, failed {parseData(finishLine).failed}</>
                ) : (
                    <>• matching summary: artists {parseData(finishLine).artists?.matched}/{parseData(finishLine).artists?.total}, albums {parseData(finishLine).albums?.matched}/{parseData(finishLine).albums?.total}</>
                )}
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
                      <div className="min-w-0 truncate text-sm">{lineText(l)}</div>
                    </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-400">
              Showing {visItems.length} lines • After id = {after}
            </div>
          </div>
        </main>
      </div>
  );
}
