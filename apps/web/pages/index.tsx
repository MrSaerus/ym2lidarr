import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';

type LegacyOverview = {
  artists?: { total?: number | string; matched?: number | string; unmatched?: number | string; found?: number | string };
  albums?:  { total?: number | string; matched?: number | string; unmatched?: number | string; found?: number | string };
  lastRun?: { id: number; status?: string; startedAt?: string | null } | null;
};

type Stats = {
  totalArtists?: number | string;
  matchedArtists?: number | string;
  unmatchedArtists?: number | string;
  totalAlbums?: number | string;
  matchedAlbums?: number | string;
  unmatchedAlbums?: number | string;
  lastRun?: { id: number; status?: string; startedAt?: string | null } | null;
};

type SyncResp = { ok?: boolean; runId?: number; error?: string };

// new: короткая модель ран-записи
type RunShort = {
  id: number;
  status: 'running' | 'ok' | 'error' | string;
  startedAt: string;
  finishedAt: string | null;
  message?: string | null;
  kind?: 'yandex' | 'lidarr' | string | null;
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

function normalize(raw: any): Required<Stats> {
  if (raw && (raw.artists || raw.albums)) {
    const d = raw as LegacyOverview;

    const aMatched = coalesceNum(d.artists?.matched, d.artists?.found);
    const aUnmatched = coalesceNum(d.artists?.unmatched);
    let aTotal = coalesceNum(d.artists?.total);
    if (aTotal === 0 && (aMatched || aUnmatched)) aTotal = aMatched + aUnmatched;

    const rgMatched = coalesceNum(d.albums?.matched, d.albums?.found);
    const rgUnmatched = coalesceNum(d.albums?.unmatched);
    let rgTotal = coalesceNum(d.albums?.total);
    if (rgTotal === 0 && (rgMatched || rgUnmatched)) rgTotal = rgMatched + rgUnmatched;

    return {
      totalArtists: aTotal,
      matchedArtists: Math.min(aMatched, aTotal),
      unmatchedArtists: Math.max(aUnmatched || aTotal - aMatched, 0),
      totalAlbums: rgTotal,
      matchedAlbums: Math.min(rgMatched, rgTotal),
      unmatchedAlbums: Math.max(rgUnmatched || rgTotal - rgMatched, 0),
      lastRun: raw.lastRun ?? null,
    };
  }

  const s = raw as Stats;
  let ta = coalesceNum((s as any).totalArtists, (s as any).artistsTotal, (s as any).artists?.total);
  let ma = coalesceNum((s as any).matchedArtists, (s as any).artistsMatched, (s as any).artists?.matched, (s as any).artists?.found);
  let ua = coalesceNum((s as any).unmatchedArtists, (s as any).artistsUnmatched, (s as any).artists?.unmatched);
  if (ta === 0 && (ma || ua)) ta = ma + ua;
  if (ua === 0 && ta && ma && ta >= ma) ua = ta - ma;

  let tr = coalesceNum((s as any).totalAlbums, (s as any).albumsTotal, (s as any).albums?.total);
  let mr = coalesceNum((s as any).matchedAlbums, (s as any).albumsMatched, (s as any).albums?.matched, (s as any).albums?.found);
  let ur = coalesceNum((s as any).unmatchedAlbums, (s as any).albumsUnmatched, (s as any).albums?.unmatched);
  if (tr === 0 && (mr || ur)) tr = mr + ur;
  if (ur === 0 && tr && mr && tr >= mr) ur = tr - mr;

  return {
    totalArtists: ta,
    matchedArtists: Math.min(mr === undefined ? ma : ma, ta),
    unmatchedArtists: Math.max(ua, 0),
    totalAlbums: tr,
    matchedAlbums: Math.min(mr, tr),
    unmatchedAlbums: Math.max(ur, 0),
    lastRun: s.lastRun ?? null,
  };
}

// helper: маленький бейдж
function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'ok'|'warn'|'err'|'muted' }) {
  const cls =
      tone === 'ok'   ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' :
          tone === 'warn' ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30' :
              tone === 'err'  ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30' :
                  'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30';
  return <span className={`inline-flex items-center rounded px-2 py-[2px] text-xs ${cls}`}>{children}</span>;
}

