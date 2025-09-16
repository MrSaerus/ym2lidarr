// apps/api/src/workers/runNavidromeApply.ts
import { startRun, endRun, patchRunStats, log as dblog } from '../log';
import { createLogger } from '../lib/logger';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import {
  computeNavidromePlan,
  type Policy,
  type PlanTarget,
} from './runNavidromePlan';
import { prisma } from '../prisma';

const log = createLogger({ scope: 'worker.nav.apply' });

type ApplyOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy: Policy;
  withNdState?: boolean;
  dryRun?: boolean;
  reuseRunId?: number;
  authPass?: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runNavidromeApply(opts: ApplyOpts) {
  let runId: number;
  if (opts.reuseRunId) {
    runId = opts.reuseRunId;
    await dblog(runId, 'info', 'Navidrome apply continue (reuse run)', {
      target: opts.target, policy: opts.policy, dryRun: !!opts.dryRun,
    });
  } else {
    const run = await startRun('navidrome.apply', {
      phase: 'apply',
      target: opts.target,
      policy: opts.policy,
      star_total: 0, star_done: 0,
      unstar_total: 0, unstar_done: 0,
      dryRun: !!opts.dryRun,
    });
    if (!run) return;
    runId = run.id;
    await dblog(runId, 'info', 'Navidrome apply start', {
      target: opts.target, policy: opts.policy, dryRun: !!opts.dryRun,
    });
  }

  try {
    const pre = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
    await pre.ensureAuthHealthy();

    // План с resolveIds + YM→ND картой для треков
    const plan = await computeNavidromePlan({
      navUrl: opts.navUrl,
      auth: opts.auth,
      target: opts.target,
      policy: opts.policy,
      withNdState: opts.withNdState ?? true,
      resolveIds: true,
      authPass: opts.authPass,
    });

    const starIds = plan.toStar;
    const unIds   = plan.toUnstar;

    const starTotal =
      (starIds.artistIds?.length || 0) +
      (starIds.albumIds?.length || 0) +
      (starIds.songIds?.length || 0);

    const unTotal =
      (unIds.artistIds?.length || 0) +
      (unIds.albumIds?.length || 0) +
      (unIds.songIds?.length || 0);

    await patchRunStats(runId, { star_total: starTotal, unstar_total: unTotal });

    const client = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
    await client.ensureAuthHealthy();

    await dblog(runId, 'info', 'Apply plan prepared', {
      star: {
        artists: starIds.artistIds?.length || 0,
        albums:  starIds.albumIds?.length  || 0,
        songs:   starIds.songIds?.length   || 0,
      },
      unstar: {
        artists: unIds.artistIds?.length || 0,
        albums:  unIds.albumIds?.length  || 0,
        songs:   unIds.songIds?.length   || 0,
      },
      unresolved: plan.counts.unresolved,
      dryRun: !!opts.dryRun,
    });

    if (!opts.dryRun) {
      let starDone = 0;
      let unDone = 0;

      // перед STAR — отметим planned для тех YM, у кого уже есть ndSongId
      const plannedPairs = plan.starSongMap.filter(x => x.ndSongId).map(x => ({ ymId: x.ymId, ndId: x.ndSongId! }));
      if (plannedPairs.length) {
        const nowTs = new Date();
        await dblog(runId, 'debug', 'Mark LikeSync planned (tracks)', { count: plannedPairs.length });
        for (const batch of chunk(plannedPairs, 300)) {
          for (const p of batch) {
            await prisma.yandexLikeSync.upsert({
              where: { kind_ymId: { kind: 'track', ymId: p.ymId } },
              create: { kind: 'track', ymId: p.ymId, ndId: p.ndId, starPlannedAt: nowTs, lastTriedAt: nowTs, status: 'pending', starRunId: runId },
              update: { ndId: p.ndId, starPlannedAt: nowTs, lastTriedAt: nowTs, status: 'pending', starRunId: runId },
            });
          }
        }
      }

      // STAR — artists
      if (starIds.artistIds?.length) {
        await dblog(runId, 'info', 'Starring artists…', { count: starIds.artistIds.length, sample: starIds.artistIds.slice(0, 5) });
        for (const ids of chunk(starIds.artistIds, 200)) {
          if (ids.length) await client.star({ artistIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — albums
      if (starIds.albumIds?.length) {
        await dblog(runId, 'info', 'Starring albums…', { count: starIds.albumIds.length, sample: starIds.albumIds.slice(0, 5) });
        for (const ids of chunk(starIds.albumIds, 200)) {
          if (ids.length) await client.star({ albumIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — songs
      if (starIds.songIds?.length) {
        await dblog(runId, 'info', 'Starring songs…', { count: starIds.songIds.length, sample: starIds.songIds.slice(0, 5) });
        for (const ids of chunk(starIds.songIds, 500)) {
          if (ids.length) await client.star({ songIds: ids });
          starDone += ids.length;
          if (starDone % 500 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // UNSTAR — only when policy=yandex
      if (unIds.artistIds?.length) {
        await dblog(runId, 'info', 'Unstarring artists…', { count: unIds.artistIds.length, sample: unIds.artistIds.slice(0, 5) });
        for (const ids of chunk(unIds.artistIds, 200)) {
          if (ids.length) await client.unstar({ artistIds: ids });
          unDone += ids.length;
          if (unDone % 200 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }
      if (unIds.albumIds?.length) {
        await dblog(runId, 'info', 'Unstarring albums…', { count: unIds.albumIds.length, sample: unIds.albumIds.slice(0, 5) });
        for (const ids of chunk(unIds.albumIds, 200)) {
          if (ids.length) await client.unstar({ albumIds: ids });
          unDone += ids.length;
          if (unDone % 200 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }
      if (unIds.songIds?.length) {
        await dblog(runId, 'info', 'Unstarring songs…', { count: unIds.songIds.length, sample: unIds.songIds.slice(0, 5) });
        for (const ids of chunk(unIds.songIds, 500)) {
          if (ids.length) await client.unstar({ songIds: ids });
          unDone += ids.length;
          if (unDone % 500 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }
    }

    // ===== Подтверждение через getStarred2 + фиксация LikeSync
    const after = await client.getStarred2();

    // Индексы метаданных по songId из getStarred2 (для STAR OK)
    const songMetaById = new Map<string, { artist?: string; album?: string; title?: string }>();
    for (const s of after.songs || []) {
      songMetaById.set(s.id, { artist: s.artist, album: s.album, title: s.title });
    }

    // Кэш для точечного получения меты песни при FAIL
    const getSongCache = new Map<string, { artist?: string; album?: string; title?: string }>();
    async function getSongMeta(id: string) {
      if (getSongCache.has(id)) return getSongCache.get(id)!;
      try {
        const s = await client.getSong(id);
        const meta = { artist: s?.artist as (string|undefined), album: s?.album as (string|undefined), title: s?.title as (string|undefined) };
        getSongCache.set(id, meta);
        return meta;
      } catch {
        const meta = { artist: undefined, album: undefined, title: undefined };
        getSongCache.set(id, meta);
        return meta;
      }
    }

    function fmtAAT(a?: string|null, al?: string|null, t?: string|null) {
      const aa = (a ?? '').trim() || '-';
      const alb = (al ?? '').trim() || '-';
      const tt = (t ?? '').trim() || '-';
      return `${aa} — ${alb} — ${tt}`;
    }

    const starredSongIds = new Set((after.songs || []).map(s => s.id));
    await dblog(runId, 'info', 'Navidrome starred after-apply', { songs: after.songs?.length || 0 });

    let perItemOk = 0;
    let perItemFail = 0;

    for (const row of plan.starSongMap) {
      if (!row.ndSongId) {
        const msgSuffix = fmtAAT(row.artist, '-', row.title);
        await dblog(runId, 'info', `STAR SKIP (no ND id) — ${msgSuffix}`, {
          ymId: row.ymId, artist: row.artist, album: null, title: row.title, dur: row.durationSec,
        });
        continue;
      }
      const ok = starredSongIds.has(row.ndSongId);
      if (ok) {
        perItemOk++;
        const meta = songMetaById.get(row.ndSongId) || {};
        const msgSuffix = fmtAAT(meta.artist ?? row.artist, meta.album, meta.title ?? row.title);
        await dblog(runId, 'info', `STAR OK (song) — ${msgSuffix}`, {
          ymId: row.ymId, ndId: row.ndSongId, artist: meta.artist ?? row.artist, album: meta.album ?? null, title: meta.title ?? row.title, dur: row.durationSec,
        });
        await prisma.yandexLikeSync.upsert({
          where: { kind_ymId: { kind: 'track', ymId: row.ymId } },
          create: { kind: 'track', ymId: row.ymId, ndId: row.ndSongId, status: 'synced', starConfirmedAt: new Date(), lastError: null, lastSeenAt: new Date() },
          update: { ndId: row.ndSongId, status: 'synced', starConfirmedAt: new Date(), lastError: null, lastSeenAt: new Date() },
        });
      } else {
        perItemFail++;
        const meta = await getSongMeta(row.ndSongId);
        const msgSuffix = fmtAAT(meta.artist ?? row.artist, meta.album, meta.title ?? row.title);
        await dblog(runId, 'info', `STAR FAIL (not starred in ND) — ${msgSuffix}`, {
          ymId: row.ymId, ndId: row.ndSongId, artist: meta.artist ?? row.artist, album: meta.album ?? null, title: meta.title ?? row.title, dur: row.durationSec,
        });
        await prisma.yandexLikeSync.upsert({
          where: { kind_ymId: { kind: 'track', ymId: row.ymId } },
          create: { kind: 'track', ymId: row.ymId, ndId: row.ndSongId, status: 'pending', lastError: 'not-starred-in-nd-after-apply', lastSeenAt: new Date() },
          update: { ndId: row.ndSongId, status: 'pending', lastError: 'not-starred-in-nd-after-apply', lastSeenAt: new Date() },
        });
      }
    }

    await dblog(runId, 'info', 'Apply per-item result (counts)', {
      starTotal,
      unTotal,
      starOk: perItemOk,
      starFail: perItemFail,
      ndStarredNow: after.songs?.length || 0,
    });

    await dblog(runId, 'info', 'Navidrome apply done', {
      target: opts.target,
      star_total: starTotal, unstar_total: unTotal,
      unresolved: plan.counts.unresolved,
      dryRun: !!opts.dryRun,
    });
    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
  } catch (e: any) {
    await dblog(runId, 'error', 'Navidrome apply failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
  }
}
