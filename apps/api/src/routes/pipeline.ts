// apps/api/src/routes/pipeline.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { runUnmatchedInternal } from '../services/torrentsPipeline';

const r = Router();
const log = createLogger({ scope: 'route.pipeline' });

/**
 * POST /api/pipeline/plan-unmatched
 */
r.post('/plan-unmatched', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  try {
    const limit = Number.isFinite(+req.body?.limit) ? Math.max(1, Math.min(500, +req.body.limit)) : 100;

    const yAlbums = await prisma.yandexAlbum.findMany({
      where: { present: true, rgMbid: null },
      select: { ymId: true, title: true, artist: true, year: true },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    const yArtists = await prisma.yandexArtist.findMany({
      where: {
        present: true,
        OR: [
          { mbid: null },
          { mbAlbumsCount: 0 },
        ],
      },
      select: { ymId: true, name: true },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    const plan = {
      albums: yAlbums.map(a => ({
        kind: 'album' as const,
        ymAlbumId: a.ymId,
        albumTitle: a.title,
        artistName: a.artist ?? null,
        year: a.year ?? null,
      })),
      artists: yArtists.map(a => ({
        kind: 'artist' as const,
        ymArtistId: a.ymId,
        artistName: a.name,
      })),
    };

    lg.info('plan-unmatched built', 'pipeline.plan.ok', {
      albums: plan.albums.length, artists: plan.artists.length
    });

    res.json({ ok: true, plan });
  } catch (e: any) {
    lg.error('plan-unmatched failed', 'pipeline.plan.error', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POST /api/pipeline/run-unmatched
 * {
 *   limit?: number,           // сколько кандидатов взять (по умолчанию 50)
 *   minSeeders?: number,      // минимальное число сидов (по умолчанию 1)
 *   limitPerIndexer?: number, // сколько релизов брать с каждого индексера (по умолчанию 20)
 *   dryRun?: boolean,         // если true — только план, без создания задач и поиска
 *   autoStart?: boolean       // автозапуск в qBittorrent (по умолчанию true)
 * }
 */
r.post('/run-unmatched', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });

  try {
    const body = req.body || {};

    const limit = Number.isFinite(+body.limit)
      ? Math.max(1, Math.min(500, +body.limit))
      : 50;

    const minSeeders = Number.isFinite(+body.minSeeders)
      ? Math.max(0, +body.minSeeders)
      : 1;

    const limitPerIndexer = Number.isFinite(+body.limitPerIndexer)
      ? Math.max(1, Math.min(200, +body.limitPerIndexer))
      : 20;

    const dryRun = body.dryRun === true || body.dryRun === 'true';
    const autoStart = body.autoStart !== false && body.autoStart !== 'false';

    const parallelSearches = Number.isFinite(+body.parallelSearches)
      ? Math.max(1, Math.min(50, +body.parallelSearches))
      : 10;

    lg.info('run-unmatched requested', 'pipeline.run-unmatched.start', {
      limit,
      minSeeders,
      limitPerIndexer,
      dryRun,
      autoStart,
      parallelSearches,
    });

    const result = await runUnmatchedInternal(
      {
        limit,
        minSeeders,
        limitPerIndexer,
        dryRun,
        autoStart,
        parallelSearches,
      },
      undefined,
    );

    lg.info('run-unmatched finished', 'pipeline.run-unmatched.done', {
      stats: result?.stats,
    });

    res.json(result);
  } catch (e: any) {
    lg.error('run-unmatched failed', 'pipeline.run-unmatched.error', {
      err: e?.message || String(e),
    });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});
export default r;
