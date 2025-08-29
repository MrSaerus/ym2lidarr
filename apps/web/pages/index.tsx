// apps/web/pages/index.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';

type CronItem = {
  key: 'yandexPull'|'yandexMatch'|'yandexPush'|'lidarrPull'|'customMatch'|'customPush'|'backup';
  title: string;
  enabled: boolean;
  cron?: string | null;
  valid: boolean;
  nextRun?: string | null; // ISO
  running: boolean;
};

type CountBlock = { total: number; matched: number; unmatched: number };

type LatestYA = { id: number; title: string; artistName: string; year?: number | null; yandexUrl?: string; mbUrl?: string; };
type LatestLA = { id: number; title: string; artistName: string; added: string | null; lidarrUrl?: string; mbUrl?: string; };
type LatestYArtist = { id: number; name: string; yandexUrl?: string; mbUrl?: string; };
type LatestLArtist = { id: number; name: string; added?: string | null; lidarrUrl?: string; mbUrl?: string; };
type LatestCArtist = { id: number; name: string; mbUrl?: string; createdAt?: string | null; hasLidarr?: boolean; lidarrUrl?: string | null; };

type StatsResp = {
  yandex?: { artists: CountBlock; albums: CountBlock; latestAlbums?: LatestYA[]; latestArtists?: LatestYArtist[]; };
  lidarr?: { artists: CountBlock; albums: CountBlock; latestAlbums?: LatestLA[]; latestArtists?: LatestLArtist[]; };
  custom?: { artists: CountBlock; latestArtists?: LatestCArtist[]; };
  // backward-compat
  artists?: { total?: number; found?: number; unmatched?: number };
  albums?: { total?: number; found?: number; unmatched?: number };
  runs?: { yandex?: { active: any; last: any }; lidarr?: { active: any; last: any }; match?: { active: any; last: any }; };
};

type RunShort = {
  id: number;
  status: 'running' | 'ok' | 'error' | string;
  startedAt: string;
  finishedAt: string | null;
  message?: string | null;
  kind?: string | null;
};

type ApiRunsResp = { ok?: boolean; runs?: RunShort[] };

const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (matched: number, total: number) => {
  const t = toNum(total), m = toNum(matched);
  return t > 0 ? m / t : 0;
};

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'ok'|'warn'|'err'|'muted' }) {
  const cls =
      tone === 'ok'
          ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
          : tone === 'warn'
              ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
              : tone === 'err'
                  ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
                  : 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30';
  return <span className={`inline-flex items-center rounded px-2 py-[2px] text-xs ${cls}`}>{children}</span>;
}

/* ---------------- helpers ---------------- */

