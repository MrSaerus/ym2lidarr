// apps/api/src/services/torrents/qbt/status.ts
import { TorrentStatus } from '@prisma/client';
import { prisma } from '../../../prisma';
import { QbtClient } from '../../qbittorrent';

export function mapQbtToTaskStatus(info: { state?: string; progress?: number }): TorrentStatus {
  const st = String(info.state || '').toLowerCase();
  const prog = info.progress ?? 0;

  if (prog >= 1) return TorrentStatus.downloaded;
  if (st.includes('error') || st.includes('missing')) return TorrentStatus.failed;

  if (st.includes('paused')) {
    return prog > 0 ? TorrentStatus.downloading : TorrentStatus.added;
  }

  if (st.includes('downloading') || st.includes('stalled') || st.includes('meta') || st.includes('allocating')) {
    return TorrentStatus.downloading;
  }
  if (st.includes('queued')) return TorrentStatus.queued;
  if (st.includes('upload') || st.includes('seed')) return TorrentStatus.downloaded;

  return TorrentStatus.downloading;
}
export async function refreshTaskQbtStatus(taskId: number) {
  const task = await prisma.torrentTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');
  if (!task.qbitHash) throw new Error('Task has no qbitHash yet');

  const { client } = await QbtClient.fromDb();
  const info = await client.infoByHash(task.qbitHash);
  if (!info) {
    const t = await prisma.torrentTask.update({
      where: { id: taskId },
      data: {
        status: TorrentStatus.failed,
        lastError: 'Torrent not found in qBittorrent',
        updatedAt: new Date(),
      },
    });
    return { ok: false, task: t, reason: 'not-found' as const };
  }

  const nextStatus = mapQbtToTaskStatus(info);

  const t = await prisma.torrentTask.update({
    where: { id: taskId },
    data: { status: nextStatus, updatedAt: new Date() },
  });

  return { ok: true, task: t, qbt: info };
}
export async function refreshActiveTasks(opts?: { batchSize?: number; staleSec?: number }) {
  const batchSize = opts?.batchSize ?? 20;
  const staleSec = opts?.staleSec ?? 60;

  const activeStatuses: TorrentStatus[] = [
    TorrentStatus.downloading,
    TorrentStatus.queued,
    TorrentStatus.searching,
    TorrentStatus.found,
  ];
  const since = new Date(Date.now() - staleSec * 1000);

  const tasks = await prisma.torrentTask.findMany({
    where: {
      qbitHash: { not: null },
      status: { in: activeStatuses },
      updatedAt: { lt: since },
    },
    take: batchSize,
    orderBy: [{ updatedAt: 'asc' }],
  });

  if (!tasks.length) return { ok: true as const, total: 0, changed: 0 };

  const { client } = await QbtClient.fromDb();
  let changed = 0;

  for (const t of tasks) {
    try {
      const info = await client.infoByHash(t.qbitHash!);
      if (!info) {
        await prisma.torrentTask.update({
          where: { id: t.id },
          data: { status: TorrentStatus.failed, lastError: 'Torrent not found in qBittorrent', updatedAt: new Date() },
        });
        changed++;
        continue;
      }
      const next = mapQbtToTaskStatus(info);
      if (next !== t.status) {
        await prisma.torrentTask.update({
          where: { id: t.id },
          data: { status: next, updatedAt: new Date() },
        });
        changed++;
      } else {
        await prisma.torrentTask.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
      }
    } catch (e: any) {
      await prisma.torrentTask.update({
        where: { id: t.id },
        data: { lastError: e?.message || String(e), updatedAt: new Date() },
      });
    }
  }

  return { ok: true as const, total: tasks.length, changed };
}
