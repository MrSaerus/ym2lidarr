// apps/api/src/services/torrentsPipeline.ts
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { createTask, addTaskToQbt, pickBestRelease } from './torrents';
import { searchTaskWithJackett } from './torznab';
import { dblog, bailIfCancelled, patchRunStats } from '../workers/_common';
import { TorrentStatus, AlbumTorrentState } from '@prisma/client';

const log = createLogger({ scope: 'svc.pipeline' });

function mapTaskStatusToAlbumTorrentState(status: TorrentStatus): AlbumTorrentState {
  switch (status) {
    case TorrentStatus.queued:
    case TorrentStatus.searching:
      return AlbumTorrentState.searching;

    case TorrentStatus.found:
      return AlbumTorrentState.found;

    case TorrentStatus.added:
    case TorrentStatus.downloading:
      return AlbumTorrentState.downloading;

    case TorrentStatus.downloaded:
    case TorrentStatus.moved:
      return AlbumTorrentState.downloaded;

    default:
      return AlbumTorrentState.none;
  }
}

export interface RunUnmatchedOptions {
  limit?: number;
  minSeeders?: number;
  limitPerIndexer?: number;
  dryRun?: boolean;
  autoStart?: boolean;
  parallelSearches?: number;
}

async function ensureNotCancelled(runId?: number, phase?: string) {
  if (!runId) return;
  const cancelled = await bailIfCancelled(runId, phase);
  if (cancelled) {
    throw new Error('Cancelled by user');
  }
}

class JackettUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JackettUnavailableError';
  }
}

class JackettFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JackettFatalError';
  }
}

type JackettAvailabilitySnapshot = {
  available: number;
  enabled: number;
  cooldown: number;
  disabled: number;
  nextAvailableAt: string | null;
  cooldownIndexers: Array<{ id: number; name: string; until: string }>;
};

async function getJackettAvailabilitySnapshot(
  now: Date = new Date(),
): Promise<JackettAvailabilitySnapshot> {
  const rows = await prisma.jackettIndexer.findMany({
    select: { id: true, name: true, enabled: true, tempDisabledUntil: true },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });

  let available = 0;
  let enabled = 0;
  let cooldown = 0;
  let disabled = 0;
  let next: Date | null = null;
  const cooldownIndexers: Array<{ id: number; name: string; until: string }> = [];

  for (const r of rows) {
    if (!r.enabled) {
      disabled += 1;
      continue;
    }

    enabled += 1;
    const until = r.tempDisabledUntil;
    if (!until || until <= now) {
      available += 1;
      continue;
    }

    cooldown += 1;
    cooldownIndexers.push({
      id: r.id,
      name: r.name,
      until: until.toISOString(),
    });

    if (!next || until < next) next = until;
  }

  return {
    available,
    enabled,
    cooldown,
    disabled,
    nextAvailableAt: next ? next.toISOString() : null,
    cooldownIndexers,
  };
}

async function ensureJackettAvailable(runId?: number, phase?: string) {
  const snap = await getJackettAvailabilitySnapshot(new Date());
  if (snap.available > 0) return snap;

  const msg =
    `No available Jackett indexers (enabled=${snap.enabled}, cooldown=${snap.cooldown}, ` +
    `disabled=${snap.disabled}, nextAt=${snap.nextAvailableAt ?? 'n/a'})`;

  log.warn('jackett unavailable', 'pipeline.jackett.unavailable', {
    phase,
    ...snap,
  });

  if (runId) {
    await dblog(runId, 'error', msg, { phase, ...snap });
  }

  throw new JackettUnavailableError(msg);
}

