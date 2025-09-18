// apps/web/pages/index.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import ProgressBar from '../components/ProgressBar';
import { api, getApiBase } from '../lib/api';
import { toastOk } from '../lib/toast';
import { ResponsiveTable } from '../components/ResponsiveTable';

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
type LidarrArtistsStats = CountBlock & { downloaded?: number; noDownloads?: number; downloadedPct?: number; };
type LidarrAlbumsStats = CountBlock & { downloaded?: number; noDownloads?: number; downloadedPct?: number; };

type StatsResp = {
  yandex?: { artists: CountBlock; albums: CountBlock; latestAlbums?: LatestYA[]; latestArtists?: LatestYArtist[]; albumsDownloaded?: number; };
  lidarr?: { artists: LidarrArtistsStats; albums: LidarrAlbumsStats; latestAlbums?: LatestLA[]; latestArtists?: LatestLArtist[]; };
  custom?: { artists: CountBlock; latestArtists?: LatestCArtist[]; };

  artists?: { total?: number; found?: number; unmatched?: number; downloaded?: number;  noDownloads?: number; downloadedPct?: number;};
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
  lidarrPullArtists:  ['lidarr.pull.artists','lidarr.pull.all','lidarr'],
  lidarrPullAlbums:   ['lidarr.pull.albums','lidarr.pull.all','lidarr'],
};

