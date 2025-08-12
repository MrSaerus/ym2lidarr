import { Router } from 'express';

import { prisma } from '../prisma';

const r = Router();

function parseStats(stats?: string | null) {
  if (!stats) return null;
  try {
    return JSON.parse(stats);
  } catch {
    return null;
  }
}

async function getRuns(kind: 'yandex' | 'lidarr') {
  const active = await prisma.syncRun.findFirst({
    where: { kind, status: 'running' },
    orderBy: { startedAt: 'desc' },
  });
  const last = await prisma.syncRun.findFirst({
    where: { kind, status: { in: ['ok', 'error'] } },
    orderBy: { startedAt: 'desc' },
  });

  const toDto = (x?: any) =>
    x && {
      id: x.id,
      kind: x.kind,
      status: x.status,
      message: x.message ?? null,
      startedAt: x.startedAt,
      finishedAt: x.finishedAt ?? null,
      durationSec: x.finishedAt
        ? Math.max(0, Math.round((+new Date(x.finishedAt) - +new Date(x.startedAt)) / 1000))
        : null,
      stats: parseStats(x.stats),
    };

  return { active: toDto(active), last: toDto(last) };
}

/** GET /api/stats — сводка для Overview (alias к /api/overview) */
r.get('/', async (_req, res) => {
  const artistsTotal = await prisma.artist.count();
  const artistsFound = await prisma.artist.count({ where: { mbid: { not: null as any } } });
  const albumsTotal = await prisma.album.count();
  const albumsFound = await prisma.album.count({ where: { rgMbid: { not: null as any } } });

  const yandex = await getRuns('yandex');
  const lidarr = await getRuns('lidarr');

  res.json({
    artists: { total: artistsTotal, found: artistsFound, unmatched: artistsTotal - artistsFound },
    albums: { total: albumsTotal, found: albumsFound, unmatched: albumsTotal - albumsFound },
    runs: { yandex, lidarr },
  });
});

export default r;
