// apps/api/src/workers/runNavidromePlan.ts
import { prisma } from '../prisma';
import { startRun, patchRunStats, endRun, log as dblog } from '../log';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'worker.nav.plan' });

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export type PlanTarget = 'artists' | 'albums' | 'tracks' | 'all';
export type Policy = 'yandex' | 'navidrome';

export type ComputedPlan = {
  toStar:   { artistIds: string[]; albumIds: string[]; songIds: string[] };
  toUnstar: { artistIds: string[]; albumIds: string[]; songIds: string[] };
  /** YM→ND карта только для «к лайку» треков, чтобы красиво логировать и потом подтвердить */
  starSongMap: Array<{
    ymId: string;
    key: string;
    ndSongId?: string;
    artist: string;
    title: string;
    durationSec: number;
  }>;
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
  resolveIds?: boolean;  // default false
  authPass?: string;
};

export async function computeNavidromePlan(opts: ComputeOpts): Promise<ComputedPlan> {
  const client = new NavidromeClient(opts.navUrl, opts.auth);

  const needArtists = opts.target === 'artists' || opts.target === 'all';
  const needAlbums  = opts.target === 'albums'  || opts.target === 'all';
  const needTracks  = opts.target === 'tracks'  || opts.target === 'all';

  const wantArtists = new Set<string>();
  const wantAlbums  = new Set<string>();

  if (needArtists) {
    const rows = await prisma.yandexArtist.findMany({
      where: { present: true, yGone: false },
      select: { name: true }
    });
    for (const r of rows) {
      const k = nkey(r.name);
      if (k) wantArtists.add(k);
    }
  }

  if (needAlbums) {
    const rows = await prisma.yandexAlbum.findMany({
      where: { present: true, yGone: false },
      select: { title: true, artist: true }
    });
    for (const r of rows) {
      // artist в схеме optional => string | null -> нормализуем к ''
      const k = nkey(`${r.artist ?? ''}|||${r.title ?? ''}`);
      if (k) wantAlbums.add(k);
    }
  }

  // --- текущее состояние ND (нужно до треков, чтобы учитывать ndId из LikeSync)
  const compareNd = !!(opts.withNdState ?? true);
  const ndArtists = new Map<string, string>();
  const ndAlbums  = new Map<string, string>();
  const ndSongsByKey = new Map<string, string>();
  const ndStarredIds = new Set<string>();

  if (compareNd) {
    const cur = await client.getStarred2();
    // 🔧 FIX: a.name может быть null -> нормализуем
    for (const a of cur.artists) ndArtists.set(nkey(a.name ?? ''), a.id);
    for (const al of cur.albums) ndAlbums.set(nkey(`${al.artist ?? ''}|||${al.name ?? ''}`), al.id);
    for (const s of cur.songs) {
      const dur = Number.isFinite(s.duration as any) ? (s.duration as number) : 0;
      const k = nkey(`${s.artist ?? ''}|||${s.title ?? ''}|||${dur}`);
      ndSongsByKey.set(k, s.id);
      ndStarredIds.add(s.id);
    }
  }

  // --- треки: готовим метаданные + LikeSync, чтобы отсечь уже синхронизированные
  const wantSongs = new Set<string>();
  const trackMetaByKey = new Map<string, { ymId: string; artist: string; title: string; durationSec: number }>();
  const ymRows = needTracks
    ? await prisma.yandexTrack.findMany({
      where: { present: true, yGone: false },
      select: { ymId: true, title: true, artist: true, durationSec: true }
    })
    : [];

  // LikeSync для этих YM
  const lsRows = needTracks && ymRows.length
    ? await prisma.yandexLikeSync.findMany({
      where: { kind: 'track', ymId: { in: ymRows.map(r => r.ymId) } },
      select: { ymId: true, status: true, ndId: true }
    })
    : [];

  const lsByYm = new Map<string, { status?: string | null; ndId?: string | null }>();
  for (const r of lsRows) {
    if (!r.ymId) continue;                // <- type guard: r.ymId теперь точно string
    lsByYm.set(r.ymId, { status: r.status, ndId: r.ndId });
  }

  if (needTracks) {
    for (const r of ymRows) {
      const dur = Number.isFinite(r.durationSec as any) ? (r.durationSec as number) : 0;
      const k = nkey(`${r.artist ?? ''}|||${r.title ?? ''}|||${dur}`);

      const ls = lsByYm.get(r.ymId);
      let alreadySynced = false;
      if (ls?.status === 'synced') {
        const ndId = ls.ndId ?? undefined; // сузим: либо string, либо undefined
        if (ndId) {
          alreadySynced = ndStarredIds.has(ndId) || !compareNd;
        } else {
          alreadySynced = true;
        }
      }

      if (alreadySynced) {
        continue;
      }

      wantSongs.add(k);
      trackMetaByKey.set(k, {
        ymId: r.ymId,
        artist: (r.artist ?? ''),
        title: r.title ?? '',
        durationSec: dur,
      });
    }
  }

  // --- дифф по ключам
  const starArtistKeys = needArtists
    ? (compareNd ? [...wantArtists].filter(k => !ndArtists.has(k)) : [...wantArtists])
    : [];
  const starAlbumKeys = needAlbums
    ? (compareNd ? [...wantAlbums].filter(k => !ndAlbums.has(k)) : [...wantAlbums])
    : [];
  const starSongKeys = needTracks
    ? (compareNd ? [...wantSongs].filter(k => !ndSongsByKey.has(k)) : [...wantSongs])
    : [];

  const unArtistKeys = compareNd && (opts.policy === 'yandex') && needArtists
    ? [...ndArtists.keys()].filter(k => !wantArtists.has(k))
    : [];
  const unAlbumKeys = compareNd && (opts.policy === 'yandex') && needAlbums
    ? [...ndAlbums.keys()].filter(k => !wantAlbums.has(k))
    : [];
  const unSongKeys = compareNd && (opts.policy === 'yandex') && needTracks
    ? [...ndSongsByKey.keys()].filter(k => !wantSongs.has(k))
    : [];

  // --- при необходимости резолвим ID
  const toStar = { artistIds: [] as string[], albumIds: [] as string[], songIds: [] as string[] };
  const toUnstar = {
    artistIds: unArtistKeys.map(k => ndArtists.get(k)!).filter(Boolean),
    albumIds:  unAlbumKeys.map(k => ndAlbums.get(k)!).filter(Boolean),
    songIds:   unSongKeys.map(k => ndSongsByKey.get(k)!).filter(Boolean),
  };

  const starSongMap: ComputedPlan['starSongMap'] = [];
  let unresolved = 0;

  if (opts.resolveIds) {
    const client2 = client;

    if (starArtistKeys.length) {
      const map = await client2.resolveArtistIdsByKeys(starArtistKeys);
      for (const k of starArtistKeys) {
        const id = map.get(k);
        if (id) toStar.artistIds.push(id); else unresolved++;
      }
    }
    if (starAlbumKeys.length) {
      const map = await client2.resolveAlbumIdsByKeys(starAlbumKeys);
      for (const k of starAlbumKeys) {
        const id = map.get(k);
        if (id) toStar.albumIds.push(id); else unresolved++;
      }
    }
    if (starSongKeys.length) {
      const map = await client2.resolveSongIdsByKeys(starSongKeys);
      for (const k of starSongKeys) {
        const id = map.get(k);
        const meta = trackMetaByKey.get(k);
        if (id && meta) {
          toStar.songIds.push(id);
          starSongMap.push({
            ymId: meta.ymId,
            key: k,
            ndSongId: id,
            artist: meta.artist,
            title: meta.title,
            durationSec: meta.durationSec,
          });
        } else {
          if (meta) {
            starSongMap.push({
              ymId: meta.ymId,
              key: k,
              ndSongId: undefined,
              artist: meta.artist,
              title: meta.title,
              durationSec: meta.durationSec,
            });
          }
          unresolved++;
        }
      }
    }
  }

  return {
    toStar,
    toUnstar,
    starSongMap,
    counts: {
      wantArtists: wantArtists.size,
      wantAlbums:  wantAlbums.size,
      wantTracks:  wantSongs.size,
      ndArtists:   ndArtists.size,
      ndAlbums:    ndAlbums.size,
      ndSongs:     ndSongsByKey.size,
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

/** Быстрый план — только счётчики, без resolveIds */
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
      resolveIds: false,
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