async function tryPostMany<T = any>(paths: string[], body?: any): Promise<T> {
  let lastErr: any;
  for (const p of paths) {
    try {
      return await api<T>(p, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All endpoints failed');
}

/** Ключи busy-состояний под конкретные кнопки */
type BusyKey =
    | 'customMatch'
    | 'customPush'
    | 'yandexPull'
    | 'yandexMatchArtists'
    | 'yandexMatchAlbums'
    | 'yandexPushArtists'
    | 'yandexPushAlbums'
    | 'lidarrPullArtists'
    | 'lidarrPullAlbums';

/** Какие kind из бекенда соответствуют какой кнопке */
const KIND_MAP: Record<BusyKey, string[]> = {
  customMatch:        ['custom.match.all'],
  customPush:         ['custom.push.all'],
  yandexPull:         ['yandex.pull.all'],
  yandexMatchArtists: ['yandex.match.artists', 'yandex.match.all'],
  yandexMatchAlbums:  ['yandex.match.albums', 'yandex.match.all'],
  yandexPushArtists:  ['yandex.push.artists','yandex.push.all'],
  yandexPushAlbums:   ['yandex.push.albums','yandex.push.all'],
  lidarrPullArtists:  ['lidarr.pull.artists','lidarr.pull.all','lidarr'], // 'lidarr' — на случай старых раннов
  lidarrPullAlbums:   ['lidarr.pull.albums','lidarr.pull.all','lidarr'],
};

export default function OverviewPage() {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [latest, setLatest] = useState<RunShort | null>(null);
  const [runs, setRuns] = useState<RunShort[]>([]);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // оптимистичные busy-флаги (моментально после клика)
  const [optimisticBusy, setOptimisticBusy] = useState<Partial<Record<BusyKey, boolean>>>({});
  const busyTimers = useRef<Record<BusyKey, any>>({} as any);

  const [cronJobs, setCronJobs] = useState<CronItem[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  const loadScheduler = useCallback(async () => {
    try {
      const r = await api<{ok:boolean;jobs:CronItem[]}>('/api/settings/scheduler');
      if (r?.ok && Array.isArray(r.jobs)) setCronJobs(r.jobs);
    } catch {}
  }, []);

  useEffect(() => {
    loadScheduler();
    const t1 = setInterval(() => setNow(Date.now()), 1000);
    const t2 = setInterval(loadScheduler, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadScheduler]);

  const humanCountdown = (iso?: string | null) => {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return 'soon';
    const sec = Math.floor(ms / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  const markBusy = useCallback((key: BusyKey) => {
    setOptimisticBusy(prev => ({ ...prev, [key]: true }));
    if (busyTimers.current[key]) clearTimeout(busyTimers.current[key]);
    busyTimers.current[key] = setTimeout(() => {
      setOptimisticBusy(prev => ({ ...prev, [key]: false }));
      busyTimers.current[key] = null;
    }, 30000);
  }, []);

  const clearBusy = useCallback((key: BusyKey) => {
    if (busyTimers.current[key]) {
      clearTimeout(busyTimers.current[key]);
      busyTimers.current[key] = null;
    }
    setOptimisticBusy(prev => ({ ...prev, [key]: false }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStats(await api<StatsResp>('/api/stats')); setMsg(''); }
    catch (e: any) { setMsg(e?.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await api<ApiRunsResp>('/api/runs?limit=20');
      const arr = r?.runs ?? [];
      setRuns(arr.filter((x) => x?.status === 'running'));
      setLatest(arr[0] ?? null);
    } catch {}
  }, []);

  useEffect(() => {
    load(); loadRuns();
    const t = setInterval(loadRuns, 5000);
    return () => clearInterval(t);
  }, [load, loadRuns]);

  // серверные busy-флаги (по real running runs)
  const serverBusySet = useMemo(() => {
    const set = new Set<BusyKey>();
    for (const run of runs) {
      const kind = (run.kind || '').toString();
      (Object.keys(KIND_MAP) as BusyKey[]).forEach((key) => {
        if (KIND_MAP[key].includes(kind)) set.add(key);
      });
    }
    return set;
  }, [runs]);

  // объединяем оптимизм + сервер
  const isBusy = useCallback((key: BusyKey) => {
    return !!optimisticBusy[key] || serverBusySet.has(key);
  }, [optimisticBusy, serverBusySet]);

  // как только сервер подтвердил ран — снимаем оптимистичный флаг (чтобы не завис).
  useEffect(() => {
    (Object.keys(KIND_MAP) as BusyKey[]).forEach((key) => {
      if (serverBusySet.has(key) && optimisticBusy[key]) {
        clearBusy(key);
      }
    });
  }, [serverBusySet, optimisticBusy, clearBusy]);

  // counters
  const cA = { total: toNum(stats?.custom?.artists?.total ?? 0), matched: toNum(stats?.custom?.artists?.matched ?? 0), unmatched: toNum(stats?.custom?.artists?.unmatched ?? 0) };
  const yA = { total: toNum(stats?.yandex?.artists?.total ?? stats?.artists?.total ?? 0), matched: toNum(stats?.yandex?.artists?.matched ?? stats?.artists?.found ?? 0),
    unmatched: toNum(stats?.yandex?.artists?.unmatched ?? ((stats?.artists?.total != null && stats?.artists?.found != null) ? Number(stats.artists.total) - Number(stats.artists.found) : 0)) };
  const yR = { total: toNum(stats?.yandex?.albums?.total ?? stats?.albums?.total ?? 0), matched: toNum(stats?.yandex?.albums?.matched ?? stats?.albums?.found ?? 0),
    unmatched: toNum(stats?.yandex?.albums?.unmatched ?? ((stats?.albums?.total != null && stats?.albums?.found != null) ? Number(stats.albums.total) - Number(stats.albums.found) : 0)) };
  const lA = { total: toNum(stats?.lidarr?.artists?.total ?? 0), matched: toNum(stats?.lidarr?.artists?.matched ?? 0), unmatched: toNum(stats?.lidarr?.artists?.unmatched ?? 0) };
  const lR = { total: toNum(stats?.lidarr?.albums?.total ?? 0), matched: toNum(stats?.lidarr?.albums?.matched ?? 0), unmatched: toNum(stats?.lidarr?.albums?.unmatched ?? 0) };

  const cArtistPct = useMemo(() => pct(cA.matched, cA.total), [cA]);
  const yArtistPct = useMemo(() => pct(yA.matched, yA.total), [yA]);
  const yAlbumPct  = useMemo(() => pct(yR.matched, yR.total), [yR]);
  const lArtistPct = useMemo(() => pct(lA.matched, lA.total), [lA]);
  const lAlbumPct  = useMemo(() => pct(lR.matched, lR.total), [lR]);

  /* ----------------------- actions ----------------------- */

  // Lidarr cache helpers
  async function resyncCacheLidarrArtists() {
    setMsg('Resyncing Lidarr cache (artists)…');
    try { await api('/api/lidarr/resync',{method:'POST'}); setMsg('Lidarr cache resynced'); load(); }
    catch(e:any){ setMsg(`Lidarr resync error: ${e?.message||String(e)}`); }
  }
  async function resyncCacheYandexAlbums() { return pullFromYandexAlbums(); }

  // Lidarr PULL
  async function pullFromLidarrArtists() {
    setMsg('Pull from Lidarr (artists)…');
    markBusy('lidarrPullArtists');
    try {
      await tryPostMany(['/api/sync/lidarr/pull'], { target: 'artists' });
      setMsg('Lidarr pull (artists) started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Lidarr pull error: ${e?.message||String(e)}`); }
  }
  async function pullFromLidarrAlbums() {
    setMsg('Pull from Lidarr (albums)…');
    markBusy('lidarrPullAlbums');
    try {
      await tryPostMany(['/api/sync/lidarr/pull'], { target: 'albums' });
      setMsg('Lidarr pull (albums) started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Lidarr pull error: ${e?.message||String(e)}`); }
  }

  // Yandex PULL — один воркер для обоих блоков
  async function pullFromYandexArtists() {
    setMsg('Pull from Yandex (all)…');
    markBusy('yandexPull');
    try {
      await tryPostMany(['/api/sync/yandex/pull-all']);
      setMsg('Yandex pull started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Yandex pull error: ${e?.message||String(e)}`); }
  }
  async function pullFromYandexAlbums() { return pullFromYandexArtists(); }

  // Yandex MATCH
  async function matchYandexArtists() {
    setMsg('Matching Yandex artists…');
    markBusy('yandexMatchArtists');
    try {
      await tryPostMany(['/api/sync/yandex/match'], { force: false, target: 'artists' });
      setMsg('Match started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Match error: ${e?.message||String(e)}`); }
  }
  async function matchYandexAlbums()  {
    setMsg('Matching Yandex albums…');
    markBusy('yandexMatchAlbums');
    try {
      await tryPostMany(['/api/sync/yandex/match'], { force: false, target: 'albums' });
      setMsg('Match started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Match error: ${e?.message||String(e)}`); }
  }

  // Yandex PUSH
  async function pushYandexToLidarr(target: 'artists'|'albums'|'both') {
    setMsg(`Pushing Yandex ${target} to Lidarr…`);
    if (target === 'artists') markBusy('yandexPushArtists');
    if (target === 'albums')  markBusy('yandexPushAlbums');
    try {
      const r = await tryPostMany<{ok?:boolean;runId?:number;error?:string}>(['/api/sync/yandex/push'], { target });
      const ok = r?.ok===true || typeof r?.runId==='number';
      setMsg(ok ? `Push started (run ${r?.runId ?? 'n/a'})` : `Push failed${r?.error?`: ${r.error}`:''}`);
      setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Push error: ${e?.message||String(e)}`); }
  }

  // One-click Yandex pull-all
  async function runSyncYandex() {
    setMsg('Starting Yandex pull-all…');
    markBusy('yandexPull');
    try {
      const r = await tryPostMany<{ok?:boolean;runId?:number;error?:string}>(['/api/sync/yandex/pull-all']);
      const ok = r?.ok===true || typeof r?.runId==='number';
      setMsg(ok ? `Yandex pull started (run ${r?.runId ?? 'n/a'})` : `Sync failed${r?.error?`: ${r.error}`:''}`);
      setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Sync error: ${e?.message||String(e)}`); }
  }

  // Custom panel
  async function matchCustomAll() {
    setMsg('Matching Custom artists…');
    markBusy('customMatch');
    try {
      await tryPostMany(['/api/sync/custom/match'], { force: false });
      setMsg('Custom match started'); setTimeout(loadRuns, 300);
    } catch (e: any) {
      setMsg(`Custom match error: ${e?.message || String(e)}`);
    }
  }
  async function pushCustomToLidarr() {
    setMsg('Pushing (custom) to Lidarr…');
    markBusy('customPush');
    try {
      await tryPostMany(['/api/sync/custom/push']);
      setMsg('Push started'); setTimeout(loadRuns, 300);
    } catch (e: any) {
      setMsg(`Push error: ${e?.message || String(e)}`);
    }
  }

  // Soft-cancel run
  async function stopRun(id: number) {
    try {
      setStoppingId(id);
      await tryPostMany([`/api/sync/runs/${id}/stop`, `/api/runs/${id}/stop`, `/runs/${id}/stop`]);
      setMsg(`Stop requested for run #${id}`);
      await loadRuns();
    } catch (e: any) {
      setMsg(`Stop failed: ${e?.message || String(e)}`);
    } finally {
      setStoppingId(null);
    }
  }

  return (
      <>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-4 space-y-6">
          <h1 className="h1">Overview</h1>

          {msg ? <div className="badge badge-ok">{msg}</div> : null}

          {/* Latest Custom artists */}
          <section className="panel p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="section-title">Latest Custom artists</div>
              <div className="ml-auto flex items-center gap-2">
                <button
                    className="btn btn-outline"
                    onClick={matchCustomAll}
                    disabled={isBusy('customMatch')}
                >
                  {isBusy('customMatch') ? 'Matching…' : 'Match MB'}
                </button>
                <button
                    className="btn btn-outline"
                    onClick={pushCustomToLidarr}
                    disabled={isBusy('customPush')}
                >
                  {isBusy('customPush') ? 'Pushing…' : 'Push to Lidarr'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.custom?.latestArtists || []).length === 0 ? (
                  <div className="text-sm text-gray-500">No data</div>
              ) : (
                  <table className="w-full text-sm">
                    <thead className="text-gray-400">
                    <tr>
                      <th className="text-left w-10">#</th>
                      <th className="text-left">Artist</th>
                      <th className="text-right links-col-2">Links</th>
                    </tr>
                    </thead>
                    <tbody>
                    {(stats?.custom?.latestArtists || []).slice(0, 5).map((r, i) => {
                      const lidarrHref = r.hasLidarr ? (r.lidarrUrl || `/lidarr?q=${encodeURIComponent(r.name)}`) : undefined;
                      return (
                          <tr key={`c-${r.id}-${i}`} className="border-t border-white/5">
                            <td className="py-1 pr-2">{i + 1}</td>
                            <td className="py-1 pr-2">{r.name || '—'}</td>
                            <td className="py-1 links-col-2">
                              <div className="link-tray link-tray-2 link-tray-right">
                                {lidarrHref
                                    ? <a href={lidarrHref} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--lidarr">Lidarr</a>
                                    : <span className="link-chip placeholder">Lidarr</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--mb">MusicBrainz</a>
                                    : <span className="link-chip placeholder">MusicBrainz</span>}
                              </div>
                            </td>
                          </tr>
                      );
                    })}
                    </tbody>
                  </table>
              )}
            </div>
          </section>

          {/* ALBUMS */}
          <section className="grid gap-4 md:grid-cols-2">
            {/* Yandex albums */}
            <div className="panel p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="section-title">Latest Yandex albums</div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                      className="btn btn-outline"
                      onClick={pullFromYandexAlbums}
                      disabled={isBusy('yandexPull')}
                  >
                    {isBusy('yandexPull') ? 'Pulling…' : 'Pull from YM'}
                  </button>
                  <button
                      className="btn btn-outline"
                      onClick={matchYandexAlbums}
                      disabled={isBusy('yandexMatchAlbums')}
                  >
                    {isBusy('yandexMatchAlbums') ? 'Matching…' : 'Matching YM'}
                  </button>
                  <button
                      className="btn btn-outline"
                      onClick={() => pushYandexToLidarr('albums')}
                      disabled={isBusy('yandexPushAlbums')}
                  >
                    {isBusy('yandexPushAlbums') ? 'Pushing…' : 'Push to Lidarr'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {(stats?.yandex?.latestAlbums || []).length === 0 ? (
                    <div className="text-sm text-gray-500">No data</div>
                ) : (
                    <table className="w-full text-sm">
                      <thead className="text-gray-400">
                      <tr>
                        <th className="text-left w-10">#</th>
                        <th className="text-left">Album</th>
                        <th className="text-left">Artist</th>
                        <th className="text-right links-col-2">Links</th>
                      </tr>
                      </thead>
                      <tbody>
                      {(stats?.yandex?.latestAlbums || []).slice(0, 5).map((r, i) => (
                          <tr key={`ya-${r.id}-${i}`} className="border-t border-white/5">
                            <td className="py-1 pr-2">{i + 1}</td>
                            <td className="py-1 pr-2">{r.title || '—'}</td>
                            <td className="py-1 pr-2">{r.artistName || '—'}</td>
                            <td className="py-1 links-col-2">
                              <div className="link-tray link-tray-2 link-tray-right">
                                {r.yandexUrl
                                    ? <a href={r.yandexUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--ym link-margin-right-5">Yandex</a>
                                    : <span className="link-chip placeholder">Yandex</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--mb">MusicBrainz</a>
                                    : <span className="link-chip placeholder">MusicBrainz</span>}
                              </div>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                )}
              </div>
            </div>

            {/* Lidarr albums */}
            <div className="panel p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="section-title">Latest Lidarr albums</div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                      className="btn btn-outline"
                      onClick={pullFromLidarrAlbums}
                      disabled={isBusy('lidarrPullAlbums')}
                  >
                    {isBusy('lidarrPullAlbums') ? 'Pulling…' : 'Pull from Lidarr'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {(stats?.lidarr?.latestAlbums || []).length === 0 ? (
                    <div className="text-sm text-gray-500">No data</div>
                ) : (
                    <table className="w-full text-sm">
                      <thead className="text-gray-400">
                      <tr>
                        <th className="text-left w-10">#</th>
                        <th className="text-left">Album</th>
                        <th className="text-left">Artist</th>
                        <th className="text-right links-col-2">Links</th>
                      </tr>
                      </thead>
                      <tbody>
                      {(stats?.lidarr?.latestAlbums || []).slice(0, 5).map((r, i) => (
                          <tr key={`la-${r.id}-${i}`} className="border-t border-white/5">
                            <td className="py-1 pr-2">{i + 1}</td>
                            <td className="py-1 pr-2">{r.title || '—'}</td>
                            <td className="py-1 pr-2">{r.artistName || '—'}</td>
                            <td className="py-1 links-col-2">
                              <div className="link-tray link-tray-2 link-tray-right">
                                {r.lidarrUrl
                                    ? <a href={r.lidarrUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--lidarr link-margin-right-5">Lidarr</a>
                                    : <span className="link-chip placeholder">Lidarr</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--mb">MusicBrainz</a>
                                    : <span className="link-chip placeholder">MusicBrainz</span>}
                              </div>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                )}
              </div>
            </div>
          </section>

          {/* ARTISTS */}
          <section className="grid gap-4 md:grid-cols-2">
            {/* Yandex artists */}
            <div className="panel p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="section-title">Latest Yandex artists</div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                      className="btn btn-outline"
                      onClick={pullFromYandexArtists}
                      disabled={isBusy('yandexPull')}
                  >
                    {isBusy('yandexPull') ? 'Pulling…' : 'Pull from YM'}
                  </button>
                  <button
                      className="btn btn-outline"
                      onClick={matchYandexArtists}
                      disabled={isBusy('yandexMatchArtists')}
                  >
                    {isBusy('yandexMatchArtists') ? 'Matching…' : 'Matching YM'}
                  </button>
                  <button
                      className="btn btn-outline"
                      onClick={() => pushYandexToLidarr('artists')}
                      disabled={isBusy('yandexPushArtists')}
                  >
                    {isBusy('yandexPushArtists') ? 'Pushing…' : 'Push to Lidarr'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {(stats?.yandex?.latestArtists || []).length === 0 ? (
                    <div className="text-sm text-gray-500">No data</div>
                ) : (
                    <table className="w-full text-sm">
                      <thead className="text-gray-400">
                      <tr>
                        <th className="text-left w-10">#</th>
                        <th className="text-left">Artist</th>
                        <th className="text-right links-col-2">Links</th>
                      </tr>
                      </thead>
                      <tbody>
                      {(stats?.yandex?.latestArtists || []).slice(0, 5).map((r, i) => (
                          <tr key={`yart-${r.id}-${i}`} className="border-t border-white/5">
                            <td className="py-1 pr-2">{i + 1}</td>
                            <td className="py-1 pr-2">{r.name || '—'}</td>
                            <td className="py-1 links-col-2">
                              <div className="link-tray link-tray-2 link-tray-right">
                                {r.yandexUrl
                                    ? <a href={r.yandexUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--ym link-margin-right-5">Yandex</a>
                                    : <span className="link-chip placeholder">Yandex</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--mb">MusicBrainz</a>
                                    : <span className="link-chip placeholder">MusicBrainz</span>}
                              </div>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                )}
              </div>
            </div>

            {/* Lidarr artists */}
            <div className="panel p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="section-title">Latest Lidarr artists</div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                      className="btn btn-outline"
                      onClick={pullFromLidarrArtists}
                      disabled={isBusy('lidarrPullArtists')}
                  >
                    {isBusy('lidarrPullArtists') ? 'Pulling…' : 'Pull from Lidarr'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {(stats?.lidarr?.latestArtists || []).length === 0 ? (
                    <div className="text-sm text-gray-500">No data</div>
                ) : (
                    <table className="w-full text-sm">
                      <thead className="text-gray-400">
                      <tr>
                        <th className="text-left w-10">#</th>
                        <th className="text-left">Artist</th>
                        <th className="text-right links-col-2">Links</th>
                      </tr>
                      </thead>
                      <tbody>
                      {(stats?.lidarr?.latestArtists || []).slice(0, 5).map((r, i) => (
                          <tr key={`lart-${r.id}-${i}`} className="border-t border-white/5">
                            <td className="py-1 pr-2">{i + 1}</td>
                            <td className="py-1 pr-2">{r.name || '—'}</td>
                            <td className="py-1 links-col-2">
                              <div className="link-tray link-tray-2 link-tray-right">
                                {r.lidarrUrl
                                    ? <a href={r.lidarrUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--lidarr link-margin-right-5">Lidarr</a>
                                    : <span className="link-chip placeholder">Lidarr</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                         className="link-chip link-chip--mb">MusicBrainz</a>
                                    : <span className="link-chip placeholder">MusicBrainz</span>}
                              </div>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                )}
              </div>
            </div>
          </section>

          {/* Custom stats — full width */}
          <section className="panel p-4 space-y-3">
            <div className="text-sm text-gray-500">Custom artists matched</div>
            <div className="text-2xl font-bold">{cA.matched}/{cA.total}</div>
            <ProgressBar value={cArtistPct} color="accent"/>
            <div className="text-xs text-gray-500">Unmatched: {cA.unmatched}</div>
          </section>

          {/* Yandex stats */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Artists matched (Yandex)</div>
              <div className="text-2xl font-bold">{yA.matched}/{yA.total}</div>
              <ProgressBar value={yArtistPct} color="accent"/>
              <div className="text-xs text-gray-500">Unmatched: {yA.unmatched}</div>
            </div>
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Albums matched (Yandex)</div>
              <div className="text-2xl font-bold">{yR.matched}/{yR.total}</div>
              <ProgressBar value={yAlbumPct} color="primary"/>
              <div className="text-xs text-gray-500">Unmatched: {yR.unmatched}</div>
            </div>
          </section>

          {/* Lidarr stats */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Artists (Lidarr, with MBID)</div>
              <div className="text-2xl font-bold">{lA.matched}/{lA.total}</div>
              <ProgressBar value={lArtistPct} color="accent"/>
              <div className="text-xs text-gray-500">Without MBID: {lA.unmatched}</div>
            </div>
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Albums (Lidarr, with RG MBID)</div>
              <div className="text-2xl font-bold">{lR.matched}/{lR.total}</div>
              <ProgressBar value={lAlbumPct} color="primary"/>
              <div className="text-xs text-gray-500">Without RG MBID: {lR.unmatched}</div>
            </div>
          </section>

          {/* Runner & buttons */}
          <section className="panel p-4">
            <div className="text-sm text-gray-500 mb-1">Runner status</div>

            {runs.length > 0 ? (
                <div className="space-y-2">
                  {runs.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="ok">running</Badge>
                          <span>#{r.id}</span>
                          <span>Job: <b>{r.kind ?? 'n/a'}</b></span>
                          <span className="text-gray-400">• started {new Date(r.startedAt).toLocaleString()}</span>
                          {r.message ? <span className="text-gray-400">• {r.message}</span> : null}
                        </div>
                        <div className="shrink-0">
                          <button className="btn btn-outline" onClick={() => stopRun(r.id)}
                                  disabled={stoppingId === r.id}>
                            {stoppingId === r.id ? 'Stopping…' : 'Stop'}
                          </button>
                        </div>
                      </div>
                  ))}
                </div>
            ) : (
                (!latest ? (
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
                ))
            )}
          </section>
          <section className="panel p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="section-title">Scheduler</div>
              <div className="ml-auto text-xs text-gray-400">updates every 30s</div>
            </div>

            {cronJobs.length === 0 ? (
                <div className="text-sm text-gray-400">No jobs configured.</div>
            ) : (
                <table className="w-full text-sm">
                  <thead className="text-gray-400">
                  <tr>
                    <th className="text-left">Job</th>
                    <th className="text-left">Cron</th>
                    <th className="text-left">Enabled</th>
                    <th className="text-left">Valid</th>
                    <th className="text-left">Next run</th>
                    <th className="text-left">In</th>
                    <th className="text-left">State</th>
                  </tr>
                  </thead>
                  <tbody>
                  {cronJobs.map((j) => (
                      <tr key={j.key} className="border-t border-white/5">
                        <td className="py-1 pr-2">{j.title}</td>
                        <td className="py-1 pr-2 font-mono text-xs">{j.cron || '—'}</td>
                        <td className="py-1 pr-2">{j.enabled ? <Badge tone="ok">on</Badge> :
                            <Badge tone="muted">off</Badge>}</td>
                        <td className="py-1 pr-2">{j.cron ? (j.valid ? <Badge tone="ok">valid</Badge> :
                            <Badge tone="err">invalid</Badge>) : <span className="text-gray-500">—</span>}</td>
                        <td className="py-1 pr-2">{j.nextRun ? new Date(j.nextRun).toLocaleString() : '—'}</td>
                        <td className="py-1 pr-2">{humanCountdown(j.nextRun)}</td>
                        <td className="py-1 pr-2">
                          {j.running ? <Badge tone="ok">running</Badge> : <Badge tone="muted">idle</Badge>}
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
            )}
          </section>
          {/* Global actions */}
          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-outline" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="btn btn-outline" onClick={resyncCacheLidarrArtists}>Resync cache Lidarr Artists
              </button>
              <button className="btn btn-outline" onClick={resyncCacheYandexAlbums}>Resync cache Yandex Albums</button>
              <button className="btn btn-outline" onClick={pullFromLidarrArtists}
                      disabled={isBusy('lidarrPullArtists')}>
                {isBusy('lidarrPullArtists') ? 'Pulling…' : 'Pull from Lidarr Artists'}
              </button>
              <button className="btn btn-outline" onClick={pullFromLidarrAlbums} disabled={isBusy('lidarrPullAlbums')}>
                {isBusy('lidarrPullAlbums') ? 'Pulling…' : 'Pull from Lidarr Albums'}
              </button>
              <button className="btn btn-outline" onClick={pullFromYandexArtists} disabled={isBusy('yandexPull')}>
                {isBusy('yandexPull') ? 'Pulling…' : 'Pull from Yandex (All)'}
              </button>
              <button className="btn btn-outline" onClick={matchYandexArtists} disabled={isBusy('yandexMatchArtists')}>
                {isBusy('yandexMatchArtists') ? 'Matching…' : 'Match Yandex Artists'}
              </button>
              <button className="btn btn-outline" onClick={matchYandexAlbums} disabled={isBusy('yandexMatchAlbums')}>
                {isBusy('yandexMatchAlbums') ? 'Matching…' : 'Match Yandex Albums'}
              </button>
              <button className="btn btn-primary" onClick={runSyncYandex} disabled={isBusy('yandexPull')}>
                {isBusy('yandexPull') ? 'Pulling…' : 'Pull-all (Yandex)'}
              </button>
              <button className="btn btn-primary" onClick={() => pushYandexToLidarr('both')}>
                Push Yandex (Both)
              </button>
            </div>
          </section>

          <style jsx>{`
            :root {
              --chip-w: 96px;
              --chip-gap: 6px;
            }

            .links-col-2 {
              width: calc(2 * var(--chip-w) + 1 * var(--chip-gap));
            }

            .link-tray {
              display: flex;
              align-items: center;
              gap: var(--chip-gap);
              white-space: nowrap;
            }

            .link-tray-right {
              justify-content: flex-end;
            }

            .link-tray-2 {
              min-width: calc(2 * var(--chip-w) + 1 * var(--chip-gap));
            }

            .link-tray :global(.link-chip) {
              display: inline-flex;
              justify-content: center;
              width: var(--chip-w);
            }

            .link-tray :global(.link-chip.placeholder) {
              visibility: hidden;
            }

            .link-margin-right-5 {
              margin-right: 5px;
            }

            .btn[disabled] {
              opacity: .6;
              cursor: not-allowed;
            }
          `}</style>
        </main>
      </>
  );
}
