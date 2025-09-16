// apps/api/src/workers/runNavidromePlan.ts
import { prisma } from '../prisma';
import { startRun, patchRunStats, endRun, log as dblog } from '../log';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'worker.nav.plan' });

function nkey(s: string) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export type PlanTarget = 'artists' | 'albums' | 'tracks' | 'all';
// Policy оставлен для совместимости типов, на дифф не влияет
export type Policy = 'yandex' | 'navidrome';

export type ComputedPlan = {
  toStar:   { artistIds: string[]; albumIds: string[]; songIds: string[] };

  // YM→ND карта только для треков, чтобы красиво логировать и потом подтвердить
  starSongMap: Array<{
    ymId: string;
    key: string;
    ndSongId?: string;
    artist: string;
    title: string;
    durationSec: number;
  }>;

  // Что было найдено в этом планировании (при resolveIds=true)
  resolved: {
    artists: Array<{ key: string; ndId: string }>;
    albums:  Array<{ key: string; ndId: string }>;
    tracks:  Array<{ ymId: string; key: string; ndId: string }>;
  };

  counts: {
    // всего из YM (present && !yGone)
    wantArtists: number; wantAlbums: number; wantTracks: number;

    // у скольких уже есть ndId локально
    haveNdArtists: number; haveNdAlbums: number; haveNdSongs: number;

    // скольким ещё нужно искать ndId в ND
    needSearchArtists: number; needSearchAlbums: number; needSearchSongs: number;

    // к скольким реально можем применить STAR (haveNd + resolved)
    toStarArtists: number; toStarAlbums: number; toStarSongs: number;

    // сколько не удалось зарезолвить (если resolveIds=true)
    unresolved: number;
  };
};

type ComputeOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy?: any;          // игнорируется
  withNdState?: boolean; // игнорируется
  resolveIds?: boolean;  // ищем ndId в ND только тем, у кого его нет
  authPass?: string;
};

