// apps/api/src/services/torrents.ts
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { isTaskKind, isCollisionPolicy, TorrentReleaseStatus, TorrentTaskStatus } from '../types/torrents';

const log = createLogger({ scope: 'service.torrents' });

export async function createTask(input: {
  kind: 'artist'|'album';
  artistName?: string | null;
  albumTitle?: string | null;
  year?: number | null;
  query?: string | null;
  ymArtistId?: string | null;
  ymAlbumId?: string | null;
  source?: 'manual'|'auto'|'yandex';
  collisionPolicy?: 'ask'|'replace'|'skip';
  minSeeders?: number | null;
  limitReleases?: number | null;
  indexerId?: number | null;
  targetPath?: string | null;
  scheduledAt?: Date | null;
}) {
  if (!isTaskKind(input.kind)) throw new Error('Bad kind');

  const data = {
    kind: input.kind,
    status: 'pending' as TorrentTaskStatus,
    source: input.source || 'manual',
    query: input.query || null,
    artistName: input.artistName || null,
    albumTitle: input.albumTitle || null,
    year: input.year ?? null,
    ymArtistId: input.ymArtistId || null,
    ymAlbumId: input.ymAlbumId || null,
    collisionPolicy: isCollisionPolicy(input.collisionPolicy) ? input.collisionPolicy! : 'replace',
    minSeeders: input.minSeeders ?? null,
    limitReleases: input.limitReleases ?? null,
    indexerId: input.indexerId ?? null,
    targetPath: input.targetPath || null,
    scheduledAt: input.scheduledAt ?? null,
  };

  const created = await prisma.torrentTask.create({ data });
  return created;
}

export async function listTasks(opts?: { status?: TorrentTaskStatus | 'any'; limit?: number }) {
  const where = opts?.status && opts.status !== 'any' ? { status: opts.status } : {};
  const rows = await prisma.torrentTask.findMany({
    where: where as any,
    orderBy: [{ createdAt: 'desc' }],
    take: opts?.limit ?? 100,
  });
  return rows;
}

export async function getTask(id: number) {
  return prisma.torrentTask.findUnique({
    where: { id },
    include: { releases: true },
  });
}

export async function updateTaskStatus(id: number, status: TorrentTaskStatus, patch?: Partial<Pick<Parameters<typeof prisma.torrentTask.update>[0]['data'], 'lastError'|'startedAt'|'finishedAt'|'lastTriedAt'>>) {
  const data: any = { status };
  if (patch) Object.assign(data, patch);
  return prisma.torrentTask.update({ where: { id }, data });
}

// upsert релиза по (taskId, guid) или (taskId, infoHash)
export async function upsertRelease(taskId: number, rel: {
  indexerId?: number | null;
  title: string;
  guid?: string | null;
  infoHash?: string | null;
  magnetUri?: string | null;
  link?: string | null;
  sizeBytes?: bigint | number | null;
  seeders?: number | null;
  leechers?: number | null;
  publishDate?: Date | null;
  category?: string | null;
  quality?: string | null;
  score?: number | null;
}) {
  // попытка найти по guid
  let existing = null as any;
  if (rel.guid) {
    existing = await prisma.torrentRelease.findUnique({
      where: { taskId_guid: { taskId, guid: rel.guid } },
    });
  }
  // или по infoHash
  if (!existing && rel.infoHash) {
    existing = await prisma.torrentRelease.findFirst({
      where: { taskId, infoHash: rel.infoHash },
    });
  }

  const data = {
    taskId,
    indexerId: rel.indexerId ?? null,
    title: rel.title,
    guid: rel.guid ?? null,
    infoHash: rel.infoHash ?? null,
    magnetUri: rel.magnetUri ?? null,
    link: rel.link ?? null,
    sizeBytes: rel.sizeBytes != null ? BigInt(rel.sizeBytes as any) : null,
    seeders: rel.seeders ?? null,
    leechers: rel.leechers ?? null,
    publishDate: rel.publishDate ?? null,
    category: rel.category ?? null,
    quality: rel.quality ?? null,
    score: rel.score ?? null,
  };

  if (existing) {
    return prisma.torrentRelease.update({
      where: { id: existing.id },
      data,
    });
  } else {
    return prisma.torrentRelease.create({ data });
  }
}

export async function setReleaseStatus(id: number, status: TorrentReleaseStatus, patch?: Partial<{ qbtTorrentId: string | null; rejectionReason: string | null }>) {
  const data: any = { status };
  if (patch) Object.assign(data, patch);
  return prisma.torrentRelease.update({ where: { id }, data });
}

export async function listReleases(taskId: number) {
  return prisma.torrentRelease.findMany({
    where: { taskId },
    orderBy: [{ addedAt: 'desc' }],
  });
}