export default function OverviewPage() {
  const [data, setData] = useState<Required<Stats> | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');

  // new: состояние последнего/текущего запуска
  const [latest, setLatest] = useState<RunShort | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await api('/api/stats');
      setData(normalize(raw));
      setMsg('');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // new: загрузка текущего/последнего рана
  const loadLatest = useCallback(async () => {
    try {
      const r = await api<{ ok?: boolean; runs?: RunShort[] }>('/api/runs?limit=1');
      setLatest(r?.runs?.[0] ?? null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
    loadLatest();
    const t = setInterval(loadLatest, 5000);
    return () => clearInterval(t);
  }, [load, loadLatest]);

  const artistPct = useMemo(() => {
    const t = toNum(data?.totalArtists ?? 0);
    const m = toNum(data?.matchedArtists ?? 0);
    return t > 0 ? m / t : 0;
  }, [data]);

  const albumPct = useMemo(() => {
    const t = toNum(data?.totalAlbums ?? 0);
    const m = toNum(data?.matchedAlbums ?? 0);
    return t > 0 ? m / t : 0;
  }, [data]);

  async function runSyncYandex() {
    setMsg('Starting Yandex sync…');
    try {
      const r = await api<SyncResp>('/api/sync/yandex', { method: 'POST' });
      const ok = r?.ok === true || typeof r?.runId === 'number';
      if (ok) {
        setMsg(`Yandex sync started (run ${r?.runId ?? 'n/a'})`);
        setTimeout(loadLatest, 400);
      } else {
        setMsg(`Sync failed${r?.error ? `: ${r.error}` : ''}`);
      }
    } catch (e: any) {
      setMsg(`Sync error: ${e?.message || String(e)}`);
    }
  }

  async function pushToLidarr() {
    setMsg('Pushing to Lidarr…');
    try {
      const r = await api<SyncResp>('/api/sync/lidarr', { method: 'POST' });
      const ok = r?.ok === true || typeof r?.runId === 'number';
      if (ok) {
        setMsg(`Pushed to Lidarr (run ${r?.runId ?? 'n/a'})`);
        setTimeout(loadLatest, 400);
      } else {
        setMsg(`Push failed${r?.error ? `: ${r.error}` : ''}`);
      }
    } catch (e: any) {
      setMsg(`Push error: ${e?.message || String(e)}`);
    }
  }

  return (
      <>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-4 space-y-6">
          <h1 className="h1">Overview</h1>

          {msg ? <div className="badge badge-ok">{msg}</div> : null}

          {/* статистика */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Artists matched</div>
              <div className="text-2xl font-bold">
                {toNum(data?.matchedArtists ?? 0)}/{toNum(data?.totalArtists ?? 0)}
              </div>
              <ProgressBar value={artistPct} color="accent" />
              <div className="text-xs text-gray-500">Unmatched: {toNum(data?.unmatchedArtists ?? 0)}</div>
            </div>

            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Albums matched</div>
              <div className="text-2xl font-bold">
                {toNum(data?.matchedAlbums ?? 0)}/{toNum(data?.totalAlbums ?? 0)}
              </div>
              <ProgressBar value={albumPct} color="primary" />
              <div className="text-xs text-gray-500">Unmatched: {toNum(data?.unmatchedAlbums ?? 0)}</div>
            </div>
          </section>

          {/* NEW: Runner status */}
          <section className="panel p-4">
            <div className="text-sm text-gray-500 mb-1">Runner status</div>
            {!latest ? (
                <div className="text-sm text-gray-400">No runs yet.</div>
            ) : latest.status === 'running' ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="ok">running</Badge>
                  <span>Job: <b>{latest.kind ?? 'n/a'}</b></span>
                  <span className="text-gray-400">• started {new Date(latest.startedAt).toLocaleString()}</span>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="muted">idle</Badge>
                  <span>Last: #{latest.id} • <b>{latest.kind ?? 'n/a'}</b> • {latest.status}</span>
                  <span className="text-gray-400">
                • {new Date(latest.startedAt).toLocaleString()}
                    {latest.finishedAt ? ` → ${new Date(latest.finishedAt).toLocaleString()}` : ''}
              </span>
                  {latest.message ? <span className="text-gray-400">• {latest.message}</span> : null}
                </div>
            )}
          </section>

          {/* кнопки */}
          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-outline" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="btn btn-primary" onClick={runSyncYandex}>
                Sync Yandex
              </button>
              <button className="btn btn-primary" onClick={pushToLidarr}>
                Push to Lidarr
              </button>
              {data?.lastRun ? (
                  <span className="ml-auto text-sm text-gray-500">
                Last run: #{data.lastRun.id} • {data.lastRun.status ?? 'n/a'} •{' '}
                    {data.lastRun.startedAt ? new Date(data.lastRun.startedAt).toLocaleString() : 'n/a'}
              </span>
              ) : null}
            </div>
          </section>
        </main>
      </>
  );
}
