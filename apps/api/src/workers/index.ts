// apps/api/src/workers/index.ts
export { runYandexPull } from './yandexPull.js';
export { runLidarrPull, runLidarrPullEx } from './lidarrPull.js';
export { runMbMatch, runCustomArtistsMatch } from './mbMatch.js';
export { runLidarrPush } from './lidarrPush.js';
export { runLidarrSearchArtists } from './lidarrSearchArtists.js';
import { startRun } from '../log.js';
import { runYandexPull as _runYandexPull } from './yandexPull.js';
import { runMbMatch as _runMbMatch } from './mbMatch.js';
import { runLidarrPush as _runLidarrPush } from './lidarrPush.js';

export async function runCustomMatchAll(reuseRunId?: number, opts?: { force?: boolean }) {
  const { runCustomArtistsMatch } = await import('./mbMatch.js');
  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('custom.match.all', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
  if (!run) return;
  return runCustomArtistsMatch(run.id, { force: !!opts?.force });
}

export async function runCustomPushAll(reuseRunId?: number) {
  const { runLidarrPushEx } = await import('./lidarrPush.js');
  return runLidarrPushEx({
    target: 'artists',
    source: 'custom',
    reuseRunId,
    kindOverride: 'custom.push.all',
  });
}

export async function runYandexPullAll(reuseRunId?: number) {
  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('yandex.pull.all', {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      al_total: 0,
      al_done: 0,
    });
  if (!run) return;
  return _runYandexPull(undefined, run.id);
}

export async function runYandexMatch(
  target: 'artists'|'albums'|'both' = 'both',
  opts?: { force?: boolean; reuseRunId?: number },
) {
  const kind =
    target === 'artists' ? 'yandex.match.artists' :
      target === 'albums'  ? 'yandex.match.albums'  :
        'yandex.match.all';

  const run = opts?.reuseRunId
    ? { id: opts.reuseRunId }
    : await startRun(kind, {
      phase: 'start',
      a_total: 0,
      a_done: 0,
      a_matched: 0,
      al_total: 0,
      al_done: 0,
      al_matched: 0,
    });

  if (!run) return;
  return _runMbMatch(run.id, { target, force: !!opts?.force });
}

export async function runYandexPush(
  target: 'artists' | 'albums' | 'both' = 'artists',
  opts?: { reuseRunId?: number },
) {
  const { runLidarrPushEx } = await import('./lidarrPush.js');
  const kind =
    target === 'artists'
      ? 'yandex.push.artists'
      : target === 'albums'
        ? 'yandex.push.albums'
        : 'yandex.push.all';

  const run = opts?.reuseRunId
    ? { id: opts.reuseRunId }
    : await startRun(kind, {
      phase: 'start',
      total: 0,
      done: 0,
      ok: 0,
      failed: 0,
      target,
    });
  if (!run) return;

  if (target === 'both') {
    await runLidarrPushEx({
      target: 'artists',
      source: 'yandex',
      reuseRunId: run.id,
      noFinalize: true,
      kindOverride: kind,
    });
    await runLidarrPushEx({
      target: 'albums',
      source: 'yandex',
      reuseRunId: run.id,
      kindOverride: kind,
    });
    return;
  } else {
    return runLidarrPushEx({
      target,
      source: 'yandex',
      reuseRunId: run.id,
      kindOverride: kind,
    });
  }
}
