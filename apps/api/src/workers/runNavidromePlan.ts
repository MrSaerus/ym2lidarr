// apps/api/src/workers/runNavidromePlan.ts
import { prisma } from '../prisma';
import { startRun, patchRunStats, endRun, log as dblog } from '../log';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'worker.nav.plan' });

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

async function parseRunStats(runId: number) {
  const r = await prisma.syncRun.findUnique({ where: { id: runId } });
  try { return r?.stats ? JSON.parse(r.stats) : {}; } catch { return {}; }
}
async function bailIfCancelled(runId: number, phase?: string) {
  const s = await parseRunStats(runId);
  if (s?.cancel) {
    await dblog(runId, 'warn', 'Cancelled by user', phase ? { phase } : undefined);
    await patchRunStats(runId, { phase: 'cancelled' });
    await endRun(runId, 'error', 'Cancelled by user');
    return true;
  }
  return false;
}

export type PlanTarget = 'artists' | 'albums' | 'tracks' | 'all';
export type Policy = 'yandex' | 'navidrome';

export type ComputedPlan = {
  // готовые ID к применению (могут быть пустыми, если resolveIds=false)
  toStar:   { artistIds: string[]; albumIds: string[]; songIds: string[] };
  toUnstar: { artistIds: string[]; albumIds: string[]; songIds: string[] };
  // счётчики для лога
  counts: {
    wantArtists: number; wantAlbums: number; wantTracks: number;
    ndArtists: number; ndAlbums: number; ndSongs: number;
    toStarArtists: number; toStarAlbums: number; toStarSongs: number;
    toUnstarArtists: number; toUnstarAlbums: number; toUnstarSongs: number;
    unresolved: number;
  };
};

type ComputeOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy: Policy;
  withNdState?: boolean; // default true
  resolveIds?: boolean;  // default false — быстрый план
};

/** Быстро считает дифф; по запросу может резолвить ID (для apply) */
export async function computeNavidromePlan(opts: ComputeOpts): Promise<ComputedPlan> {
  const client = new NavidromeClient(opts.navUrl, opts.auth);

  // 1) желаемое состояние (ключи)
  const needArtists = opts.target === 'artists' || opts.target === 'all';
  const needAlbums  = opts.target === 'albums'  || opts.target === 'all';
  const needTracks  = opts.target === 'tracks'  || opts.target === 'all';

  const wantArtists = new Set<string>();
  const wantAlbums  = new Set<string>();
  const wantSongs   = new Set<string>();

  if (needArtists) {
    const rows = await prisma.yandexArtist.findMany({ where: { present: true, yGone: false }, select: { name: true } });
    for (const r of rows) { const k = nkey(r.name); if (k) wantArtists.add(k); }
  }
  if (needAlbums) {
    const rows = await prisma.yandexAlbum.findMany({ where: { present: true, yGone: false }, select: { title: true, artist: true } });
    for (const r of rows) { const k = nkey(`${r.artist}|||${r.title}`); if (k) wantAlbums.add(k); }
  }
  if (needTracks) {
    const rows = await prisma.yandexTrack.findMany({ where: { present: true, yGone: false }, select: { title: true, artist: true, durationSec: true } });
    for (const r of rows) {
      const dur = Number.isFinite(r.durationSec as any) ? (r.durationSec as number) : 0;
      const k = nkey(`${r.artist}|||${r.title}|||${dur}`);
      if (k) wantSongs.add(k);
    }
  }

  // 2) текущее состояние ND (звёздочки)
  const compareNd = !!(opts.withNdState ?? true);
  const ndArtists = new Map<string, string>();
  const ndAlbums  = new Map<string, string>();
  const ndSongs   = new Map<string, string>();

  if (compareNd) {
    const cur = await client.getStarred2();
    for (const a of cur.artists) ndArtists.set(nkey(a.name), a.id);
    for (const al of cur.albums) ndAlbums.set(nkey(`${al.artist}|||${al.name}`), al.id);
    for (const s of cur.songs) {
      const dur = Number.isFinite(s.duration as any) ? (s.duration as number) : 0;
      ndSongs.set(nkey(`${s.artist}|||${s.title}|||${dur}`), s.id);
    }
  }

  // 3) дифф по ключам
  const starArtistKeys = needArtists
    ? (compareNd ? [...wantArtists].filter(k => !ndArtists.has(k)) : [...wantArtists])
    : [];
  const starAlbumKeys = needAlbums
    ? (compareNd ? [...wantAlbums].filter(k => !ndAlbums.has(k)) : [...wantAlbums])
    : [];
  const starSongKeys = needTracks
    ? (compareNd ? [...wantSongs].filter(k => !ndSongs.has(k)) : [...wantSongs])
    : [];

  const unArtistKeys = compareNd && (opts.policy === 'yandex') && needArtists
    ? [...ndArtists.keys()].filter(k => !wantArtists.has(k))
    : [];
  const unAlbumKeys = compareNd && (opts.policy === 'yandex') && needAlbums
    ? [...ndAlbums.keys()].filter(k => !wantAlbums.has(k))
    : [];
  const unSongKeys = compareNd && (opts.policy === 'yandex') && needTracks
    ? [...ndSongs.keys()].filter(k => !wantSongs.has(k))
    : [];

  // 4) при необходимости резолвим ID (для apply); для unstar ID берём из ND
  const toStar = { artistIds: [] as string[], albumIds: [] as string[], songIds: [] as string[] };
  const toUnstar = {
    artistIds: unArtistKeys.map(k => ndArtists.get(k)!).filter(Boolean),
    albumIds:  unAlbumKeys.map(k => ndAlbums.get(k)!).filter(Boolean),
    songIds:   unSongKeys.map(k => ndSongs.get(k)!).filter(Boolean),
  };

  let unresolved = 0;
  if (opts.resolveIds) {
    // artists
    if (starArtistKeys.length) {
      const map = await client.resolveArtistIdsByKeys(starArtistKeys);
      for (const k of starArtistKeys) {
        const id = map.get(k);
        if (id) toStar.artistIds.push(id); else unresolved++;
      }
    }
    // albums
    if (starAlbumKeys.length) {
      const map = await client.resolveAlbumIdsByKeys(starAlbumKeys);
      for (const k of starAlbumKeys) {
        const id = map.get(k);
        if (id) toStar.albumIds.push(id); else unresolved++;
      }
    }
    // songs
    if (starSongKeys.length) {
      const map = await client.resolveSongIdsByKeys(starSongKeys);
      for (const k of starSongKeys) {
        const id = map.get(k);
        if (id) toStar.songIds.push(id); else unresolved++;
      }
    }
  }

  return {
    toStar,
    toUnstar,
    counts: {
      wantArtists: wantArtists.size,
      wantAlbums:  wantAlbums.size,
      wantTracks:  wantSongs.size,
      ndArtists:   ndArtists.size,
      ndAlbums:    ndAlbums.size,
      ndSongs:     ndSongs.size,
      toStarArtists:  starArtistKeys.length,
      toStarAlbums:   starAlbumKeys.length,
      toStarSongs:    starSongKeys.length,
      toUnstarArtists: unArtistKeys.length,
      toUnstarAlbums:  unAlbumKeys.length,
      toUnstarSongs:   unSongKeys.length,
      unresolved,
    },
  };
}

