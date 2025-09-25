// apps/api/src/services/torrents/qbt/addTaskToQbt.ts
import { prisma } from '../../../prisma';
import { TorrentRelease, TorrentStatus } from '@prisma/client';
import { QbtClient } from '../../qbittorrent';
import { rewriteJackettUrlForQbt } from './jackettRewrite';
import { precomputeReleaseHash } from './hash';
import { pickBestRelease } from '../domain/releases';
import { getPathConfig } from '../copy/copyDownloadedTask';
import { calcNextErrorScheduledAt } from '../domain/taskCrud';
import { log } from '../index';
import { normalizeTitleTokens } from '../layout/multiAlbumPick';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function scoreTorrentCandidate(
  t: any,
  params: {
    releaseTitle?: string | null;
    task?: { artistName?: string | null; albumTitle?: string | null; year?: number | null };
  }
): number {
  const name = String(t.name ?? '');
  const contentPath = String(t.content_path ?? '');
  const candidates: string[] = [name];

  if (contentPath) {
    const base = contentPath
      .split(/[\\/]/g)
      .filter(Boolean)
      .pop();
    if (base) candidates.push(base);
  }

  let best = 0;

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (params.releaseTitle) {
      best = Math.max(best, tokensSimilarity(params.releaseTitle, candidate));
    }
    if (params.task?.albumTitle) {
      best = Math.max(best, tokensSimilarity(params.task.albumTitle, candidate));
    }
    if (params.task?.artistName) {
      best = Math.max(best, tokensSimilarity(params.task.artistName, candidate));
    }
    // year можно тоже подмешать, но обычно токенов и так хватает
  }

  return best;
}

function tokensSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitleTokens(a));
  const tb = new Set(normalizeTitleTokens(b));
  if (!ta.size || !tb.size) return 0;

  let common = 0;
  for (const t of ta) {
    if (tb.has(t)) common += 1;
  }
  // доля пересечения по меньшему множесту
  return common / Math.min(ta.size, tb.size);
}
export async function addTaskToQbt(
  taskId: number,
  opts?: { releaseId?: number; savePath?: string | null; autoStart?: boolean; tags?: string | null }
) {
  const task = await prisma.torrentTask.findUnique({
    where: { id: taskId },
    include: { releases: true },
  });
  if (!task) throw new Error('Task not found');

  // выбрать релиз
  let release: TorrentRelease | null = null;
  if (opts?.releaseId) {
    release = task.releases.find((r) => r.id === opts.releaseId) || null;
    if (!release) throw new Error('Release not found for task');
  } else {
    const { chosen } = await pickBestRelease(taskId, { commit: true });
    if (!chosen) throw new Error('No suitable release');
    release = chosen;
  }

  const rawUrl = release.magnet || release.link;
  if (!rawUrl) {
    throw new Error('Release has neither magnet nor link');
  }

  // либо магнет как есть, либо переписанный HTTP-URL Jackett
  const magnetOrUrl = release.magnet
    ? release.magnet
    : await rewriteJackettUrlForQbt(rawUrl);

  const precomputedHash = await precomputeReleaseHash(release);
  const { client } = await QbtClient.fromDb();
  const { downloadsDir } = await getPathConfig(); // наш downloadsDir из настроек

  // категория для qBittorrent (может быть null)
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const category = setting?.torrentQbtCategory?.trim() || null;

  const prevScheduledAt = task.scheduledAt ?? null;
  const prevLastTriedAt = task.lastTriedAt ?? null;
  const now = new Date();

  // отметим момент до добавления — пригодится для фильтрации по added_on
  const startedAtMs = Date.now();
  const startedAtSec = Math.floor(startedAtMs / 1000);

  // ВАЖНО: если autoStart === true, то НЕ стопаем.
  // Во всех остальных случаях добавляем в остановленном состоянии.
  const paused = opts?.autoStart === true ? false : true;

  // === Добавление в qBittorrent с бэкоффом по ошибке ===
  try {
    await client.addByMagnetOrUrl({
      magnetOrUrl,
      savePath: opts?.savePath ?? downloadsDir ?? task.finalPath ?? undefined,
      paused,
      ...(category ? { category } : {}),
      ...(opts?.tags ? { tags: opts.tags } : {}),
    });
  } catch (e: any) {
    // пытаемся вытащить максимум информации из ошибки HTTP-клиента
    const rawError =
      (e && (e.response?.data || e.response?.statusText)) ||
      e?.message ||
      (typeof e === 'string' ? e : JSON.stringify(e));

    const msg = `qBittorrent add failed: ${rawError}`;
    const nextAt = calcNextErrorScheduledAt(
      { scheduledAt: prevScheduledAt, lastTriedAt: prevLastTriedAt },
      now,
    );

    // логируем в сервисный лог
    log.error('qbt addByMagnetOrUrl failed', 'torrents.qbt.add.error', {
      taskId,
      releaseId: release.id,
      error: rawError,
      magnetOrUrlPreview: magnetOrUrl.slice(0, 200),
      savePath: opts?.savePath ?? downloadsDir ?? task.finalPath ?? undefined,
      category: category ?? null,
      stack: e?.stack ? String(e.stack).slice(0, 500) : null,
    });

    await prisma.torrentTask.update({
      where: { id: taskId },
      data: {
        status: TorrentStatus.failed,
        lastError: msg,
        scheduledAt: nextAt,
        lastTriedAt: now,
      },
    });

    // пробрасываем, чтобы пайплайн тоже знал, что всё плохо
    throw e;
  }

  // 1) пробуем вытащить хеш из магнита, если он есть
  let qbitHash = precomputedHash;

  // 2) если добавляли по .torrent (magnet нет) — пытаемся найти торрент в qBittorrent,
  //    используя:
  //    - окно по времени added_on
  //    - fuzzy по имени торрента / content_path
  //    - artist/album из задачи
  if (!qbitHash) {
    const maxAttempts = 15;
    const delayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let list: any;
      try {
        list = await client.infoList({
          filter: 'all',
          ...(category ? { category } : {}),
        });
      } catch (err: any) {
        log.warn('qbt infoList failed', 'torrents.qbt.info.error', {
          taskId,
          attempt,
          error: err?.message || String(err),
        });
        if (attempt < maxAttempts) {
          await sleep(delayMs);
          continue;
        }
        break;
      }

      const torrents = Array.isArray(list) ? list : [];

      // ограничиваемся по времени (2 минуты до момента добавления)
      const minAdded = startedAtSec - 120;

      const candidates = torrents.filter((t: any) => {
        if (typeof t.added_on === 'number' && t.added_on < minAdded) return false;
        return true;
      });

      let best: any = null;
      let bestScore = 0;

      for (const t of candidates) {
        const score = scoreTorrentCandidate(t, {
          releaseTitle: release!.title,
          task: {
            artistName: task.artistName,
            albumTitle: task.albumTitle,
            year: task.albumYear,
          },
        });

        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }

      // порог уверенности — чуть ниже, чем было, т.к. матчинг богаче
      const SIM_THRESHOLD = 0.45;

      if (best && best.hash && bestScore >= SIM_THRESHOLD) {
        qbitHash = String(best.hash).toUpperCase();

        log.info(
          'resolved qbit hash by fuzzy title',
          'torrents.qbt.hash.byTitle',
          {
            taskId,
            releaseId: release.id,
            hash: qbitHash,
            attempt,
            score: bestScore,
            torrentName: best.name,
            content_path: best.content_path ?? null,
            added_on: best.added_on,
            category: category ?? null,
          },
        );
        break;
      }

      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }

    // если после всех попыток хеш не найден, считаем это фейлом
    if (!qbitHash) {
      const failNow = new Date();
      const nextAt = calcNextErrorScheduledAt(
        { scheduledAt: task.scheduledAt ?? null, lastTriedAt: task.lastTriedAt ?? null },
        failNow,
      );

      const failedTask = await prisma.torrentTask.update({
        where: { id: task.id },
        data: {
          status: TorrentStatus.failed,
          lastError: 'qBittorrent: torrent not found after add (no hash)',
          scheduledAt: nextAt,
          lastTriedAt: failNow,
        },
      });

      log.warn(
        'qbt torrent add has no hash, treating as failure (no confident match)',
        'torrents.qbt.add.nohash',
        {
          taskId: task.id,
          releaseId: release.id,
          magnetOrUrlPreview: magnetOrUrl.slice(0, 160),
          category: category ?? null,
        },
      );

      return {
        ok: false as const,
        qbitHash: null as string | null,
        task: failedTask,
      };
    }
  }

  // сюда попадаем либо с хешем из магнита, либо с найденным по уверенной схожести
  const patch: any = {
    status: TorrentStatus.added,
    lastTriedAt: new Date(),
    lastError: null,
    scheduledAt: null,
  };
  if (qbitHash) patch.qbitHash = qbitHash;
  if (!task.startedAt) patch.startedAt = new Date();

  try {
    const updated = await prisma.torrentTask.update({
      where: { id: taskId },
      data: patch,
    });

    log.info('qbt torrent added with hash', 'torrents.qbt.add.ok', {
      taskId: task.id,
      releaseId: release.id,
      hash: qbitHash,
      category: category ?? null,
    });

    return {
      ok: true as const,
      task: updated,
      releaseId: release.id,
      qbitHash: updated.qbitHash || null,
    };
  } catch (e: any) {
    const code = String(e?.code || e?.meta?.code || '').toUpperCase();

    if (code === 'P2002' && qbitHash) {
      // нашли задачу, которая уже владеет этим qbitHash
      const existing = await prisma.torrentTask.findFirst({
        where: { qbitHash },
      });

      const msg = existing
        ? `Duplicate torrent hash with task ${existing.id}`
        : 'Duplicate torrent hash';

      const failed = await prisma.torrentTask.update({
        where: { id: task.id },
        data: {
          status: TorrentStatus.failed,
          lastError: msg,
          lastTriedAt: new Date(),
          // бэкофф здесь, скорее всего, не нужен — это логическая коллизия
          scheduledAt: null,
        },
      });

      log.warn(
        'duplicate qbitHash, marking task as failed',
        'torrents.qbt.add.duplicateHash',
        {
          taskId: task.id,
          existingTaskId: existing?.id ?? null,
          hash: qbitHash,
        },
      );

      return {
        ok: false as const,
        task: failed,
        releaseId: release.id,
        qbitHash: null as string | null,
      };
    }

    // если ошибка не про дубль hash — пробрасываем дальше
    throw e;
  }
}