export default function OverviewPage() {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [latest, setLatest] = useState<RunShort | null>(null);
  const [runs, setRuns] = useState<RunShort[]>([]);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [ ,setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (msg && msg.trim()) {
      toastOk(msg);
    }
  }, [msg]);

  // оптимистичные busy-флаги (моментально после клика)
  const [optimisticBusy, setOptimisticBusy] = useState<Partial<Record<BusyKey, boolean>>>({});
  const busyTimers = useRef<Record<BusyKey, any>>({} as any);

  const [cronJobs, setCronJobs] = useState<CronItem[]>([]);
  const [now, setNow] = useState<number>(Date.now());
  const [apiBase, setApiBase] = useState<string>('/api'); // SSR fallback (если есть прокси)
  useEffect(() => {
    const b = (getApiBase() || '/api').replace(/\/+$/, '');
    setApiBase(b);
  }, []);
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
  // const lR = { total: toNum(stats?.lidarr?.albums?.total ?? 0), matched: toNum(stats?.lidarr?.albums?.matched ?? 0), unmatched: toNum(stats?.lidarr?.albums?.unmatched ?? 0) };

  const cArtistPct = useMemo(() => pct(cA.matched, cA.total), [cA.matched, cA.total]);
  const yArtistPct = useMemo(() => pct(yA.matched, yA.total), [yA.matched, yA.total]);
  const yAlbumPct  = useMemo(() => pct(yR.matched, yR.total), [yR.matched, yR.total]);
  // const lArtistPct = useMemo(() => pct(lA.matched, lA.total), [lA.matched, lA.total]);
  // const lAlbumPct  = useMemo(() => pct(lR.matched, lR.total), [lR.matched, lR.total]);
  const lAlbumsDownloaded = toNum(stats?.lidarr?.albums?.downloaded ?? 0);
  // const lAlbumsNotDownloaded = lR.total ? Math.max(0, lR.total - lAlbumsDownloaded) : 0;
  const lDownloaded = toNum(stats?.lidarr?.artists?.downloaded ?? stats?.artists?.downloaded ?? 0);
  const lNotDownloaded = lA.total ? Math.round(lA.total - lDownloaded ) : 0;
  const lDownloadedFrac = lA.total ? (lDownloaded / lA.total) : 0;
  const ymAlbumsTotal = toNum(stats?.yandex?.albums?.total ?? stats?.albums?.total ?? 0);
  const ymAlbumsDownloaded = toNum(stats?.yandex?.albumsDownloaded ?? 0);
  const ymAlbumsPct = useMemo(() => pct(ymAlbumsDownloaded, ymAlbumsTotal), [ymAlbumsDownloaded, ymAlbumsTotal]);
  const ymAlbumsNotDownloaded = ymAlbumsTotal-ymAlbumsDownloaded;
    /* ----------------------- actions ----------------------- */

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
      await tryPostMany(['/api/sync/yandex/match'], { force: true, target: 'artists' });
      setMsg('Match started'); setTimeout(loadRuns, 300);
    } catch(e:any){ setMsg(`Match error: ${e?.message||String(e)}`); }
  }
  async function matchYandexAlbums()  {
    setMsg('Matching Yandex albums…');
    markBusy('yandexMatchAlbums');
    try {
      await tryPostMany(['/api/sync/yandex/match'], { force: true, target: 'albums' });
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
  async function pushCustomToLidarrFull() {
    setMsg('Pushing (custom) to Lidarr…');
    markBusy('customPush');
    try {
      await tryPostMany(['/api/sync/custom/push'], { force: true});
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

        {/* All stat exist */}
        <section className="grid gap-4 md:grid-cols-3">
          <div className="panel p-3 sm:p-4 space-y-2 text-center">
            <div className="text-sm text-gray-500">Liked album in Yandex</div>
            <div className="text-3xl font-bold">{ymAlbumsTotal}</div>
          </div>

          <div className="panel p-3 sm:p-4 space-y-2 text-center">
            <div className="text-sm text-gray-500">Downloaded artists in Lidarr</div>
            <div className="text-3xl font-bold">{lDownloaded}</div>
          </div>

          <div className="panel p-3 sm:p-4 space-y-2 text-center">
            <div className="text-sm text-gray-500">Downloaded albums in Lidarr</div>
            <div className="text-3xl font-bold">{lAlbumsDownloaded}</div>
          </div>
        </section>

        {/* Custom artists */}
        <section className="grid gap-4 md:grid-cols-1">
          <div className="panel p-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="section-title">Latest Custom artists</div>
              <div className="sm:ml-auto -mx-2 px-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button className="btn btn-outline shrink-0" onClick={matchCustomAll} disabled={isBusy('customMatch')}>
                  {isBusy('customMatch') ? 'Matching…' : 'Match MB'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={pushCustomToLidarr}
                        disabled={isBusy('customPush')}>
                  {isBusy('customPush') ? 'Pushing…' : 'Push to Lidarr'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={pushCustomToLidarrFull}
                        disabled={isBusy('customPush')}>
                  {isBusy('customPush') ? 'Pushing…' : 'Push to Lidarr Force'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.custom?.latestArtists || []).length === 0 ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <ResponsiveTable>
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
                                : <span className="link-chip invisible select-none" aria-hidden="true">Lidarr</span>}
                              {r.mbUrl
                                ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                     className="link-chip link-chip--mb">MusicBrainz</a>
                                :
                                <span className="link-chip invisible select-none" aria-hidden="true">MusicBrainz</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </div>
          </div>
        </section>

        {/* Yandex & Lidarr albums */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel p-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="section-title">Latest Yandex albums</div>
              <div className="sm:ml-auto -mx-2 px-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button className="btn btn-outline shrink-0" onClick={pullFromYandexAlbums}
                        disabled={isBusy('yandexPull')}>
                  {isBusy('yandexPull') ? 'Pulling…' : 'Pull from YM'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={matchYandexAlbums}
                        disabled={isBusy('yandexMatchAlbums')}>
                  {isBusy('yandexMatchAlbums') ? 'Matching…' : 'Matching YM'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={() => pushYandexToLidarr('albums')}
                        disabled={isBusy('yandexPushAlbums')}>
                  {isBusy('yandexPushAlbums') ? 'Pushing…' : 'Push to Lidarr'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.yandex?.latestAlbums || []).length === 0 ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <ResponsiveTable>
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
                              : <span className="link-chip invisible select-none" aria-hidden="true">Yandex</span>}
                            {r.mbUrl
                              ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                   className="link-chip link-chip--mb">MusicBrainz</a>
                              : <span className="link-chip invisible select-none" aria-hidden="true">MusicBrainz</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </div>
          </div>

          <div className="panel p-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="section-title">Latest Lidarr albums</div>
              <div className="sm:ml-auto -mx-2 px-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button className="btn btn-outline shrink-0" onClick={pullFromLidarrAlbums}
                        disabled={isBusy('lidarrPullAlbums')}>
                  {isBusy('lidarrPullAlbums') ? 'Pulling…' : 'Pull from Lidarr'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.lidarr?.latestAlbums || []).length === 0 ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <ResponsiveTable>
                  <table className="w-full text-sm">
                    <thead className="text-gray-400">
                    <tr>
                      <th className="text-left w-10 hidden sm:table-cell">#</th>
                      <th className="text-left whitespace-nowrap">Album</th>
                      {/* или Artist */}
                      <th className="text-left whitespace-nowrap">Artist</th>
                      {/* где есть */}
                      <th className="text-right links-col-2">
                        {/* на мобилке скрываем слово, на sm+ показываем */}
                        <span className="sr-only sm:not-sr-only">Links</span>
                      </th>
                    </tr>
                    </thead>
                    <tbody>
                    {(stats?.lidarr?.latestAlbums || []).slice(0, 5).map((r, i) => (
                      <tr key={`la-${r.id}-${i}`} className="border-t border-white/5">
                        <td className="py-1 pr-2 hidden sm:table-cell">{i + 1}</td>
                        <td className="py-1 pr-2">{r.title || '—'}</td>
                        <td className="py-1 pr-2">{r.artistName || '—'}</td>
                        <td className="py-1 links-col-2">
                          <div className="link-tray link-tray-2 link-tray-right">
                            {r.lidarrUrl
                              ? <a href={r.lidarrUrl} target="_blank" rel="noreferrer"
                                   className="link-chip link-chip--lidarr link-margin-right-5">Lidarr</a>
                              : <span className="link-chip invisible select-none" aria-hidden="true">Lidarr</span>}
                            {r.mbUrl
                              ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                   className="link-chip link-chip--mb">MusicBrainz</a>
                              : <span className="link-chip invisible select-none" aria-hidden="true">MusicBrainz</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </div>
          </div>
        </section>

        {/* Yandex & Lidarr artists */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel p-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="section-title">Latest Yandex artists</div>
              <div className="sm:ml-auto -mx-2 px-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button className="btn btn-outline shrink-0" onClick={pullFromYandexArtists}
                        disabled={isBusy('yandexPull')}>
                  {isBusy('yandexPull') ? 'Pulling…' : 'Pull from YM'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={matchYandexArtists}
                        disabled={isBusy('yandexMatchArtists')}>
                  {isBusy('yandexMatchArtists') ? 'Matching…' : 'Matching YM'}
                </button>
                <button className="btn btn-outline shrink-0" onClick={() => pushYandexToLidarr('artists')}
                        disabled={isBusy('yandexPushArtists')}>
                  {isBusy('yandexPushArtists') ? 'Pushing…' : 'Push to Lidarr'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.yandex?.latestArtists || []).length === 0 ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <ResponsiveTable>
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
                              : <span className="link-chip invisible select-none" aria-hidden="true">Yandex</span>}
                            {r.mbUrl
                              ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                   className="link-chip link-chip--mb">MusicBrainz</a>
                              : <span className="link-chip invisible select-none" aria-hidden="true">MusicBrainz</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </div>
          </div>

          <div className="panel p-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="section-title">Latest Lidarr artists</div>
              <div className="sm:ml-auto -mx-2 px-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button className="btn btn-outline shrink-0" onClick={pullFromLidarrArtists}
                        disabled={isBusy('lidarrPullArtists')}>
                  {isBusy('lidarrPullArtists') ? 'Pulling…' : 'Pull from Lidarr'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(stats?.lidarr?.latestArtists || []).length === 0 ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <ResponsiveTable>
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
                              : <span className="link-chip invisible select-none" aria-hidden="true">Lidarr</span>}
                            {r.mbUrl
                              ? <a href={r.mbUrl} target="_blank" rel="noreferrer"
                                   className="link-chip link-chip--mb">MusicBrainz</a>
                              : <span className="link-chip invisible select-none" aria-hidden="true">MusicBrainz</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </div>
          </div>
        </section>

        {/* KPI панели */}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel p-3 sm:p-4 space-y-3">
            <div className="text-sm text-gray-500">Artists with downloads</div>
            <div className="text-2xl font-bold">{lDownloaded}/{lA.total}</div>
            <ProgressBar value={lDownloadedFrac} color="ym" />
            <div className="text-xs text-gray-500">Without tracks: {lNotDownloaded}</div>
          </div>
          <div className="panel p-3 sm:p-4 space-y-3">
            <div className="text-sm text-gray-500">Custom artists matched</div>
            <div className="text-2xl font-bold">{cA.matched}/{cA.total}</div>
            <ProgressBar value={cArtistPct} color="accent" />
            <div className="text-xs text-gray-500">Unmatched: {cA.unmatched}</div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="panel p-3 sm:p-4 space-y-3">
            <div className="text-sm text-gray-500">Artists matched (Yandex)</div>
            <div className="text-2xl font-bold">{yA.matched}/{yA.total}</div>
            <ProgressBar value={yArtistPct} color="accent" />
            <div className="text-xs text-gray-500">Unmatched: {yA.unmatched}</div>
          </div>
          <div className="panel p-3 sm:p-4 space-y-3">
            <div className="text-sm text-gray-500">Albums matched (Yandex)</div>
            <div className="text-2xl font-bold">{yR.matched}/{yR.total}</div>
            <ProgressBar value={yAlbumPct} color="primary" />
            <div className="text-xs text-gray-500">Unmatched: {yR.unmatched}</div>
          </div>
          <div className="panel p-3 sm:p-4 space-y-3">
            <div className="text-sm text-gray-500">Downloaded albums (from Yandex likes)</div>
            <div className="text-2xl font-bold">{ymAlbumsDownloaded}/{ymAlbumsTotal}</div>
            <ProgressBar value={ymAlbumsPct} color="ym" />
            <div className="text-xs text-gray-500">Not downloaded {ymAlbumsNotDownloaded}</div>
          </div>
        </section>

        {/* Runs */}
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
                    <button className="btn btn-outline" onClick={() => stopRun(r.id)} disabled={stoppingId === r.id}>
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

        {/* Scheduler */}
        <section className="panel p-4">
          <div className="mb-2 flex items-center gap-3">
            <div className="section-title">Scheduler</div>
            <div className="ml-auto text-xs text-gray-400">updates every 30s</div>
          </div>

          {cronJobs.length === 0 ? (
            <div className="text-sm text-gray-400">No jobs configured.</div>
          ) : (
            <ResponsiveTable>
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
                    <td className="py-1 pr-2">
                      {j.cron ? (j.valid ? <Badge tone="ok">valid</Badge> : <Badge tone="err">invalid</Badge>) :
                        <span className="text-gray-500">—</span>}
                    </td>
                    <td className="py-1 pr-2">{j.nextRun ? new Date(j.nextRun).toLocaleString() : '—'}</td>
                    <td className="py-1 pr-2">{humanCountdown(j.nextRun)}</td>
                    <td className="py-1 pr-2">
                      {j.running ? <Badge tone="ok">running</Badge> : <Badge tone="muted">idle</Badge>}
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </ResponsiveTable>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="panel p-3 sm:p-4 text-center">
            <div className="text-sm text-gray-500">JSON</div>
            <div className="mt-3 flex justify-center gap-3 flex-wrap">
              <a className="btn btn-outline" href={`${apiBase}/api/export/artists.json`} target="_blank"
                 rel="noreferrer">
                Artists JSON
              </a>
              <a className="btn btn-outline" href={`${apiBase}/api/export/albums.json`} target="_blank"
                 rel="noreferrer">
                Albums JSON
              </a>
            </div>
          </div>

          <div className="panel p-3 sm:p-4 text-center">
            <div className="text-sm text-gray-500">CSV</div>
            <div className="mt-3 flex justify-center gap-3 flex-wrap">
              <a className="btn btn-outline" href={`${apiBase}/api/export/artists.csv`} download>
                Artists CSV
              </a>
              <a className="btn btn-outline" href={`${apiBase}/api/export/albums.csv`} download>
                Albums CSV
              </a>
            </div>
          </div>

          <div className="panel p-3 sm:p-4 text-center">
            <div className="text-sm text-gray-500">Markdown</div>
            <div className="mt-3 flex justify-center gap-3 flex-wrap">
              <a className="btn btn-outline" href={`${apiBase}/api/export/artists.md`} target="_blank" rel="noreferrer">
                Artists MD
              </a>
              <a className="btn btn-outline" href={`${apiBase}/api/export/albums.md`} target="_blank" rel="noreferrer">
                Albums MD
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
