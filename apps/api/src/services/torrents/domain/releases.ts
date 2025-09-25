// apps/api/src/services/torrents/domain/releases.ts
import { prisma } from '../../../prisma';
import type { TorrentReleaseStatus } from '../../../types/torrents';
import { TorrentRelease } from '@prisma/client';

function computeReleaseScore(r: { seeders: number | null; score: number | null | undefined; magnet: string | null; pubDate: Date | null }): number {
  const baseSeeders = Math.max(0, r.seeders ?? 0);
  const magnetBonus = r.magnet ? 50 : 0;
  let freshness = 0;
  if (r.pubDate) {
    const days = (Date.now() - r.pubDate.getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 7) freshness = Math.max(0, 20 - Math.floor(days * (20 / 7)));
  }
  const externalScore = Number.isFinite(r.score as any) ? (r.score as number) : 0;
  return baseSeeders + magnetBonus + freshness + externalScore;
}
export async function setReleaseStatus(
  id: number,
  status: TorrentReleaseStatus | 'rejected',
) {
  const st: TorrentReleaseStatus = status === 'rejected' ? 'rejected' : status;
  return prisma.torrentRelease.update({
    where: { id },
    data: { status: st },
  });
}
export async function listReleases(taskId: number) {
  return prisma.torrentRelease.findMany({
    where: { taskId },
    orderBy: [{ createdAt: 'desc' }],
  });
}
export async function upsertRelease(
  taskId: number,
  rel: {
    indexerId?: number | null;
    title: string;
    magnetUri?: string | null;
    link?: string | null;
    sizeBytes?: bigint | number | null;
    seeders?: number | null;
    leechers?: number | null;
    publishDate?: Date | null;
    quality?: string | null;
    score?: number | null;
  }
) {
  let existing: any = null;

  if (!existing && rel.magnetUri) {
    existing = await prisma.torrentRelease.findFirst({ where: { taskId, magnet: rel.magnetUri } });
  }
  if (!existing && rel.link) {
    existing = await prisma.torrentRelease.findFirst({ where: { taskId, link: rel.link } });
  }
  if (!existing) {
    existing = await prisma.torrentRelease.findFirst({ where: { taskId, title: rel.title } });
  }

  const base: any = {
    taskId,
    indexerId: rel.indexerId ?? null,
    title: rel.title,
    magnet: rel.magnetUri ?? null,
    link: rel.link ?? null,
    size: rel.sizeBytes != null ? BigInt(rel.sizeBytes as any) : null,
    seeders: rel.seeders ?? null,
    leechers: rel.leechers ?? null,
    pubDate: rel.publishDate ?? null,
    quality: rel.quality ?? null,
  };
  if (typeof rel.score === 'number' && Number.isFinite(rel.score)) base.score = rel.score;

  if (existing) {
    return prisma.torrentRelease.update({ where: { id: existing.id }, data: base });
  } else {
    return prisma.torrentRelease.create({ data: base });
  }
}
export async function pickBestRelease(
  taskId: number,
  opts?: { commit?: boolean },
): Promise<{ chosen: TorrentRelease | null; reason: 'ok' | 'no-candidates' }> {
  const task = await prisma.torrentTask.findUnique({
    where: { id: taskId },
    include: { releases: true },
  });
  if (!task) throw new Error('Task not found');

  // Игнорируем уже отклонённые релизы
  const candidates = task.releases.filter(
    (r: any) => r.status !== 'rejected',
  );

  if (!candidates.length) {
    return { chosen: null, reason: 'no-candidates' };
  }

  const scored = candidates
    .map((r) => ({
      r,
      score: computeReleaseScore({
        seeders: r.seeders,
        score: r.score,
        magnet: r.magnet,
        pubDate: r.pubDate,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.r || null;
  if (!best) return { chosen: null, reason: 'no-candidates' };

  if (opts?.commit) {
    await setReleaseStatus(best.id, 'queued');
  }

  return { chosen: best, reason: 'ok' };
}
