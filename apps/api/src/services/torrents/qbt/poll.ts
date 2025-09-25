// apps/api/src/services/torrents/qbt/poll.ts
import { prisma } from '../../../prisma';
import { AlbumTorrentState, TorrentStatus } from '@prisma/client';
import { QbtClient } from '../../qbittorrent';
import { detectTorrentLayout } from '../layout/detectLayout';
import { TorrentLayout } from '../types';
import { log, refreshActiveTasks, setReleaseStatus } from '../index';

export async function autoPollQbt(opts?: { batchSize?: number; staleSec?: number }) {
  const batchSize = opts?.batchSize ?? 20;
  const staleSec = opts?.staleSec ?? 60;

  // 1) Обычное обновление "живых" задач (downloading/queued/...)
  const { total, changed } = await refreshActiveTasks({ batchSize, staleSec });

  // 2) Классификация задач в статусе added
  const addedTasks = await prisma.torrentTask.findMany({
    where: {
      status: TorrentStatus.added,
      qbitHash: { not: null },
      OR: [
        { layout: null },
        { layout: 'unknown' },
      ],
    },
    take: batchSize,
    orderBy: [{ updatedAt: 'asc' }],
  });

  if (!addedTasks.length) {
    return {
      ok: true as const,
      batchSize,
      staleSec,
      total,
      changed,
      classified: 0,
      invalid: 0,
      started: 0,
    };
  }

  const { client, deleteFiles } = await QbtClient.fromDb();

  let classified = 0;
  let invalid = 0;
  let started = 0;

  for (const t of addedTasks) {
    try {
      if (!t.qbitHash) continue;

      const info = await client.infoByHash(t.qbitHash);
      if (!info) {
        // qBittorrent уже не знает про этот торрент — считаем ошибкой
        await prisma.torrentTask.update({
          where: { id: t.id },
          data: {
            status: TorrentStatus.failed,
            lastError: 'Torrent not found in qBittorrent (added)',
            updatedAt: new Date(),
          },
        });
        continue;
      }

      const files = await client.filesByHash(t.qbitHash);
      const layout = detectTorrentLayout(files);

      if (layout === TorrentLayout.invalid) {
        // 2.1. Раздача нам не подходит — удаляем торрент + файлы, помечаем задачу invalid и релиз rejected
        await client.deleteTorrents(t.qbitHash, deleteFiles);

        await prisma.torrentTask.update({
          where: { id: t.id },
          data: {
            status: TorrentStatus.invalid,
            layout,
            lastError: 'Unsupported torrent layout',
            updatedAt: new Date(),
          },
        });

        // Сбросим torrentState у альбома, если есть привязка к Yandex
        if ((t as any).ymAlbumId) {
          await prisma.yandexAlbum.updateMany({
            where: { ymId: (t as any).ymAlbumId },
            data: { torrentState: AlbumTorrentState.none },
          });
        }

        // Помечаем активный релиз как rejected
        const rel = await prisma.torrentRelease.findFirst({
          where: {
            taskId: t.id,
            status: { in: ['new', 'queued', 'downloading'] },
          },
          orderBy: { id: 'desc' },
        });
        if (rel) {
          await setReleaseStatus(rel.id, 'rejected');
        }

        invalid++;
        classified++;
        continue;
      }

      // 2.2. Раздача валидна — сохраняем layout, переводим задачу в downloading и снимаем паузу в qBittorrent
      await prisma.torrentTask.update({
        where: { id: t.id },
        data: {
          status: TorrentStatus.downloading,
          layout,
          updatedAt: new Date(),
        },
      });

      const rel = await prisma.torrentRelease.findFirst({
        where: {
          taskId: t.id,
          status: { in: ['new', 'queued'] },
        },
        orderBy: { id: 'desc' },
      });
      if (rel) {
        await setReleaseStatus(rel.id, 'downloading');
      }

      await client.resumeTorrents(t.qbitHash);

      started++;
      classified++;
    } catch (e: any) {
      // Логируем, но не падаем целиком
      log.warn('autoPollQbt classification error', 'torrents.qbt.autopoll.classify.error', {
        taskId: t.id,
        error: e?.message || String(e),
      });

      await prisma.torrentTask.update({
        where: { id: t.id },
        data: {
          lastError: e?.message || String(e),
          updatedAt: new Date(),
        },
      });
    }
  }

  return {
    ok: true as const,
    batchSize,
    staleSec,
    total,
    changed,
    classified,
    invalid,
    started,
  };
}