export async function runUnmatchedInternal(
  opts: RunUnmatchedOptions,
  runId?: number,
) {
  const {
    limit = 50,
    minSeeders = 1,
    limitPerIndexer = 20,
    dryRun = false,
    autoStart = true,
    parallelSearches = 10,
  } = opts;

  const lg = log.child({ ctx: { runId, limit, minSeeders, parallelSearches } });

  if (runId) {
    await dblog(
      runId,
      'info',
      `Run-unmatched start (limit=${limit}, minSeeders=${minSeeders}, dryRun=${dryRun})`,
    );
  }

  const oneDayAgo = new Date(Date.now() - 60 * 1000);

  const yAlbums = await prisma.yandexAlbum.findMany({
    where: {
      present: true,
      rgMbid: null,
      mbLastCheckedAt: {
        not: null,
        lt: oneDayAgo,
      },
    },
    select: { id: true, ymId: true, title: true, artist: true, year: true },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });

  const yArtists = await prisma.yandexArtist.findMany({
    where: {
      present: true,
      OR: [{ mbid: null }, { mbAlbumsCount: 0 }],
    },
    select: { ymId: true, name: true },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });

  await ensureNotCancelled(runId, 'torrents:unmatched.select');

  const stats = {
    t_total: yAlbums.length,
    t_done: 0,
    albumsTotal: yAlbums.length,
    artistsTotal: yArtists.length,
    tasksCreated: 0,
    tasksReused: 0,
    searchesOk: 0,
    searchesEmpty: 0,
    addedToQbt: 0,
    skippedExisting: 0,
    errors: 0,
  };

  if (runId) {
    await patchRunStats(runId, {
      phase: 'processing',
      t_total: stats.t_total,
      t_done: stats.t_done,
      albumsTotal: stats.albumsTotal,
      artistsTotal: stats.artistsTotal,
    });
  }


  const tasks: any[] = [];

  const buildAlbumQuery = (
    artistName: string | null,
    albumTitle: string,
    year: number | null,
  ) => {
    const parts: string[] = [];
    if (artistName) parts.push(artistName.trim());
    parts.push(albumTitle.trim());
    if (year && Number.isFinite(year)) parts.push(String(year));
    return parts.join(' - ') + ' FLAC';
  };

  if (dryRun) {
    const plan = {
      albums: yAlbums.map((a) => ({
        kind: 'album' as const,
        ymAlbumId: a.ymId,
        albumTitle: a.title,
        artistName: a.artist ?? null,
        year: a.year ?? null,
      })),
      artists: yArtists.map((a) => ({
        kind: 'artist' as const,
        ymArtistId: a.ymId,
        artistName: a.name,
      })),
    };

    if (runId) {
      await dblog(
        runId,
        'info',
        `Dry-run only, returning plan (${plan.albums.length} albums).`,
      );
    }

    return { ok: true as const, dryRun: true as const, stats, plan };
  }

  await ensureJackettAvailable(runId, 'torrents:unmatched.start');

  const batches: typeof yAlbums[] = [];
  for (let i = 0; i < yAlbums.length; i += parallelSearches) {
    batches.push(yAlbums.slice(i, i + parallelSearches));
  }

  for (const batch of batches) {
    await ensureNotCancelled(runId, 'torrents:unmatched.batch');
    await ensureJackettAvailable(runId, 'torrents:unmatched.batch');

    const promises = batch.map((a) =>
      (async () => {
        try {
          const query = buildAlbumQuery(a.artist ?? null, a.title, a.year ?? null);

          const task = await createTask({
            kind: 'album',
            artistName: a.artist ?? null,
            albumTitle: a.title,
            year: a.year ?? null,
            query,
            ymArtistId: null,
            ymAlbumId: a.ymId,
            ymTrackId: null,
            source: 'yandex',
            collisionPolicy: 'replace',
            minSeeders,
            limitReleases: null,
            indexerId: null,
            targetPath: null,
            scheduledAt: null,
          } as any);

          const existed = (task as any)._existed === true;
          if (existed) {
            stats.tasksReused += 1;
            delete (task as any)._existed;
          } else {
            stats.tasksCreated += 1;
          }

          try {
            await prisma.yandexAlbum.update({
              where: { id: a.id },
              data: {
                torrentState: mapTaskStatusToAlbumTorrentState(
                  task.status as TorrentStatus,
                ),
              },
            });
          } catch (e: any) {
            lg.warn(
              'failed to update album torrentState',
              'pipeline.run.album.torrentState.update.error',
              {
                albumId: a.id,
                ymAlbumId: a.ymId,
                taskId: task.id,
                error: e?.message || String(e),
              },
            );
          }

          if (existed) {
            const status = task.status as TorrentStatus;
            const scheduledAt = task.scheduledAt as Date | null;
            const now = new Date();

            const FINAL_STATUSES: TorrentStatus[] = [
              TorrentStatus.downloaded,
              TorrentStatus.downloading,
              TorrentStatus.added,
              TorrentStatus.moved,
              TorrentStatus.moving,
            ];

            if (FINAL_STATUSES.includes(status)) {
              stats.skippedExisting += 1;
              tasks.push(task);
              return;
            }

            if (scheduledAt && scheduledAt.getTime() > now.getTime()) {
              stats.skippedExisting += 1;
              tasks.push(task);
              return;
            }
          }

          if (runId) {
            await dblog(
              runId,
              'debug',
              `Task ${task.id} created/reused for album ${a.ymId}`,
            );
          }

          lg.debug('pipeline created/reused torrent task', 'pipeline.run.task', {
            taskId: task.id,
            existed,
            ymAlbumId: a.ymId,
            query,
          });

          const searchRes = await searchTaskWithJackett(task.id, { limitPerIndexer });

          if (!searchRes) {
            stats.errors += 1;
            const msg = `Jackett search returned no result object for task ${task.id} (album ${a.ymId})`;
            if (runId) await dblog(runId, 'error', msg);

            try {
              await prisma.yandexAlbum.update({
                where: { id: a.id },
                data: { torrentState: AlbumTorrentState.none },
              });
            } catch (e: any) {
              lg.warn(
                'failed to reset album torrentState (undefined search result)',
                'pipeline.run.album.torrentState.search.undefined',
                {
                  albumId: a.id,
                  ymAlbumId: a.ymId,
                  taskId: task.id,
                  error: e?.message || String(e),
                },
              );
            }

            lg.error(msg, 'pipeline.run.search.undefined', {
              taskId: task.id,
              ymAlbumId: a.ymId,
            });
            tasks.push(task);
            return;
          }

          if (!searchRes.ok) {
            stats.errors += 1;

            const reason = (searchRes as any).reason || 'unknown';
            const per = (searchRes as any).perIndexer || [];
            const idxErrors = per
              .filter((x: any) => x && x.error)
              .map((x: any) => `${x.name || x.id}: ${x.error}`)
              .join('; ');

            let msg: string;
            if (reason === 'no-indexers') {
              msg = `Jackett error for task ${task.id} (album ${a.ymId}): no enabled indexers`;
            } else if (reason === 'indexer-error') {
              msg = `Jackett error for task ${task.id} (album ${a.ymId}): ${idxErrors || 'no details'}`;
            } else {
              msg = `Search error for task ${task.id} (album ${a.ymId}), reason=${reason}`;
            }

            try {
              await prisma.yandexAlbum.update({
                where: { id: a.id },
                data: { torrentState: AlbumTorrentState.none },
              });
            } catch (e: any) {
              lg.warn(
                'failed to reset album torrentState (search error)',
                'pipeline.run.album.torrentState.search.error',
                {
                  albumId: a.id,
                  ymAlbumId: a.ymId,
                  taskId: task.id,
                  error: e?.message || String(e),
                },
              );
            }

            if (runId) {
              await dblog(runId, 'error', msg);
            }

            lg.warn('search failed for task', 'pipeline.run.search.error', {
              taskId: task.id,
              ymAlbumId: a.ymId,
              reason,
              perIndexer: per,
            });

            tasks.push(task);

            if (reason === 'no-indexers' || reason === 'indexer-error') {
              throw new JackettFatalError(msg);
            }

            return;
          }

          if (searchRes.count <= 0) {
            stats.searchesEmpty += 1;

            try {
              await prisma.yandexAlbum.update({
                where: { id: a.id },
                data: { torrentState: AlbumTorrentState.none },
              });
            } catch (e: any) {
              lg.warn(
                'failed to reset album torrentState (empty search)',
                'pipeline.run.album.torrentState.empty',
                {
                  albumId: a.id,
                  ymAlbumId: a.ymId,
                  taskId: task.id,
                  error: e?.message || String(e),
                },
              );
            }

            if (runId) {
              await dblog(
                runId,
                'info',
                `No releases found for ${task.artistName} - ${task.albumTitle}`,
              );
            }

            lg.info(`No releases found for ${task.artistName} - ${task.albumTitle}`, 'pipeline.run.search.empty', {
              taskId: task.id,
              ymAlbumId: a.ymId,
            });

            tasks.push(task);
            return;
          }

          stats.searchesOk += 1;

          const { chosen, reason } = await pickBestRelease(task.id, {
            commit: true,
          } as any);

          if (!chosen) {
            if (runId) {
              await dblog(
                runId,
                'info',
                `No suitable release chosen for task ${task.id} (reason=${reason ?? 'n/a'})`,
              );
            }

            lg.info('no suitable release chosen', 'pipeline.run.pick.none', {
              taskId: task.id,
              reason,
            });
            tasks.push(task);
            return;
          }

          if (runId) {
            await dblog(
              runId,
              'info',
              `Release ${chosen.id} chosen for task ${task.id}: ${chosen.title}`,
            );
          }

          lg.info('release chosen for task', 'pipeline.run.pick.ok', {
            taskId: task.id,
            releaseId: chosen.id,
            title: chosen.title,
          });

          const addRes = await addTaskToQbt(task.id, {
            releaseId: chosen.id,
            autoStart,
          });

          const updatedTask = addRes.task ?? task;

          try {
            await prisma.yandexAlbum.update({
              where: { id: a.id },
              data: {
                torrentState: mapTaskStatusToAlbumTorrentState(
                  updatedTask.status as TorrentStatus,
                ),
              },
            });
          } catch (e: any) {
            lg.warn(
              'failed to update album torrentState after qbt add',
              'pipeline.run.album.torrentState.afterQbt',
              {
                albumId: a.id,
                ymAlbumId: a.ymId,
                taskId: updatedTask.id,
                status: updatedTask.status,
                error: e?.message || String(e),
              },
            );
          }

          if (addRes.ok) {
            stats.addedToQbt += 1;

            if (runId) {
              await dblog(
                runId,
                'info',
                `Task ${task.id} added to qBittorrent (hash=${addRes.qbitHash ?? 'n/a'})`,
              );
            }

            lg.info('task added to qbt', 'pipeline.run.qbt.add.ok', {
              taskId: task.id,
              qbitHash: addRes.qbitHash ?? null,
            });
          } else {
            const reasonMsg =
              (updatedTask as any).lastError ||
              'qBittorrent: add returned not ok (no hash / duplicate?)';

            if (runId) {
              await dblog(
                runId,
                'error',
                `Failed to add task ${task.id} to qBittorrent: ${reasonMsg}`,
              );
            }

            lg.warn('task add to qbt failed', 'pipeline.run.qbt.add.fail', {
              taskId: task.id,
              error: reasonMsg,
              qbitHash: addRes.qbitHash ?? null,
            });
          }

          tasks.push(updatedTask);
        } catch (err: any) {
          if (err instanceof JackettUnavailableError || err instanceof JackettFatalError) {
            throw err;
          }

          stats.errors += 1;
          const msg = err?.message || String(err);

          if (runId) {
            await dblog(runId, 'error', `Album error: ${msg}`);
          }

          lg.error('pipeline per-album failed', 'pipeline.run.album.error', {
            err: msg,
            ymAlbumId: a.ymId,
          });
        }
      })(),
    );

    await Promise.all(promises);
    stats.t_done += promises.length;

    if (runId) {
      await patchRunStats(runId, {
        phase: 'processing',
        t_done: stats.t_done,
      });
    }
  }

  if (runId) {
    await dblog(
      runId,
      'info',
      `Run-unmatched complete (created=${stats.tasksCreated}, qbt=${stats.addedToQbt})`,
    );
  }

  lg.info('run-unmatched finished', 'pipeline.run.done', stats);

  return {
    ok: true as const,
    stats,
    tasks,
  };
}
