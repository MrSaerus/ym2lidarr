// apps/api/src/routes/stats.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { computeProgress } from '../utils/progress';
const r = Router();
const log = createLogger({ scope: 'route.stats' });

function parseStats(stats?: string | null) {
    if (!stats) return null;
    try { return JSON.parse(stats); } catch { return null; }
}

type RunDTO = {
    id: number;
    kind: string;
    status: string;
    message: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    durationSec: number | null;
    stats: any;
    progress: { total: number; done: number; pct: number } | null;
} | null;

async function getRuns(kinds: string[]): Promise<{ active: RunDTO; last: RunDTO }> {
    const active = await prisma.syncRun.findFirst({
        where: { kind: { in: kinds }, status: 'running' },
        orderBy: { startedAt: 'desc' },
    });
    const last = await prisma.syncRun.findFirst({
        where: { kind: { in: kinds }, status: { in: ['ok', 'error'] } },
        orderBy: { startedAt: 'desc' },
    });
    const toDto = (x?: any): RunDTO =>
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
          progress: (() => {
            const st = parseStats(x.stats);
            return st ? computeProgress(st) : null;
          })(),
      };
    return { active: toDto(active), last: toDto(last) };
}

async function getBaseUrls() {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const lidarrBase = (s?.lidarrUrl || '').replace(/\/+$/, '');
    return { lidarrBase };
}

