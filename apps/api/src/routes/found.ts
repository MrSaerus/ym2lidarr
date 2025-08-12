import { Router } from 'express';

import { prisma } from '../prisma';

const r = Router();

function pager(req: any) {
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit ?? '200'), 10)));
  const offset = Math.max(0, parseInt(String(req.query?.offset ?? '0'), 10));
  return { limit, offset };
}

/**
 * GET /api/found?type=artists|albums&limit=200&offset=0
 * Возвращает уже сматченные объекты (не по флагу, а по наличию MBID).
 */
r.get('/', async (req, res) => {
  const type =
    String(req.query?.type || 'artists').toLowerCase() === 'albums' ? 'albums' : 'artists';
  const { limit, offset } = pager(req);

  if (type === 'artists') {
    const where = { mbid: { not: null as any } };
    const total = await prisma.artist.count({ where });
    const rows = await prisma.artist.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: offset,
      take: limit,
    });
    return res.json({
      type,
      total,
      items: rows.map((a) => ({ id: a.id, name: a.name, mbid: a.mbid })),
    });
  }

  // albums
  const where = { rgMbid: { not: null as any } };
  const total = await prisma.album.count({ where });
  const rows = await prisma.album.findMany({
    where,
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    skip: offset,
    take: limit,
  });
  return res.json({
    type,
    total,
    items: rows.map((al) => ({
      id: al.id,
      artist: al.artist,
      title: al.title,
      year: al.year,
      rgMbid: al.rgMbid,
    })),
  });
});

export default r;
