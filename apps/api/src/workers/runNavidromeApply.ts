// apps/api/src/workers/runNavidromeApply.ts
import { startRun, endRun, patchRunStats, log as dblog } from '../log';
import { createLogger } from '../lib/logger';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import {
  computeNavidromePlan,
  type Policy,
  type PlanTarget,
} from './runNavidromePlan';

const log = createLogger({ scope: 'worker.nav.apply' });

type ApplyOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy: Policy;
  withNdState?: boolean; // default true
  dryRun?: boolean;       // если true — только посчитать и залогировать
  reuseRunId?: number;    // ⟵ новый: если есть — используем готовый run
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runNavidromeApply(opts: ApplyOpts) {
  // если run уже создан роутом — используем его
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
    const plan = await computeNavidromePlan({
      navUrl: opts.navUrl,
      auth: opts.auth,
      target: opts.target,
      policy: opts.policy,
      withNdState: opts.withNdState ?? true,
      resolveIds: true, // для apply резолвим ID
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

    const client = new NavidromeClient(opts.navUrl, opts.auth);

    // промежуточные логи по подсекциям
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

      // STAR — artists
      if (starIds.artistIds?.length) {
        await dblog(runId, 'info', 'Starring artists…', { count: starIds.artistIds.length });
        for (const ids of chunk(starIds.artistIds, 200)) {
          if (ids.length) await client.star({ artistIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) {
            await patchRunStats(runId, { star_done: starDone });
            await dblog(runId, 'debug', 'Star artists progress', { done: starDone });
          }
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — albums
      if (starIds.albumIds?.length) {
        await dblog(runId, 'info', 'Starring albums…', { count: starIds.albumIds.length });
        for (const ids of chunk(starIds.albumIds, 200)) {
          if (ids.length) await client.star({ albumIds: ids });
          starDone += ids.length;
          if (starDone % 200 === 0) {
            await patchRunStats(runId, { star_done: starDone });
            await dblog(runId, 'debug', 'Star albums progress', { done: starDone });
          }
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — songs
      if (starIds.songIds?.length) {
        await dblog(runId, 'info', 'Starring songs…', { count: starIds.songIds.length });
        for (const ids of chunk(starIds.songIds, 500)) {
          if (ids.length) await client.star({ songIds: ids });
          starDone += ids.length;
          if (starDone % 500 === 0) {
            await patchRunStats(runId, { star_done: starDone });
            await dblog(runId, 'debug', 'Star songs progress', { done: starDone });
          }
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // UNSTAR — artists
      if (unIds.artistIds?.length) {
        await dblog(runId, 'info', 'Unstarring artists…', { count: unIds.artistIds.length });
        for (const ids of chunk(unIds.artistIds, 200)) {
          if (ids.length) await client.unstar({ artistIds: ids });
          unDone += ids.length;
          if (unDone % 200 === 0) {
            await patchRunStats(runId, { unstar_done: unDone });
            await dblog(runId, 'debug', 'Unstar artists progress', { done: unDone });
          }
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }

      // UNSTAR — albums
      if (unIds.albumIds?.length) {
        await dblog(runId, 'info', 'Unstarring albums…', { count: unIds.albumIds.length });
        for (const ids of chunk(unIds.albumIds, 200)) {
          if (ids.length) await client.unstar({ albumIds: ids });
          unDone += ids.length;
          if (unDone % 200 === 0) {
            await patchRunStats(runId, { unstar_done: unDone });
            await dblog(runId, 'debug', 'Unstar albums progress', { done: unDone });
          }
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }

      // UNSTAR — songs
      if (unIds.songIds?.length) {
        await dblog(runId, 'info', 'Unstarring songs…', { count: unIds.songIds.length });
        for (const ids of chunk(unIds.songIds, 500)) {
          if (ids.length) await client.unstar({ songIds: ids });
          unDone += ids.length;
          if (unDone % 500 === 0) {
            await patchRunStats(runId, { unstar_done: unDone });
            await dblog(runId, 'debug', 'Unstar songs progress', { done: unDone });
          }
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }
    }

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
