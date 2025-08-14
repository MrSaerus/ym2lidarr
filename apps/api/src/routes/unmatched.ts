import { Router } from 'express';

import { prisma } from '../prisma';

const r = Router();

function pager(req: any) {
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query?.limit ?? '200'), 10)));
  const offset = Math.max(0, parseInt(String(req.query?.offset ?? '0'), 10));
  return { limit, offset };
}

/**
 * GET /api/unmatched?type=artists|albums&limit=200&offset=0
 * Возвращает не сматченные элементы + кандидатов (до 5 шт).
 */
r.get('/', async (req, res) => {
  const type =
    String(req.query?.type || 'artists').toLowerCase() === 'albums' ? 'albums' : 'artists';
  const { limit, offset } = pager(req);

  if (type === 'artists') {
    const where = { mbid: null as any };
    const total = await prisma.artist.count({ where });
    const rows = await prisma.artist.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        candidates: {
          orderBy: [{ highlight: 'desc' }, { score: 'desc' }],
          take: 5,
        },
      },
      skip: offset,
      take: limit,
    });
    return res.json({
      type,
      total,
      items: rows.map((a: any) => ({
        id: a.id,
        name: a.name,
        candidates:
          a.candidates?.map((c: any) => ({
            id: c.mbid,
            name: c.name,
            score: c.score,
            type: c.type,
            country: c.country,
            url: c.url,
            highlight: c.highlight,
          })) || [],
      })),
    });
  }

  // albums
  const where = { rgMbid: null as any };
  const total = await prisma.album.count({ where });
  const rows = await prisma.album.findMany({
    where,
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    include: {
      candidates: {
        orderBy: [{ highlight: 'desc' }, { score: 'desc' }],
        take: 5,
      },
    },
    skip: offset,
    take: limit,
  });
  return res.json({
    type,
    total,
    items: rows.map((al: any) => ({
      id: al.id,
      artist: al.artist,
      title: al.title,
      year: al.year,
      candidates:
        al.candidates?.map((c: any) => ({
          id: c.rgMbid,
          title: c.title,
          primaryType: c.primaryType,
          firstReleaseDate: c.firstReleaseDate,
          primaryArtist: c.primaryArtist,
          score: c.score,
          url: c.url,
          highlight: c.highlight,
        })) || [],
    })),
  });
});

export default r;
