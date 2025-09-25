// apps/api/src/routes/sync.ts
import { Router } from 'express';

import { startRun } from '../log';
import { prisma } from '../prisma';
import {
  runYandexPull,
  runLidarrPull,
  runMbMatch,
  runLidarrPush,
  runCustomMatchAll,
  runCustomPushAll,
  runYandexPullAll,
  runYandexMatch,
  runYandexPush,
  runLidarrPullEx,
} from '../workers';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.sync' });

r.post('/yandex/pull', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const override =
      typeof req.body?.token === 'string' && req.body.token.trim()
        ? req.body.token.trim()
        : undefined;

    lg.info(
      'yandex pull requested',
      'sync.yandex.pull.start',
      { override: !!override },
    );

    const run = await startRun('yandex', {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      al_total: 0,
      al_done: 0,
    });

    runYandexPull(override, run.id).catch((e) => {
      lg.error('worker crash (yandex pull)', 'sync.yandex.pull.worker.fail', {
        runId: run.id,
        err: e?.message,
      });
    });

    lg.info('yandex pull started', 'sync.yandex.pull.started', {
      runId: run.id,
    });
    res.json({ started: true, runId: run.id });
  } catch (e: any) {
    lg.error('yandex pull request failed', 'sync.yandex.pull.fail', {
      err: e?.message,
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.post('/lidarr/pull', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const target = (req.body?.target || req.query.target) as
      | 'artists'
      | 'albums'
      | 'both'
      | undefined;

    if (target) {
      const kind =
        target === 'artists'
          ? 'lidarr.pull.artists'
          : target === 'albums'
            ? 'lidarr.pull.albums'
            : 'lidarr.pull.all';

      lg.info(
        'lidarr pull requested (extended)',
        'sync.lidarr.pullEx.start',
        { target, kind },
      );

      const run = await startRun(kind, {
        phase: 'start',
        total: 0,
        done: 0,
        albumsTotal: 0,
        albumsDone: 0,
      });
      runLidarrPullEx(target, run.id).catch((e) => {
        lg.error(
          'worker crash (lidarr pullEx)',
          'sync.lidarr.pullEx.worker.fail',
          { runId: run.id, err: e?.message },
        );
      });
      lg.info('lidarr pullEx started', 'sync.lidarr.pullEx.started', {
        runId: run.id,
        target,
      });
      return res.json({ started: true, runId: run.id, target });
    }

    lg.info(
      'lidarr pull requested (legacy both)',
      'sync.lidarr.pull.start',
    );

    const run = await startRun('lidarr', {
      phase: 'start',
      total: 0,
      done: 0,
    });
    runLidarrPull(run.id).catch((e) => {
      lg.error(
        'worker crash (lidarr pull)',
        'sync.lidarr.pull.worker.fail',
        { runId: run.id, err: e?.message },
      );
    });
    lg.info('lidarr pull started', 'sync.lidarr.pull.started', {
      runId: run.id,
      target: 'both',
    });
    res.json({ started: true, runId: run.id, target: 'both' });
  } catch (e: any) {
    lg.error('lidarr pull request failed', 'sync.lidarr.pull.fail', {
      err: e?.message,
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * Общий MB-match endpoint.
 * force больше не читаем из body/query — поведение определяется самим воркером.
 */
r.post('/match', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const targetRaw = (req.body?.target || req.query.target) as any; // 'artists' | 'albums' | 'both'
    const target = ['artists', 'albums', 'both'].includes(targetRaw) ? targetRaw : 'both';

    // force только из БД
    const settings = await prisma.setting.findFirst();
    const force = !!(settings as any)?.mbMatchForce;

    lg.info('mb match requested', 'sync.match.start', { force, target });

    const run = await startRun('match', {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      a_matched: 0,
      al_total: 0,
      al_done: 0,
      al_matched: 0,
    });

    runMbMatch(run.id, { force, target }).catch((e) => {
      lg.error('worker crash (mb match)', 'sync.match.worker.fail', { runId: run.id, err: e?.message });
    });

    lg.info('mb match started', 'sync.match.started', { runId: run.id });
    res.json({ started: true, runId: run.id, force, target });
  } catch (e: any) {
    lg.error('mb match request failed', 'sync.match.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.post('/lidarr', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const t =
      req.body?.target === 'albums'
        ? 'albums'
        : req.body?.target === 'artists'
          ? 'artists'
          : undefined;
    const src = req.body?.source === 'custom' ? 'custom' : 'yandex';

    lg.info(
      'lidarr push requested',
      'sync.lidarr.push.start',
      { target: t ?? 'from-settings', source: src },
    );

    runLidarrPush(t, src).catch((e) => {
      lg.error(
        'worker crash (lidarr push)',
        'sync.lidarr.push.worker.fail',
        { target: t, source: src, err: e?.message },
      );
    });

    res.json({ started: true, target: t ?? 'from-settings', source: src });
  } catch (e: any) {
    lg.error('lidarr push request failed', 'sync.lidarr.push.fail', {
      err: e?.message,
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.post('/runs/:id/stop', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      lg.warn(
        'bad run id for stop',
        'sync.runs.stop.badid',
        { raw: req.params.id },
      );
      return res.status(400).json({ ok: false, error: 'bad runId' });
    }

    lg.info('stop run requested', 'sync.runs.stop.start', { id });

    const run = await prisma.syncRun.findUnique({ where: { id } });
    if (!run) {
      lg.warn('run not found', 'sync.runs.stop.notfound', { id });
      return res.status(404).json({ ok: false, error: 'not found' });
    }
    if (run.status !== 'running') {
      lg.info(
        'run already finished',
        'sync.runs.stop.already',
        { id, status: run.status },
      );
      return res.json({ ok: true, alreadyFinished: true });
    }

    let stats: any = {};
    try {
      stats = run.stats ? JSON.parse(run.stats) : {};
    } catch {}
    stats.cancel = true;

    await prisma.syncRun.update({
      where: { id },
      data: {
        stats: JSON.stringify(stats),
        message: 'Cancel requested',
      },
    });

    lg.info('stop flag set', 'sync.runs.stop.done', { id });
    return res.json({ ok: true });
  } catch (e: any) {
    lg.error('stop run failed', 'sync.runs.stop.fail', {
      err: e?.message,
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * Custom match-all: force убран из публичного API.
 * Сейчас это всегда «обычный» матч без форса.
 */
r.post('/custom/match', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    // force только из БД
    const settings = await prisma.setting.findFirst();
    const force = !!(settings as any)?.customMatchForce;

    lg.info('custom match-all requested', 'sync.custom.matchAll.start', { force });

    const run = await startRun('custom.match.all', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
    runCustomMatchAll(run.id, { force }).catch((e) => {
      lg.error('worker crash (custom match-all)', 'sync.custom.matchAll.worker.fail', { runId: run.id, err: e?.message });
    });

    res.json({ started: true, runId: run.id, force });
  } catch (e: any) {
    lg.error('custom match-all request failed', 'sync.custom.matchAll.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * Custom push-all: force убран — allowRepushOverride теперь не
 * прокидывается снаружи (будет управляться настройками внутри воркера).
 */
r.post('/custom/push', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    lg.info(
      'custom push-all requested',
      'sync.custom.pushAll.start',
    );

    const run = await startRun('custom.push.all', {
      phase: 'start',
      total: 0,
      done: 0,
      ok: 0,
      failed: 0,
    });
    runCustomPushAll(run.id).catch((e) => {
      lg.error(
        'worker crash (custom push-all)',
        'sync.custom.pushAll.worker.fail',
        { runId: run.id, err: e?.message },
      );
    });

    res.json({ started: true, runId: run.id });
  } catch (e: any) {
    lg.error(
      'custom push-all request failed',
      'sync.custom.pushAll.fail',
      { err: e?.message },
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.post('/yandex/pull-all', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    lg.info(
      'yandex pull-all requested',
      'sync.yandex.pullAll.start',
    );

    const run = await startRun('yandex.pull.all', {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      al_total: 0,
      al_done: 0,
    });
    runYandexPullAll(run.id).catch((e) => {
      lg.error(
        'worker crash (yandex pull-all)',
        'sync.yandex.pullAll.worker.fail',
        { runId: run.id, err: e?.message },
      );
    });

    res.json({ started: true, runId: run.id });
  } catch (e: any) {
    lg.error(
      'yandex pull-all request failed',
      'sync.yandex.pullAll.fail',
      { err: e?.message },
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * Yandex match: force больше не идёт из body/query.
 * Сейчас force зашит в воркере (см. runYandexMatch).
 */
r.post('/yandex/match', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const target = (req.body?.target || req.query.target || 'both') as 'artists'|'albums'|'both';
    const kind   = target==='artists'?'yandex.match.artists':target==='albums'?'yandex.match.albums':'yandex.match.all';

    // force только из БД
    const settings = await prisma.setting.findFirst();
    const force = !!(settings as any)?.yandexMatchForce;

    lg.info('yandex match requested', 'sync.yandex.match.start', { target, force, kind });

    const run = await startRun(kind, {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      a_matched: 0,
      al_total: 0,
      al_done: 0,
      al_matched: 0,
    });

    runYandexMatch(target, { force, reuseRunId: run.id }).catch((e) => {
      lg.error('worker crash (yandex match)', 'sync.yandex.match.worker.fail', { runId: run.id, err: e?.message });
    });

    res.json({ started: true, runId: run.id, target, force });
  } catch (e: any) {
    lg.error('yandex match request failed', 'sync.yandex.match.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});



r.post('/yandex/push', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const target = (req.body?.target || req.query.target || 'artists') as
      | 'artists'
      | 'albums'
      | 'both';
    const kind =
      target === 'artists'
        ? 'yandex.push.artists'
        : target === 'albums'
          ? 'yandex.push.albums'
          : 'yandex.push.all';

    lg.info('yandex push requested', 'sync.yandex.push.start', {
      target,
      kind,
    });

    const run = await startRun(kind, {
      phase: 'start',
      total: 0,
      done: 0,
      ok: 0,
      failed: 0,
      target,
    });
    runYandexPush(target, { reuseRunId: run.id }).catch((e) => {
      lg.error(
        'worker crash (yandex push)',
        'sync.yandex.push.worker.fail',
        { runId: run.id, err: e?.message },
      );
    });

    res.json({ started: true, runId: run.id, target });
  } catch (e: any) {
    lg.error('yandex push request failed', 'sync.yandex.push.fail', {
      err: e?.message,
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.get('/runs', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const kind = (req.query.kind as string) || undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(200, Math.max(1, limitRaw))
      : 20;

    lg.info(
      'list runs requested (sync view)',
      'sync.runs.list.start',
      { kind, limit },
    );

    const items = await prisma.syncRun.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    lg.debug('runs fetched', 'sync.runs.list.done', {
      count: items.length,
    });
    res.json({ ok: true, runs: items });
  } catch (e: any) {
    lg.error(
      'list runs failed (sync view)',
      'sync.runs.list.fail',
      { err: e?.message },
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.get('/runs/:id', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const id = Number(req.params.id);
    lg.info(
      'get run requested (sync view)',
      'sync.runs.item.start',
      { id },
    );

    const run = await prisma.syncRun.findUnique({ where: { id } });
    res.json(run);

    lg.debug('get run done (sync view)', 'sync.runs.item.done', {
      exists: !!run,
    });
  } catch (e: any) {
    lg.error(
      'get run failed (sync view)',
      'sync.runs.item.fail',
      { err: e?.message },
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.get('/runs/:id/logs', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const id = Number(req.params.id);
    const afterId = req.query.after ? Number(req.query.after) : 0;

    lg.info(
      'get run logs requested (sync view)',
      'sync.runs.logs.start',
      { id, afterId },
    );

    const logs = await prisma.syncLog.findMany({
      where: { runId: id, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: 'asc' },
      take: 200,
    });

    lg.debug(
      'get run logs done (sync view)',
      'sync.runs.logs.done',
      {
        count: logs.length,
        nextAfter: logs.length
          ? logs[logs.length - 1].id
          : afterId,
      },
    );
    res.json(logs);
  } catch (e: any) {
    lg.error(
      'get run logs failed (sync view)',
      'sync.runs.logs.fail',
      { err: e?.message },
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default r;
