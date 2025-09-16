// apps/api/src/workers/runNavidromeApply.ts
import { startRun, endRun, patchRunStats, log as dblog } from '../log';
import { createLogger } from '../lib/logger';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import {
  computeNavidromePlan,
  type PlanTarget,
  type Policy,
} from './runNavidromePlan';
import { prisma } from '../prisma';

const log = createLogger({ scope: 'worker.nav.apply' });

type ApplyOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy?: Policy;       // игнорируется
  withNdState?: boolean; // игнорируется
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
    await dblog(runId, 'info', 'Navidrome apply continue (new logic)', {
      target: opts.target, dryRun: !!opts.dryRun,
    });
  } else {
    const run = await startRun('navidrome.apply', {
      phase: 'apply',
      target: opts.target,
      policy: 'n/a',
      star_total: 0, star_done: 0,
      unstar_total: 0, unstar_done: 0, // остаются в схеме run, но не используются
      dryRun: !!opts.dryRun,
    });
    if (!run) return;
    runId = run.id;
    await dblog(runId, 'info', 'Navidrome apply start (new logic)', {
      target: opts.target, dryRun: !!opts.dryRun,
    });
  }

  try {
    const client = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
    await client.ensureAuthHealthy();

    // План: резолвим недостающие ndId, ничего не сравниваем с состоянием ND
    const plan = await computeNavidromePlan({
      navUrl: opts.navUrl,
      auth: opts.auth,
      target: opts.target,
      resolveIds: true,
      authPass: opts.authPass,
    });

    // Обновим БД найденными ndId (artists/albums/tracks)
    if (!opts.dryRun) {
      const nowTs = new Date();

      // --- Artists
      if (plan.resolved.artists.length) {
        await dblog(runId, 'info', 'Saving resolved ndId (artists)…', { count: plan.resolved.artists.length });
        for (const batch of chunk(plan.resolved.artists, 200)) {
          for (const r of batch) {
            await prisma.yandexArtist.updateMany({
              where: { key: r.key, present: true, yGone: false },
              data: { ndId: r.ndId },
            });
          }
        }
      }

      // --- Albums
      if (plan.resolved.albums.length) {
        await dblog(runId, 'info', 'Saving resolved ndId (albums)…', { count: plan.resolved.albums.length });
        for (const batch of chunk(plan.resolved.albums, 200)) {
          for (const r of batch) {
            await prisma.yandexAlbum.updateMany({
              where: { key: r.key, present: true, yGone: false },
              data: { ndId: r.ndId },
            });
          }
        }
      }

      // --- Tracks → LikeSync.ndId + планирование лайка
      const trackPairs = plan.starSongMap.filter(x => x.ndSongId).map(x => ({ ymId: x.ymId, ndId: x.ndSongId! }));
      if (trackPairs.length) {
        await dblog(runId, 'info', 'Saving resolved ndId (tracks)…', { count: trackPairs.length });
        for (const batch of chunk(trackPairs, 500)) {
          for (const p of batch) {
            await prisma.yandexLikeSync.upsert({
              where: { kind_ymId: { kind: 'track', ymId: p.ymId } },
              create: { kind: 'track', ymId: p.ymId, ndId: p.ndId, starPlannedAt: nowTs, lastTriedAt: nowTs, status: 'pending', starRunId: runId },
              update: { ndId: p.ndId, starPlannedAt: nowTs, lastTriedAt: nowTs, starRunId: runId },
            });
          }
        }
      }
    }

    const starIds = plan.toStar;
    const starTotal =
      (starIds.artistIds?.length || 0) +
      (starIds.albumIds?.length  || 0) +
      (starIds.songIds?.length   || 0);

    await patchRunStats(runId, { star_total: starTotal });

    await dblog(runId, 'info', 'Apply plan prepared (new logic)', {
      star: {
        artists: starIds.artistIds?.length || 0,
        albums:  starIds.albumIds?.length  || 0,
        songs:   starIds.songIds?.length   || 0,
      },
      unresolved: plan.counts.unresolved,
      dryRun: !!opts.dryRun,
    });

    // ===== Ставим лайки (только STAR)
    if (!opts.dryRun) {
      let starDone = 0;

      if (starIds.artistIds?.length) {
        await dblog(runId, 'info', 'Starring artists…', { count: starIds.artistIds.length, sample: starIds.artistIds.slice(0, 5) });
        for (const ids of chunk(starIds.artistIds, 200)) {
          if (ids.length) await client.star({ artistIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      if (starIds.albumIds?.length) {
        await dblog(runId, 'info', 'Starring albums…', { count: starIds.albumIds.length, sample: starIds.albumIds.slice(0, 5) });
        for (const ids of chunk(starIds.albumIds, 200)) {
          if (ids.length) await client.star({ albumIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      if (starIds.songIds?.length) {
        await dblog(runId, 'info', 'Starring songs…', { count: starIds.songIds.length, sample: starIds.songIds.slice(0, 5) });
        for (const ids of chunk(starIds.songIds, 500)) {
          if (ids.length) await client.star({ songIds: ids });
          starDone += ids.length;
          if (starDone % 500 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }
    }

    // ===== Подтверждение для треков (по желанию: оставил как было — это не UNSTAR)
    const after = await client.getStarred2();
    const starredSongIds = new Set((after.songs || []).map(s => s.id));
    await dblog(runId, 'info', 'Navidrome starred after-apply', { songs: after.songs?.length || 0 });

    let perItemOk = 0;
    let perItemFail = 0;

    // лёгкий кэш для getSong метаданных
    const getSongCache = new Map<string, { artist?: string; album?: string; title?: string }>();
    async function getSongMeta(id: string) {
      if (getSongCache.has(id)) return getSongCache.get(id)!;
      try {
        const s = await client.getSong(id);
        const meta = { artist: s?.artist as (string|undefined), album: s?.album as (string|undefined), title: s?.title as (string|undefined) };
        getSongCache.set(id, meta); return meta;
      } catch { const meta = { artist: undefined, album: undefined, title: undefined }; getSongCache.set(id, meta); return meta; }
    }
    function fmtAAT(a?: string|null, al?: string|null, t?: string|null) {
      const aa = (a ?? '').trim() || '-'; const alb = (al ?? '').trim() || '-'; const tt = (t ?? '').trim() || '-';
      return `${aa} — ${alb} — ${tt}`;
    }

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
        const meta = after.songs?.find(s => s.id === row.ndSongId) || {};
        const msgSuffix = fmtAAT((meta as any).artist ?? row.artist, (meta as any).album, (meta as any).title ?? row.title);
        await dblog(runId, 'info', `STAR OK (song) — ${msgSuffix}`, {
          ymId: row.ymId, ndId: row.ndSongId, artist: (meta as any).artist ?? row.artist, album: (meta as any).album ?? null, title: (meta as any).title ?? row.title, dur: row.durationSec,
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
      starOk: perItemOk,
      starFail: perItemFail,
      ndStarredNow: after.songs?.length || 0,
    });

    await dblog(runId, 'info', 'Navidrome apply done (new logic)', {
      target: opts.target,
      star_total: starTotal,
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