/** Джоб планирования — быстрый, только счётчики */
export async function runNavidromePlan(params: {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy: Policy;
  withNdState?: boolean;
}) {
  const run = await startRun('navidrome.plan', {
    phase: 'plan',
    target: params.target,
    policy: params.policy,
    withNdState: !!(params.withNdState ?? true),
    a_total: 0, al_total: 0, t_total: 0,
    toStar: 0, toUnstar: 0, unresolved: 0,
  });
  if (!run) return;
  const runId = run.id;

  try {
    await dblog(runId, 'info', 'Navidrome plan start', { target: params.target, policy: params.policy });

    const plan = await computeNavidromePlan({
      navUrl: params.navUrl,
      auth: params.auth,
      target: params.target,
      policy: params.policy,
      withNdState: params.withNdState ?? true,
      resolveIds: false, // ВАЖНО: быстрый план
    });

    await patchRunStats(runId, {
      a_total: plan.counts.wantArtists,
      al_total: plan.counts.wantAlbums,
      t_total: plan.counts.wantTracks,
      toStar: plan.counts.toStarArtists + plan.counts.toStarAlbums + plan.counts.toStarSongs,
      toUnstar: plan.counts.toUnstarArtists + plan.counts.toUnstarAlbums + plan.counts.toUnstarSongs,
      unresolved: plan.counts.unresolved,
    });

    await dblog(
      runId,
      'info',
      `Plan diff — toStar:${plan.counts.toStarArtists + plan.counts.toStarAlbums + plan.counts.toStarSongs} toUnstar:${plan.counts.toUnstarArtists + plan.counts.toUnstarAlbums + plan.counts.toUnstarSongs} unresolved:${plan.counts.unresolved}`
    );

    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
    return runId;
  } catch (e: any) {
    log.error('plan failed', 'nav.plan.fail', { err: e?.message || String(e) });
    await endRun(runId, 'error', String(e?.message || e));
    throw e;
  }
}
