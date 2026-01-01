// apps/api/src/services/torrents/index.ts
import { createLogger } from '../../lib/logger';
import chardet from 'chardet';
import { prisma } from '../../prisma';
import { TorrentStatus } from '@prisma/client';
import { QbtClient } from '../qbittorrent';

export  const log = createLogger({ scope: 'service.torrents' });
export * from './types';
export * from './domain/taskCrud';
export * from './domain/releases';
export * from './qbt/addTaskToQbt';
export * from './qbt/status';
export * from './qbt/poll';
export * from './copy/copyDownloadedTask';
export * from './copy/autoCopyDownloaded';

export async function moveTaskToFinalPath(taskId: number) {
  const task = await prisma.torrentTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');
  if (!task.qbitHash) throw new Error('Task has no qbitHash');
  if (!task.finalPath) throw new Error('Task has no finalPath');
  if (!(task.status === TorrentStatus.downloaded || task.status === TorrentStatus.moving)) {
    throw new Error(`Task is not ready to move (status=${task.status})`);
  }

  const { client } = await QbtClient.fromDb();

  if (task.status !== TorrentStatus.moving) {
    await prisma.torrentTask.update({ where: { id: taskId }, data: { status: TorrentStatus.moving, updatedAt: new Date() } });
  }

  await client.setLocation({ hashes: task.qbitHash, location: task.finalPath });

  try {
    const info = await client.infoByHash(task.qbitHash);
    if (info && info.save_path) {
      const same = info.save_path.replace(/\/+$/,'') === task.finalPath.replace(/\/+$/,'');
      if (same) {
        await prisma.torrentTask.update({ where: { id: taskId }, data: { status: TorrentStatus.moved, updatedAt: new Date() } });
        return { ok: true as const, status: 'moved' as const };
      }
    }
  } catch {}

  return { ok: true as const, status: 'moving' as const };
}
export async function autoRelocateDownloaded(opts?: { batchSize?: number; onlyWithFinal?: boolean }) {
  const batchSize = opts?.batchSize ?? 20;

  const rows = await prisma.torrentTask.findMany({
    where: {
      qbitHash: { not: null },
      status: { in: [TorrentStatus.downloaded, TorrentStatus.moving] },
      ...(opts?.onlyWithFinal !== false ? { finalPath: { not: null } } : {}),
    },
    take: batchSize,
    orderBy: [{ updatedAt: 'asc' }],
  });

  if (!rows.length) return { ok: true as const, total: 0, moved: 0, moving: 0 };

  const { client } = await QbtClient.fromDb();
  let moved = 0, moving = 0;

  for (const t of rows) {
    try {
      const info = await client.infoByHash(t.qbitHash!);
      if (!info) {
        await prisma.torrentTask.update({
          where: { id: t.id },
          data: { status: TorrentStatus.failed, lastError: 'Torrent not found in qBittorrent', updatedAt: new Date() },
        });
        continue;
      }

      const want = (t.finalPath || '').replace(/\/+$/,'');
      const cur = String(info.save_path || '').replace(/\/+$/,'');

      if (t.status === TorrentStatus.downloaded) {
        if (!t.finalPath) continue;
        if (cur === want) {
          await prisma.torrentTask.update({ where: { id: t.id }, data: { status: TorrentStatus.moved, updatedAt: new Date() } });
          moved++;
        } else {
          await prisma.torrentTask.update({ where: { id: t.id }, data: { status: TorrentStatus.moving, updatedAt: new Date() } });
          await client.setLocation({ hashes: t.qbitHash!, location: t.finalPath! });
          moving++;
        }
      } else if (t.status === TorrentStatus.moving) {
        if (cur === want) {
          await prisma.torrentTask.update({ where: { id: t.id }, data: { status: TorrentStatus.moved, updatedAt: new Date() } });
          moved++;
        } else {
          moving++;
        }
      }
    } catch (e: any) {
      await prisma.torrentTask.update({
        where: { id: t.id },
        data: { lastError: e?.message || String(e), updatedAt: new Date() },
      });
    }
  }

  return { ok: true as const, total: rows.length, moved, moving };
}