export async function computeNavidromePlan(opts: ComputeOpts): Promise<ComputedPlan> {
  const client = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
  const needArtists = opts.target === 'artists' || opts.target === 'all';
  const needAlbums  = opts.target === 'albums'  || opts.target === 'all';
  const needTracks  = opts.target === 'tracks'  || opts.target === 'all';
  const doResolve   = !!opts.resolveIds;

  // ===== ARTISTS =====
  const a_rows = needArtists
    ? await prisma.yandexArtist.findMany({
      where: { present: true, yGone: false },
      select: { key: true, name: true, ndId: true },
    })
    : [];
  const a_have = a_rows.filter(r => !!r.ndId);
  const a_need = a_rows.filter(r => !r.ndId);
  const a_needKeys: string[] = a_need.map(r => (r.key ?? nkey(r.name)));
  const a_resolved: Array<{ key: string; ndId: string }> = [];
  const a_toStar: string[] = a_have.map(r => r.ndId!).filter(Boolean);

  if (doResolve && a_needKeys.length) {
    const m = await client.resolveArtistIdsByKeys(a_needKeys);
    for (const k of a_needKeys) {
      const id = m.get(k);
      if (id) {
        a_resolved.push({ key: k, ndId: id });
        a_toStar.push(id);
      }
    }
  }

  // ===== ALBUMS =====
  const al_rows = needAlbums
    ? await prisma.yandexAlbum.findMany({
      where: { present: true, yGone: false },
      select: { key: true, title: true, artist: true, ndId: true },
    })
    : [];
  const al_have = al_rows.filter(r => !!r.ndId);
  const al_need = al_rows.filter(r => !r.ndId);
  const al_needKeys: string[] = al_need.map(r => (r.key ?? nkey(`${r.artist ?? ''}|||${r.title ?? ''}`)));
  const al_resolved: Array<{ key: string; ndId: string }> = [];
  const al_toStar: string[] = al_have.map(r => r.ndId!).filter(Boolean);

  if (doResolve && al_needKeys.length) {
    const m = await client.resolveAlbumIdsByKeys(al_needKeys);
    for (const k of al_needKeys) {
      const id = m.get(k);
      if (id) {
        al_resolved.push({ key: k, ndId: id });
        al_toStar.push(id);
      }
    }
  }

  // ===== TRACKS =====
  // ND-ID трека храним в YandexLikeSync.ndId
  const t_rows = needTracks
    ? await prisma.yandexTrack.findMany({
      where: { present: true, yGone: false },
      select: { ymId: true, title: true, artist: true, durationSec: true, key: true },
    })
    : [];
  const likeRows = needTracks && t_rows.length
    ? await prisma.yandexLikeSync.findMany({
      where: { kind: 'track', ymId: { in: t_rows.map(r => r.ymId) } },
      select: { ymId: true, ndId: true, key: true },
    })
    : [];

  type LsInfo = { ndId?: string; key?: string };
  const lsByYm = new Map<string, LsInfo>();

  // FIX: ymId может быть null — фильтруем и нормализуем
  for (const r of likeRows) {
    const ym = r.ymId ?? undefined;
    if (!ym) continue;
    const info: LsInfo = {};
    if (r.ndId ?? null) info.ndId = r.ndId as string;
    if (r.key ?? null)  info.key  = r.key  as string;
    lsByYm.set(ym, info);
  }

  const t_have: Array<{ ymId: string; ndId: string; meta: { artist: string; title: string; durationSec: number; key: string } }> = [];
  const t_need: Array<{ ymId: string; meta: { artist: string; title: string; durationSec: number; key: string } }> = [];

  for (const r of t_rows) {
    const dur = Number.isFinite(r.durationSec as any) ? (r.durationSec as number) : 0;
    const computedKey = nkey(`${r.artist ?? ''}|||${r.title ?? ''}|||${dur}`);
    const key = r.key ?? computedKey; // на всякий случай
    const ls = lsByYm.get(r.ymId);
    const ndId = ls?.ndId || null;
    const meta = { artist: r.artist ?? '', title: r.title ?? '', durationSec: dur, key };
    if (ndId) {
      t_have.push({ ymId: r.ymId, ndId, meta });
    } else {
      t_need.push({ ymId: r.ymId, meta });
    }
  }

  const t_toStar: string[] = t_have.map(x => x.ndId);
  const starSongMap: ComputedPlan['starSongMap'] = [];
  const t_resolved: Array<{ ymId: string; key: string; ndId: string }> = [];

  // Для логов включаем уже известные
  for (const x of t_have) {
    starSongMap.push({
      ymId: x.ymId,
      key: x.meta.key,
      ndSongId: x.ndId,
      artist: x.meta.artist,
      title: x.meta.title,
      durationSec: x.meta.durationSec,
    });
  }

  if (doResolve && t_need.length) {
    const needKeys = t_need.map(x => x.meta.key);
    const m = await client.resolveSongIdsByKeys(needKeys);
    for (const s of t_need) {
      const id = m.get(s.meta.key);
      if (id) {
        t_resolved.push({ ymId: s.ymId, key: s.meta.key, ndId: id });
        t_toStar.push(id);
        starSongMap.push({
          ymId: s.ymId,
          key: s.meta.key,
          ndSongId: id,
          artist: s.meta.artist,
          title: s.meta.title,
          durationSec: s.meta.durationSec,
        });
      } else {
        // оставим строку без ndSongId — пригодится для отчёта
        starSongMap.push({
          ymId: s.ymId,
          key: s.meta.key,
          ndSongId: undefined,
          artist: s.meta.artist,
          title: s.meta.title,
          durationSec: s.meta.durationSec,
        });
      }
    }
  }

  // Дедуп по наборам для STAR
  const toStar = {
    artistIds: [...new Set(a_toStar)],
    albumIds:  [...new Set(al_toStar)],
    songIds:   [...new Set(t_toStar)],
  };

  const counts = {
    wantArtists: a_rows.length,
    wantAlbums:  al_rows.length,
    wantTracks:  t_rows.length,

    haveNdArtists: a_have.length,
    haveNdAlbums:  al_have.length,
    haveNdSongs:   t_have.length,

    needSearchArtists: a_need.length,
    needSearchAlbums:  al_need.length,
    needSearchSongs:   t_need.length,

    toStarArtists: toStar.artistIds.length,
    toStarAlbums:  toStar.albumIds.length,
    toStarSongs:   toStar.songIds.length,

    unresolved:
      (doResolve ? (a_need.length - a_resolved.length) : 0) +
      (doResolve ? (al_need.length - al_resolved.length) : 0) +
      (doResolve ? (t_need.length - t_resolved.length) : 0),
  };

  return {
    toStar,
    starSongMap,
    resolved: { artists: a_resolved, albums: al_resolved, tracks: t_resolved },
    counts,
  };
}

/** План (счётчики). Ничего не резолвит, только считает «есть ndId» / «нужно искать». */
export async function runNavidromePlan(params: {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy?: any;          // игнорируется
  withNdState?: boolean; // игнорируется
}) {
  const run = await startRun('navidrome.plan', {
    phase: 'plan',
    target: params.target,
    policy: 'n/a',
    withNdState: false,
    a_total: 0, al_total: 0, t_total: 0,
    toStar: 0, toUnstar: 0, unresolved: 0,
  });
  if (!run) return;
  const runId = run.id;

  try {
    await dblog(runId, 'info', 'Navidrome plan start (new logic)', { target: params.target });

    const plan = await computeNavidromePlan({
      navUrl: params.navUrl,
      auth: params.auth,
      target: params.target,
      resolveIds: false,
    });

    await patchRunStats(runId, {
      a_total: plan.counts.wantArtists,
      al_total: plan.counts.wantAlbums,
      t_total: plan.counts.wantTracks,
      toStar: plan.counts.toStarArtists + plan.counts.toStarAlbums + plan.counts.toStarSongs,
      toUnstar: 0,
      unresolved: plan.counts.unresolved,
    });

    await dblog(runId, 'info', 'Plan (new): counts', plan.counts);

    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
    return runId;
  } catch (e: any) {
    log.error('plan failed', 'nav.plan.fail', { err: e?.message || String(e) });
    await endRun(runId, 'error', String(e?.message || e));
    throw e;
  }
}
