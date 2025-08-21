// apps/web/pages/index.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';

type CountBlock = { total: number; matched: number; unmatched: number };

type LatestYA = { id: number; title: string; artistName: string; year?: number | null; yandexUrl?: string; mbUrl?: string; };
type LatestLA = { id: number; title: string; artistName: string; added: string | null; lidarrUrl?: string; mbUrl?: string; };
type LatestYArtist = { id: number; name: string; yandexUrl?: string; mbUrl?: string; };
type LatestLArtist = { id: number; name: string; added?: string | null; lidarrUrl?: string; mbUrl?: string; };
type LatestCArtist = { id: number; name: string; mbUrl?: string; createdAt?: string | null; };

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
  kind?: 'yandex' | 'lidarr' | string | null;
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

async function tryPostMany<T = any>(paths: string[], body?: any): Promise<T> {
  let lastErr: any;
  for (const p of paths) {
    try { return await api<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All endpoints failed');
}

export default function OverviewPage() {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [latest, setLatest] = useState<RunShort | null>(null);
  const [runs, setRuns] = useState<RunShort[]>([]);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

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

  // actions
  async function resyncCacheLidarrArtists() { setMsg('Resyncing Lidarr cache (artists)…'); try { await api('/api/lidarr/resync',{method:'POST'}); setMsg('Lidarr cache resynced'); load(); } catch(e:any){ setMsg(`Lidarr resync error: ${e?.message||String(e)}`);} }
  async function resyncCacheYandexAlbums() { return pullFromYandexAlbums(); }
  async function pullFromLidarrArtists() { setMsg('Pull from Lidarr (artists)…'); try { await api('/api/lidarr/resync',{method:'POST'}); setMsg('Lidarr pull OK'); load(); } catch(e:any){ setMsg(`Lidarr pull error: ${e?.message||String(e)}`);} }
  async function pullFromLidarrAlbums() { return pullFromLidarrArtists(); }
  async function pullFromYandexArtists() { setMsg('Pull from Yandex (artists)…'); try { await tryPostMany(['/api/sync/yandex/pull','/api/sync/yandex','/api/yandex/pull'],{target:'artists'}); setMsg('Yandex pull OK'); load(); } catch(e:any){ setMsg(`Yandex pull error: ${e?.message||String(e)}`);} }
  async function pullFromYandexAlbums() { setMsg('Pull from Yandex (albums)…'); try { await tryPostMany(['/api/sync/yandex/pull','/api/sync/yandex','/api/yandex/pull'],{target:'albums'}); setMsg('Yandex pull OK'); load(); } catch(e:any){ setMsg(`Yandex pull error: ${e?.message||String(e)}`);} }
  async function matchYandexArtists() { setMsg('Matching Yandex artists…'); try { await api('/api/sync/match',{method:'POST',headers:{'Content-Type':'application/json'},body:{force:true,target:'artists'} as any}); setMsg('Match started'); } catch(e:any){ setMsg(`Match error: ${e?.message||String(e)}`);} }
  async function matchYandexAlbums()  { setMsg('Matching Yandex albums…');  try { await api('/api/sync/match',{method:'POST',headers:{'Content-Type':'application/json'},body:{force:true,target:'albums'} as any});  setMsg('Match started'); } catch(e:any){ setMsg(`Match error: ${e?.message||String(e)}`);} }
  async function runSyncYandex() { setMsg('Starting Yandex sync…'); try { const r=await tryPostMany<{ok?:boolean;runId?:number;error?:string}>(['/api/sync/yandex','/api/sync/yandex/pull','/api/yandex/pull']); const ok=r?.ok===true||typeof r?.runId==='number'; if(ok){ setMsg(`Yandex sync started (run ${r?.runId ?? 'n/a'})`); setTimeout(loadRuns,400);} else { setMsg(`Sync failed${r?.error?`: ${r.error}`:''}`);} } catch(e:any){ setMsg(`Sync error: ${e?.message||String(e)}`);} }
  async function pushToLidarr()   { setMsg('Pushing to Lidarr…');      try { const r=await tryPostMany<{ok?:boolean;runId?:number;error?:string}>(['/api/sync/lidarr','/api/lidarr']); const ok=r?.ok===true||typeof r?.runId==='number'; if(ok){ setMsg(`Pushed to Lidarr (run ${r?.runId ?? 'n/a'})`); setTimeout(loadRuns,400);} else { setMsg(`Push failed${r?.error?`: ${r.error}`:''}`);} } catch(e:any){ setMsg(`Push error: ${e?.message||String(e)}`);} }

  // Custom panel actions
  async function matchCustomAll() {
    setMsg('Matching Custom artists…');
    try {
      await api('/api/custom-artists/match-all', { method: 'POST' });
      setMsg('Custom match started');
      setTimeout(loadRuns, 400);
    } catch (e: any) {
      setMsg(`Custom match error: ${e?.message || String(e)}`);
    }
  }
  async function pushCustomToLidarr() {
    setMsg('Pushing (custom) to Lidarr…');
    try {
      await api('/api/sync/lidarr', { method: 'POST' });
      setMsg('Push started');
      setTimeout(loadRuns, 400);
    } catch (e: any) {
      setMsg(`Push error: ${e?.message || String(e)}`);
    }
  }

  async function stopRun(id: number) {
    try {
      setStoppingId(id);
      // ⬇️ ВАЖНО: стоп находится в /api/sync
      await api(`/api/sync/runs/${id}/stop`, { method: 'POST' });
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
                <button className="btn btn-outline" onClick={matchCustomAll}>Match MB</button>
                <button className="btn btn-primary" onClick={pushCustomToLidarr}>Push to Lidarr</button>
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
                    {(stats?.custom?.latestArtists || []).slice(0, 5).map((r, i) => (
                        <tr key={`c-${r.id}-${i}`} className="border-t border-white/5">
                          <td className="py-1 pr-2">{i + 1}</td>
                          <td className="py-1 pr-2">{r.name || '—'}</td>
                          <td className="py-1 links-col-2">
                            <div className="link-tray link-tray-2 link-tray-right">
                              <span className="link-chip placeholder">—</span>
                              {r.mbUrl
                                  ? <a href={r.mbUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
                                  : <span className="link-chip placeholder">MusicBrainz</span>}
                            </div>
                          </td>
                        </tr>
                    ))}
                    </tbody>
                  </table>
              )}
            </div>
          </section>

          {/* ALBUMS */}
          <section className="grid gap-4 md:grid-cols-2">
            {/* Yandex albums */}
            <div className="panel p-4">
              <div className="section-title mb-2">Latest Yandex albums</div>
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
                                    ? <a href={r.yandexUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--ym link-margin-right-5">Yandex</a>
                                    : <span className="link-chip placeholder">Yandex</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
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
              <div className="section-title mb-2">Latest Lidarr albums</div>
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
                                    ? <a href={r.lidarrUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--lidarr link-margin-right-5">Lidarr</a>
                                    : <span className="link-chip placeholder">Lidarr</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
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
              <div className="section-title mb-2">Latest Yandex artists</div>
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
                                    ? <a href={r.yandexUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--ym link-margin-right-5">Yandex</a>
                                    : <span className="link-chip placeholder">Yandex</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
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
              <div className="section-title mb-2">Latest Lidarr artists</div>
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
                                    ? <a href={r.lidarrUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--lidarr link-margin-right-5">Lidarr</a>
                                    : <span className="link-chip placeholder">Lidarr</span>}
                                {r.mbUrl
                                    ? <a href={r.mbUrl} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
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
            <ProgressBar value={cArtistPct} color="accent" />
            <div className="text-xs text-gray-500">Unmatched: {cA.unmatched}</div>
          </section>

          {/* Yandex stats */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Artists matched (Yandex)</div>
              <div className="text-2xl font-bold">{yA.matched}/{yA.total}</div>
              <ProgressBar value={yArtistPct} color="accent" />
              <div className="text-xs text-gray-500">Unmatched: {yA.unmatched}</div>
            </div>
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Albums matched (Yandex)</div>
              <div className="text-2xl font-bold">{yR.matched}/{yR.total}</div>
              <ProgressBar value={yAlbumPct} color="primary" />
              <div className="text-xs text-gray-500">Unmatched: {yR.unmatched}</div>
            </div>
          </section>

          {/* Lidarr stats */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Artists (Lidarr, with MBID)</div>
              <div className="text-2xl font-bold">{lA.matched}/{lA.total}</div>
              <ProgressBar value={lArtistPct} color="accent" />
              <div className="text-xs text-gray-500">Without MBID: {lA.unmatched}</div>
            </div>
            <div className="panel p-4 space-y-3">
              <div className="text-sm text-gray-500">Albums (Lidarr, with RG MBID)</div>
              <div className="text-2xl font-bold">{lR.matched}/{lR.total}</div>
              <ProgressBar value={lAlbumPct} color="primary" />
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

          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-outline" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="btn btn-outline" onClick={resyncCacheLidarrArtists}>Resync cache Lidarr Artists</button>
              <button className="btn btn-outline" onClick={resyncCacheYandexAlbums}>Resync cache Yandex Albums</button>
              <button className="btn btn-outline" onClick={pullFromLidarrArtists}>Pull from Lidarr Artists</button>
              <button className="btn btn-outline" onClick={pullFromLidarrAlbums}>Pull from Lidarr Albums</button>
              <button className="btn btn-outline" onClick={pullFromYandexArtists}>Pull from Yandex Artists</button>
              <button className="btn btn-outline" onClick={pullFromYandexAlbums}>Pull from Yandex Albums</button>
              <button className="btn btn-outline" onClick={matchYandexArtists}>Match Yandex Artists</button>
              <button className="btn btn-outline" onClick={matchYandexAlbums}>Match Yandex Albums</button>
              <button className="btn btn-primary" onClick={runSyncYandex}>Sync Yandex</button>
              <button className="btn btn-primary" onClick={pushToLidarr}>Push to Lidarr</button>
            </div>
          </section>

          <style jsx>{`
            :root { --chip-w: 96px; --chip-gap: 6px; }
            .links-col-2 { width: calc(2 * var(--chip-w) + 1 * var(--chip-gap)); }
            .link-tray { display: flex; align-items: center; gap: var(--chip-gap); white-space: nowrap; }
            .link-tray-right { justify-content: flex-end; }
            .link-tray-2 { min-width: calc(2 * var(--chip-w) + 1 * var(--chip-gap)); }
            .link-tray :global(.link-chip) { display: inline-flex; justify-content: center; width: var(--chip-w); }
            .link-tray :global(.link-chip.placeholder) { visibility: hidden; }
            .link-margin-right-5 { margin-right: 5px; }
          `}</style>
        </main>
      </>
  );
}
