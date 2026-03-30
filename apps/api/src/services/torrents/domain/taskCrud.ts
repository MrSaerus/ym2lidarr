// apps/api/src/services/torrents/domain/taskCrud.ts
import { isCollisionPolicy, isTaskKind } from '../../../types/torrents';
import { prisma } from '../../../prisma';
import type { TorrentStatus } from '@prisma/client';
import { log } from '../index';

const ERROR_BACKOFF_BASE_MIN = 5;   // первая задержка, можно потом вынести в настройки
const ERROR_BACKOFF_MAX_MIN  = 60;  // максимум 1 час

function norm(s?: string | null) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
export async function createTask(input: { kind: 'artist' | 'album'; artistName?: string | null; albumTitle?: string | null; year?: number | null; query?: string | null; ymArtistId?: string | null; ymAlbumId?: string | null; source?: 'manual' | 'auto' | 'yandex'; collisionPolicy?: 'ask' | 'replace' | 'skip'; minSeeders?: number | null; limitReleases?: number | null; indexerId?: number | null; targetPath?: string | null; scheduledAt?: Date | null; }) {
  if (!isTaskKind(input.kind)) throw new Error('Bad kind');

  const taskKey = makeTaskKey(input);

  // 1) Сначала смотрим любую существующую задачу с этим ключом
  const existingAny = await prisma.torrentTask.findFirst({
    where: { taskKey },
  });

  if (existingAny) {
    log.info(
      'duplicate task prevented (any status)',
      'torrents.task.dedupe.hit',
      { id: existingAny.id, taskKey, status: existingAny.status },
    );
    // Возвращаем как "существующую"
    return Object.assign(existingAny, { _existed: true as const });
  }

  // 2) Готовим данные для новой задачи
  const data = {
    scope: input.kind as any,
    status: 'queued' as TorrentStatus,
    query: input.query || null,
    movePolicy: (isCollisionPolicy(input.collisionPolicy)
      ? input.collisionPolicy
      : 'replace') as any,
    minSeeders: input.minSeeders ?? null,
    limitReleases: input.limitReleases ?? null,
    indexerId: input.indexerId ?? null,
    finalPath: input.targetPath || null,
    scheduledAt: input.scheduledAt ?? null,
    taskKey,
    ymArtistId: input.ymArtistId ?? null,
    ymAlbumId:  input.ymAlbumId  ?? null,
    artistName: input.artistName ?? null,
    albumTitle: input.albumTitle ?? null,
    albumYear:  input.year ?? null,
    // source можно добавить, если колонка есть, но оставляю как было
  } as any;

  // 3) Пытаемся создать. Если гонка — ловим P2002 и вытаскиваем победителя
  try {
    const created = await prisma.torrentTask.create({ data });
    return created;
  } catch (e: any) {
    const code = String(e?.code || e?.meta?.code || '').toUpperCase();
    if (code === 'P2002') {
      const winner = await prisma.torrentTask.findFirst({ where: { taskKey } });
      if (winner) {
        log.warn(
          'duplicate task detected on insert (race)',
          'torrents.task.dedupe.race',
          { id: winner.id, taskKey, status: winner.status },
        );
        return Object.assign(winner, { _existed: true as const });
      }
    }
    throw e;
  }
}
export async function listTasks(opts?: { status?: TorrentStatus | 'any'; page?: number; pageSize?: number; q?: string; sortField?: string; sortDir?: 'asc' | 'desc'; }) {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts?.pageSize ?? 50), 500);

  const where: any = {};

  if (opts?.status && opts.status !== 'any') {
    where.status = opts.status;
  }

  const q = opts?.q?.trim();
  if (q) {
    const or: any[] = [];

    // Если введено число — ищем по id и году альбома
    const asNum = parseInt(q, 10);
    if (Number.isFinite(asNum)) {
      or.push({ id: asNum });
      or.push({ albumYear: asNum });
    }

    // Строковый поиск только по строковым полям (без enum и без source)
    or.push(
      { artistName: { contains: q } },
      { albumTitle: { contains: q } },
      { query: { contains: q } },
      { qbitHash: { contains: q } },
      { ymArtistId: { contains: q } },
      { ymAlbumId: { contains: q } },
      { ymTrackId: { contains: q } },
      { finalPath: { contains: q } },
      { lastError: { contains: q } },
      { taskKey: { contains: q } },
    );

    where.OR = or;
  }

  // Разрешённые поля для сортировки
  const allowedSortFields = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'artistName',
    'albumTitle',
    'albumYear',
    'status',
    'scope',
    'qbitHash',
    'lastError',
  ]);

  let orderBy: any = [{ createdAt: 'desc' }]; // по умолчанию — последние задачи

  if (opts?.sortField && allowedSortFields.has(opts.sortField)) {
    const dir = opts.sortDir === 'asc' ? 'asc' : 'desc';
    orderBy = [{ [opts.sortField]: dir }];
  }

  const [total, items] = await Promise.all([
    prisma.torrentTask.count({ where }),
    prisma.torrentTask.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
  };
}
export async function getTask(id: number) {
  return prisma.torrentTask.findUnique({
    where: { id },
    include: { releases: true },
  });
}
export async function updateTaskStatus(
  id: number,
  status: TorrentStatus,
  patch?: Partial<
    Pick<
      Parameters<typeof prisma.torrentTask.update>[0]['data'],
      | 'lastError'
      | 'startedAt'
      | 'finishedAt'
      | 'lastTriedAt'
      | 'title'
      | 'size'
      | 'seeders'
      | 'quality'
      | 'indexerId'
      | 'qbitHash'
      | 'scheduledAt'
    >
  >
) {
  const data: any = { status };
  if (patch) Object.assign(data, patch);
  return prisma.torrentTask.update({ where: { id }, data });
}
function makeTaskKey(input: { kind: 'artist'|'album'; artistName?: string|null; albumTitle?: string|null; year?: number|null; query?: string|null; ymArtistId?: string|null; ymAlbumId?: string|null; }) {
  const parts: string[] = [input.kind];
  const push = (v?: string|null) => { const x = norm(v); if (x) parts.push(x); };
  push(input.query);
  push(input.artistName);
  push(input.albumTitle);
  if (Number.isFinite(input.year as any)) parts.push(String(input.year));
  push(input.ymArtistId);
  push(input.ymAlbumId);
  return parts.join('|');
}
export function calcNextErrorScheduledAt(task: { scheduledAt: Date | null; lastTriedAt: Date | null }, now = new Date(),) {
  // если до этого не было бэкоффа — стартуем с базовой задержки
  let nextDelayMin = ERROR_BACKOFF_BASE_MIN;

  if (task.scheduledAt && task.lastTriedAt) {
    const prevMs = task.scheduledAt.getTime() - task.lastTriedAt.getTime();
    if (prevMs > 0) {
      const prevMin = prevMs / 60000;
      // удваиваем, пока не упёрлись в максимум
      if (prevMin >= 1) {
        nextDelayMin = Math.min(ERROR_BACKOFF_MAX_MIN, prevMin * 2);
      }
    }
  }

  return new Date(now.getTime() + nextDelayMin * 60_000);
}
