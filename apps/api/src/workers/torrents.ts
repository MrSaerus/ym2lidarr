// apps/api/src/workers/torrents.ts
import { prisma } from '../prisma';
import {
  startRunWithKind,
  evStart,
  evFinish,
  evError,
  dblog,
  patchRunStats,
  now,
  elapsedMs,
  endRun,
} from './_common';
import { autoPollQbt, autoCopyDownloaded } from '../services/torrents';
import { runUnmatchedInternal } from '../services/torrentsPipeline';

export async function runTorrentsUnmatched(reuseRunId?: number) {
  const settings = await prisma.setting.findFirst({ where: { id: 1 } });
  const limit = settings?.torrentRunUnmatchedLimit ?? 10;
  const minSeeders = settings?.torrentRunUnmatchedMinSeeders ?? 1;
  const limitPerIndexer = settings?.torrentRunUnmatchedLimitPerIndexer ?? 20;
  const autoStart = settings?.torrentRunUnmatchedAutoStart ?? true;
  const parallelSearches = settings?.torrentRunUnmatchedParallelSearches ?? 10;

  const run = await startRunWithKind(
    'torrents.unmatched',
    {
      phase: 'start',
      limit,
      minSeeders,
      limitPerIndexer,
      autoStart,
      parallelSearches,
    },
    reuseRunId
  );
  if (!run) return;

  const runId = run.id;
  const t0 = now();

  await evStart(runId, {
    kind: 'torrents.unmatched',
    limit,
    minSeeders,
    limitPerIndexer,
    autoStart,
    parallelSearches,
  });

  try {
    const res = await runUnmatchedInternal(
      {
        limit,
        minSeeders,
        limitPerIndexer,
        autoStart,
        parallelSearches,
        dryRun: false,
      },
      runId,
    );

    await patchRunStats(runId, {
      phase: 'done',
      ...res.stats,
    });

    await evFinish(runId, {
      kind: 'torrents.unmatched',
      elapsedMs: elapsedMs(t0),
      ...res.stats,
    });

    await endRun(runId, 'ok');
  } catch (e: any) {
    const err = e?.message || String(e);
    await dblog(runId, 'error', 'torrents.unmatched failed', { error: err });
    await evError(runId, {
      kind: 'torrents.unmatched',
      error: err,
      elapsedMs: elapsedMs(t0),
    });

    await endRun(runId, 'error', err);
  }
}

export async function runTorrentsPoll(reuseRunId?: number) {
  const settings = await prisma.setting.findFirst({ where: { id: 1 } });
  const batchSize = settings?.torrentQbtPollBatchSize ?? 50;

  const run = await startRunWithKind(
    'torrents.poll',
    {
      phase: 'start',
      batchSize,
    },
    reuseRunId,
  );
  if (!run) return;

  const runId = run.id;
  const t0 = now();

  await evStart(runId, {
    kind: 'torrents.poll',
    batchSize,
  });

  try {
    const res = await autoPollQbt({ batchSize });

    await patchRunStats(runId, {
      phase: 'done',
      ...res,
    });

    const elapsed = elapsedMs(t0);

    await evFinish(runId, {
      kind: 'torrents.poll',
      elapsedMs: elapsed,
      ...res,
    });

    await endRun(runId, 'ok');
  } catch (e: any) {
    const err = e?.message || String(e);
    await dblog(runId, 'error', 'torrents.poll failed', { error: err });

    await evError(runId, {
      kind: 'torrents.poll',
      error: err,
      elapsedMs: elapsedMs(t0),
    });

    await endRun(runId, 'error', err);
  }
}

export async function runTorrentsCopyDownloaded(reuseRunId?: number) {
  const settings = await prisma.setting.findFirst({ where: { id: 1 } });
  const batchSize = settings?.torrentCopyBatchSize ?? 20;

  const run = await startRunWithKind(
    'torrents.copy',
    {
      phase: 'start',
      batchSize,
    },
    reuseRunId
  );
  if (!run) return;

  const runId = run.id;
  const t0 = now();

  await evStart(runId, {
    kind: 'torrents.copy',
    batchSize,
  });

  try {
    const res = await autoCopyDownloaded({ batchSize, runId });

    await patchRunStats(runId, {
      phase: 'done',
      ...res,
    });

    const elapsed = elapsedMs(t0);

    if (res.errors && res.errors > 0) {
      const msg = `Torrent copy finished with ${res.errors} error(s) (copied=${res.copied}, skipped=${res.skipped})`;

      await dblog(runId, 'error', msg, { ...res });
      await evError(runId, {
        kind: 'torrents.copy',
        error: msg,
        elapsedMs: elapsed,
        ...res,
      });

      await endRun(runId, 'error', msg);
    } else {
      await evFinish(runId, {
        kind: 'torrents.copy',
        elapsedMs: elapsed,
        ...res,
      });

      await endRun(runId, 'ok');
    }
  } catch (e: any) {
    const err = e?.message || String(e);

    await dblog(runId, 'error', 'torrents.copy failed', { error: err });

    await evError(runId, {
      kind: 'torrents.copy',
      error: err,
      elapsedMs: elapsedMs(t0),
    });

    await endRun(runId, 'error', err);
  }
}
