// apps/api/src/workers/runNavidromePlan.ts
import { prisma } from '../prisma';
import { startRun, patchRunStats, endRun, log as dblog } from '../log';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'worker.nav.plan' });

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function songLooseKey(artist?: string | null, title?: string | null) {
  return nkey(`${artist || ''}|||${title || ''}`);
}
function songFullKey(artist?: string | null, title?: string | null, dur?: number | null) {
  const d = Number.isFinite(dur as any) ? (dur as number) : 0;
  return nkey(`${artist || ''}|||${title || ''}|||${d}`);
}

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
  toStar:   { artistIds: string[]; albumIds: string[]; songIds: string[] };
  toUnstar: { artistIds: string[]; albumIds: string[]; songIds: string[] };
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
  authPass?: string;     // необязательный пароль для фолбэка внутри клиента
};

export async function computeNavidromePlan(opts: ComputeOpts): Promise<ComputedPlan> {
  const client = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);

  // 0) Проверим авторизацию заранее — паднёт рано, если что
  await client.ensureAuthHealthy();

  // 1) желаемое состояние (ключи)
  const needArtists = opts.target === 'artists' || opts.target === 'all';
  const needAlbums  = opts.target === 'albums'  || opts.target === 'all';
  const needTracks  = opts.target === 'tracks'  || opts.target === 'all';

  const wantArtists = new Set<string>();
  const wantAlbums  = new Set<string>();

  // Для треков — два представления: loose (для диффа) и info (для резолва с длительностью)
  const wantSongsLoose = new Set<string>();
  const wantSongsInfo  = new Map<string, { artist: string, title: string, dur: number }>(); // looseKey -> info

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
      const loose = songLooseKey(r.artist, r.title);
      if (loose) {
        wantSongsLoose.add(loose);
        wantSongsInfo.set(loose, { artist: r.artist || '', title: r.title, dur });
      }
    }
  }

  // 2) текущее состояние ND (звёздочки)
  const compareNd = !!(opts.withNdState ?? true);
  const ndArtists = new Map<string, string>();
  const ndAlbums  = new Map<string, string>();
  const ndSongsLoose = new Map<string, string[]>(); // looseKey -> [songId...]

  if (compareNd) {
    const cur = await client.getStarred2();
    for (const a of cur.artists) ndArtists.set(nkey(a.name), a.id);
    for (const al of cur.albums) ndAlbums.set(nkey(`${al.artist}|||${al.name}`), al.id);

    for (const s of cur.songs) {
      const loose = songLooseKey(s.artist, s.title);
      if (!loose) continue;
      const arr = ndSongsLoose.get(loose) || [];
      arr.push(s.id);
      ndSongsLoose.set(loose, arr);
    }
  }

  // 3) дифф по ключам
  const starArtistKeys = needArtists
    ? (compareNd ? [...wantArtists].filter(k => !ndArtists.has(k)) : [...wantArtists])
    : [];
  const starAlbumKeys = needAlbums
    ? (compareNd ? [...wantAlbums].filter(k => !ndAlbums.has(k)) : [...wantAlbums])
    : [];
  // треки — по looseKey
  const starSongLoose = needTracks
    ? (compareNd ? [...wantSongsLoose].filter(k => !ndSongsLoose.has(k)) : [...wantSongsLoose])
    : [];

  const unArtistKeys = compareNd && (opts.policy === 'yandex') && needArtists
    ? [...ndArtists.keys()].filter(k => !wantArtists.has(k))
    : [];
  const unAlbumKeys = compareNd && (opts.policy === 'yandex') && needAlbums
    ? [...ndAlbums.keys()].filter(k => !wantAlbums.has(k))
    : [];
  // треки — по looseKey
  const unSongLoose = compareNd && (opts.policy === 'yandex') && needTracks
    ? [...ndSongsLoose.keys()].filter(k => !wantSongsLoose.has(k))
    : [];

  // 4) при необходимости резолвим ID (для apply); для unstar ID берём из ND
  const toStar = { artistIds: [] as string[], albumIds: [] as string[], songIds: [] as string[] };
  const toUnstar = {
    artistIds: unArtistKeys.map(k => ndArtists.get(k)!).filter(Boolean),
    albumIds:  unAlbumKeys.map(k => ndAlbums.get(k)!).filter(Boolean),
    songIds:   unSongLoose.flatMap(k => ndSongsLoose.get(k) || []),
  };

  let unresolved = 0;
  if (opts.resolveIds) {
    if (starArtistKeys.length) {
      const map = await client.resolveArtistIdsByKeys(starArtistKeys);
      for (const k of starArtistKeys) {
        const id = map.get(k);
        if (id) toStar.artistIds.push(id); else unresolved++;
      }
    }
    if (starAlbumKeys.length) {
      const map = await client.resolveAlbumIdsByKeys(starAlbumKeys);
      for (const k of starAlbumKeys) {
        const id = map.get(k);
        if (id) toStar.albumIds.push(id); else unresolved++;
      }
    }
    if (starSongLoose.length) {
      // преобразуем в full-keys для резолвера (чтобы учесть длительность на этапе поиска ID)
      const fullKeys: string[] = [];
      for (const loose of starSongLoose) {
        const info = wantSongsInfo.get(loose);
        if (!info) { unresolved++; continue; }
        fullKeys.push(songFullKey(info.artist, info.title, info.dur));
      }
      const map = await client.resolveSongIdsByKeys(fullKeys);
      for (const fk of fullKeys) {
        const id = map.get(fk);
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
      wantTracks:  wantSongsLoose.size,
      ndArtists:   ndArtists.size,
      ndAlbums:    ndAlbums.size,
      ndSongs:     ndSongsLoose.size,
      toStarArtists:  starArtistKeys.length,
      toStarAlbums:   starAlbumKeys.length,
      toStarSongs:    starSongLoose.length,
      toUnstarArtists: unArtistKeys.length,
      toUnstarAlbums:  unAlbumKeys.length,
      toUnstarSongs:   unSongLoose.length,
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
  authPass?: string;
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
      authPass: (params as any).authPass,
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
