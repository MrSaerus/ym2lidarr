// apps/api/src/services/torrents/copy/autoCopyDownloaded.ts
import { prisma } from '../../../prisma';
import { log as dblog } from '../../../log';
import {copyDownloadedTask} from './copyDownloadedTask'
import { log } from '../index';

export async function autoCopyDownloaded(opts?: { batchSize?: number; runId?: number }) {
  const batchSize = opts?.batchSize ?? 20;
  const runId = opts?.runId;

  const lg = log.child({ ctx: { batchSize, runId } });

  let total = 0;
  let copied = 0;
  let skipped = 0;
  let errorsCount = 0;

  // соберём несколько примеров ошибок для финального summary
  const sampleErrors: Array<{ taskId: number; title: string; error: string }> = [];

  const pushSampleError = (x: { taskId: number; title: string; error: string }) => {
    if (sampleErrors.length < 5) sampleErrors.push(x);
  };

  try {
    lg.info('torrent auto-copy start', 'torrent.copy.start');

    if (runId) {
      await dblog(runId, 'info', 'Torrent auto-copy start', { batchSize });
    }

    const tasks = await prisma.torrentTask.findMany({
      where: { status: 'downloaded' },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
    });

    total = tasks.length;

    if (total === 0) {
      lg.info('no downloaded tasks to process', 'torrent.copy.empty');
      if (runId) {
        await dblog(runId, 'info', 'No downloaded torrent tasks to process', { batchSize });
      }
      return { batchSize, total, copied, skipped, errors: errorsCount };
    }

    for (const t of tasks) {
      const title = `${t.artistName} - ${t.albumTitle}`;

      try {
        lg.debug('copy attempt', 'torrent.copy.try', { taskId: t.id, title });

        const res = await copyDownloadedTask(t.id);

        if (res?.ok) {
          copied++;
          const dest = res.task.finalPath ?? res.dstDir;

          lg.info('copied', 'torrent.copy.ok', { taskId: t.id, dest, title });

          if (runId) {
            await dblog(runId, 'info', `Torrent "${title}" copied successfully`, {
              taskId: t.id,
              dest,
              title,
            });
          }
        } else {
          skipped++;
          const reason = String(res?.error || 'unknown');

          lg.warn('copy skipped', 'torrent.copy.skip', { taskId: t.id, reason, title });

          if (runId) {
            // ключевое: причина в message, не только в data
            await dblog(runId, 'warn', `Torrent "${title}" copy skipped: ${reason}`, {
              taskId: t.id,
              reason,
              title,
            });
          }
        }
      } catch (e: any) {
        errorsCount++;
        const errMsg = String(e?.message || e);

        lg.error('copy error', 'torrent.copy.error', { taskId: t.id, error: errMsg, title });

        pushSampleError({ taskId: t.id, title, error: errMsg });

        if (runId) {
          // ключевое: ошибка в message, чтобы лайв-лог её показал
          await dblog(runId, 'error', `Torrent "${title}" copy error: ${errMsg}`, {
            taskId: t.id,
            error: errMsg,
            title,
          });
        }
      }
    }

    lg.info('torrent auto-copy end', 'torrent.copy.done', { total, copied, skipped, errors: errorsCount });

    if (runId) {
      await dblog(runId, errorsCount > 0 ? 'error' : 'info', 'Torrent auto-copy finished', {
        total,
        copied,
        skipped,
        errors: errorsCount,
        sampleErrors,
      });
    }
  } catch (e: any) {
    errorsCount++;
    const errMsg = String(e?.message || e);

    lg.error('torrent auto-copy fatal', 'torrent.copy.fatal', { error: errMsg });

    if (runId) {
      await dblog(runId, 'error', `Torrent auto-copy fatal error: ${errMsg}`, { error: errMsg });
    }
  }

  return { batchSize, total, copied, skipped, errors: errorsCount };
}