/** GET /api/stats — сводка для Overview */
r.get('/', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    lg.info('overview stats requested', 'stats.overview.start');

    try {
        const { lidarrBase } = await getBaseUrls();

        // --- Yandex counters (present=true) ---
        const [yArtistsTotal, yArtistsMatched, yAlbumsTotal, yAlbumsMatched] = await Promise.all([
            prisma.yandexArtist.count({ where: { present: true } }),
            prisma.yandexArtist.count({ where: { present: true, mbid: { not: null } } }),
            prisma.yandexAlbum.count({ where: { present: true } }),
            prisma.yandexAlbum.count({ where: { present: true, rgMbid: { not: null } } }),
        ]);
        lg.debug('yandex counters computed', 'stats.overview.yandex.counters', {
            yArtistsTotal, yArtistsMatched, yAlbumsTotal, yAlbumsMatched
        });

        // Топ-5 «последних» альбомов из Yandex (по ymId убыв.)
        const latestYandexRaw = await prisma.yandexAlbum.findMany({
            where: { present: true },
            orderBy: [{ id: 'desc' }],
            take: 5,
            select: { id: true, ymId: true,title: true, artist: true, rgMbid: true, year: true },
        });

        const latestYandex = latestYandexRaw.map((x) => ({
            id: Number(x.ymId) || 0,
            title: x.title || '',
            artistName: x.artist || '',
            year: x.year ?? null,
            yandexUrl: `https://music.yandex.ru/album/${Number(x.ymId) || 0}`,
            mbUrl: x.rgMbid ? `https://musicbrainz.org/release-group/${x.rgMbid}` : undefined,
        }));

        // Топ-5 «последних» артистов из Yandex (по ymId убыв.)
        const latestYandexArtistsRaw = await prisma.yandexArtist.findMany({
            where: { present: true },
            orderBy: [{ id: 'desc' }],
            take: 5,
            select: { id: true, ymId: true,name: true, mbid: true },
        });
        const latestYandexArtists = latestYandexArtistsRaw.map((x) => {
            const id = Number(x.ymId) || 0;
            return {
                id,
                name: x.name || '',
                yandexUrl: `https://music.yandex.ru/artist/${id}`,
                mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
            };
        });
        lg.debug('yandex latest prepared', 'stats.overview.yandex.latest', {
            albums: latestYandex.length, artists: latestYandexArtists.length
        });

        // --- Lidarr counters (removed=false) ---
        const [lArtistsTotal, lArtistsMatched, lAlbumsTotal, lAlbumsMatched] = await Promise.all([
            prisma.lidarrArtist.count({ where: { removed: false } }),
            prisma.lidarrArtist.count({ where: { removed: false, mbid: { not: null } } }),
            prisma.lidarrAlbum.count({ where: { removed: false } }),
            prisma.lidarrAlbum.count({ where: { removed: false, mbid: { not: null } } }),
        ]);

        // Топ-5 последних альбомов и артистов из Lidarr
        const [latestLidarrRaw, latestLidarrArtistsRaw] = await Promise.all([
            prisma.lidarrAlbum.findMany({
                where: { removed: false },
                orderBy: [{ added: 'desc' }, { id: 'desc' }],
                take: 5,
                select: { id: true, title: true, artistName: true, added: true, mbid: true },
            }),
            prisma.lidarrArtist.findMany({
                where: { removed: false },
                orderBy: [{ added: 'desc' }, { id: 'desc' }],
                take: 5,
                select: { id: true, name: true, added: true, mbid: true },
            }),
        ]);

        const latestLidarr = latestLidarrRaw.map((x) => ({
            id: x.id,
            title: x.title || '',
            artistName: x.artistName || '',
            added: x.added ? x.added.toISOString() : null,
            lidarrUrl: lidarrBase ? `${lidarrBase}/album/${x.mbid}` : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/release-group/${x.mbid}` : undefined,
        }));
        const latestLidarrArtists = latestLidarrArtistsRaw.map((x) => ({
            id: x.id,
            name: x.name || '',
            added: x.added ? x.added.toISOString() : null,
            lidarrUrl: lidarrBase ? `${lidarrBase}/artist/${x.mbid}` : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
        }));
        lg.debug('lidarr counters/latest prepared', 'stats.overview.lidarr', {
            lArtistsTotal, lArtistsMatched, lAlbumsTotal, lAlbumsMatched,
            latestAlbums: latestLidarr.length, latestArtists: latestLidarrArtists.length
        });

        // --- Custom (artists only) ---
        const [cArtistsTotal, cArtistsMatched, latestCustomArtistsRaw, lArtistsDownloaded, lAlbumsDownloaded] = await Promise.all([
            prisma.customArtist.count(),
            prisma.customArtist.count({ where: { mbid: { not: null } } }),
            prisma.customArtist.findMany({
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 5,
                select: { id: true, name: true, mbid: true, createdAt: true },
            }),
            prisma.lidarrArtist.count({
                where: {
                    removed: false,
                    OR: [{ sizeOnDisk: { gt: 0 } }, { tracks: { gt: 0 } }],
                },
            }),
            prisma.lidarrAlbum.count({
                where: {
                    removed: false,
                    OR: [{ sizeOnDisk: { gt: 0 } }, { tracks: { gt: 0 } }],
                },
            }),
        ]);

        const latestCustomArtists = latestCustomArtistsRaw.map((x) => ({
            id: x.id,
            name: x.name || '',
            createdAt: x.createdAt ? x.createdAt.toISOString() : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
        }));
        const cArtistsUnmatched = Math.max(0, cArtistsTotal - cArtistsMatched);

        const lArtistsWithoutDownloads = Math.max(0, lArtistsTotal - lArtistsDownloaded);
        const lArtistsDownloadedPct = lArtistsTotal ? lArtistsDownloaded / lArtistsTotal : 0;
        const lAlbumsWithoutDownloads = Math.max(0, lAlbumsTotal - lAlbumsDownloaded);
        const lAlbumsDownloadedPct = lAlbumsTotal ? lAlbumsDownloaded / lAlbumsTotal : 0;
        // учитываем оба вида kind для совместимости
        const [yandex, lidarr, match] = await Promise.all([
            getRuns(['yandex', 'yandex-pull']),
            getRuns(['lidarr', 'lidarr-pull']),
            getRuns(['match']),
        ]);
        const [ymLikedWithRgMbids, lidarrDownloadedMbids] = await Promise.all([
            prisma.yandexAlbum.findMany({
                where: { present: true, rgMbid: { not: null } },
                // берем только RG MBID
                select: { rgMbid: true },
            }),
            prisma.lidarrAlbum.findMany({
                where: {
                    removed: false,
                    mbid: { not: null },
                    OR: [{ sizeOnDisk: { gt: 0 } }, { tracks: { gt: 0 } }],
                },
                // distinct по mbid, чтобы не считать дубликаты релизов в Lidarr
                select: { mbid: true },
                distinct: ['mbid'],
            }),
        ]);

        const ymRgSet = new Set<string>(ymLikedWithRgMbids.map(x => x.rgMbid as string));
        let ymAlbumsDownloaded = 0;
        for (const r of lidarrDownloadedMbids) {
            if (r.mbid && ymRgSet.has(r.mbid)) ymAlbumsDownloaded++;
        }
        log.debug('yandex downloaded intersect computed', 'stats.overview.yandex.downloaded', {
            ymLikedTotal: yAlbumsTotal,
            ymLikedWithRg: ymRgSet.size,
            lidarrDownloadedDistinct: lidarrDownloadedMbids.length,
            ymAlbumsDownloaded,
        });
        lg.info('overview stats computed', 'stats.overview.done', {
            yArtistsTotal, yAlbumsTotal, lArtistsTotal, lAlbumsTotal,
            customArtists: cArtistsTotal
        });

        res.json({
            // (legacy) суммарные блоки как "yandex"
            artists: {
                total: yArtistsTotal,
                found: yArtistsMatched,
                unmatched: Math.max(0, yArtistsTotal - yArtistsMatched),
            },
            albums: {
                total: yAlbumsTotal,
                found: yAlbumsMatched,
                unmatched: Math.max(0, yAlbumsTotal - yAlbumsMatched),
            },

            // новая структурированная модель
            yandex: {
                artists: {
                    total: yArtistsTotal,
                    matched: yArtistsMatched,
                    unmatched: Math.max(0, yArtistsTotal - yArtistsMatched),
                },
                albums: {
                    total: yAlbumsTotal,
                    matched: yAlbumsMatched,
                    unmatched: Math.max(0, yAlbumsTotal - yAlbumsMatched),
                },
                latestAlbums: latestYandex,
                latestArtists: latestYandexArtists,
                albumsDownloaded: ymAlbumsDownloaded,
            },

            lidarr: {
                artists: {
                    total: lArtistsTotal,
                    matched: lArtistsMatched,
                    unmatched: Math.max(0, lArtistsTotal - lArtistsMatched),
                    downloaded: lArtistsDownloaded,
                    noDownloads: lArtistsWithoutDownloads,
                    downloadedPct: lArtistsDownloadedPct,
                },
                albums: {
                    total: lAlbumsTotal,
                    matched: lAlbumsMatched,
                    unmatched: Math.max(0, lAlbumsTotal - lAlbumsMatched),
                    downloaded: lAlbumsDownloaded,
                    noDownloads: lAlbumsWithoutDownloads,
                    downloadedPct: lAlbumsDownloadedPct,
                },
                latestAlbums: latestLidarr,
                latestArtists: latestLidarrArtists,
            },

            // ⬇️ кастом
            custom: {
                artists: {
                    total: cArtistsTotal,
                    matched: cArtistsMatched,
                    unmatched: cArtistsUnmatched,
                },
                latestArtists: latestCustomArtists,
            },

            runs: { yandex, lidarr, match },
        });
    } catch (e: any) {
        log.error('overview stats failed', 'stats.overview.fail', { err: e?.message });
        res.status(500).json({ message: e?.message || String(e) });
    }
});

export default r;
