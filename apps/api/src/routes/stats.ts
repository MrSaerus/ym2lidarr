// apps/api/src/routes/stats.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

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
        };
    return { active: toDto(active), last: toDto(last) };
}

async function getBaseUrls() {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const lidarrBase = (s?.lidarrUrl || '').replace(/\/+$/, '');
    return { lidarrBase };
}

/** GET /api/stats — сводка для Overview */
r.get('/', async (_req, res) => {
    try {
        const { lidarrBase } = await getBaseUrls();

        // --- Yandex counters (present=true) ---
        const [yArtistsTotal, yArtistsMatched, yAlbumsTotal, yAlbumsMatched] = await Promise.all([
            prisma.yandexArtist.count({ where: { present: true } }),
            prisma.yandexArtist.count({ where: { present: true, mbid: { not: null } } }),
            prisma.yandexAlbum.count({ where: { present: true } }),
            prisma.yandexAlbum.count({ where: { present: true, rgMbid: { not: null } } }),
        ]);

        // Топ-5 «последних» альбомов из Yandex (эвристика: по ymId убыв.)
        const latestYandexRaw = await prisma.yandexAlbum.findMany({
            where: { present: true },
            orderBy: [{ ymId: 'desc' }],
            take: 5,
            select: { ymId: true, title: true, artist: true, rgMbid: true, year: true },
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
            orderBy: [{ ymId: 'desc' }],
            take: 5,
            select: { ymId: true, name: true, mbid: true },
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

        // --- Lidarr counters (removed=false) ---
        const [lArtistsTotal, lArtistsMatched, lAlbumsTotal, lAlbumsMatched] = await Promise.all([
            prisma.lidarrArtist.count({ where: { removed: false } }),
            prisma.lidarrArtist.count({ where: { removed: false, mbid: { not: null } } }),
            prisma.lidarrAlbum.count({ where: { removed: false } }),
            prisma.lidarrAlbum.count({ where: { removed: false, mbid: { not: null } } }),
        ]);

        // Топ-5 «последних» альбомов из Lidarr (по added desc; фолбэк — id desc)
        const latestLidarrRaw = await prisma.lidarrAlbum.findMany({
            where: { removed: false },
            orderBy: [{ added: 'desc' }, { id: 'desc' }],
            take: 5,
            select: { id: true, title: true, artistName: true, added: true, mbid: true },
        });
        const latestLidarr = latestLidarrRaw.map((x) => ({
            id: x.id,
            title: x.title || '',
            artistName: x.artistName || '',
            added: x.added ? x.added.toISOString() : null,
            lidarrUrl: lidarrBase ? `${lidarrBase}/album/${x.mbid}` : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/release-group/${x.mbid}` : undefined,
        }));

        // Топ-5 «последних» артистов из Lidarr (по added desc; фолбэк — id desc)
        const latestLidarrArtistsRaw = await prisma.lidarrArtist.findMany({
            where: { removed: false },
            orderBy: [{ added: 'desc' }, { id: 'desc' }],
            take: 5,
            select: { id: true, name: true, added: true, mbid: true },
        });
        const latestLidarrArtists = latestLidarrArtistsRaw.map((x) => ({
            id: x.id,
            name: x.name || '',
            added: x.added ? x.added.toISOString() : null,
            lidarrUrl: lidarrBase ? `${lidarrBase}/artist/${x.mbid}` : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
        }));

        // --- Custom (artists only) ---
        const [cArtistsTotal, cArtistsMatched] = await Promise.all([
            prisma.customArtist.count(),
            prisma.customArtist.count({ where: { mbid: { not: null } } }),
        ]);
        const cArtistsUnmatched = Math.max(0, cArtistsTotal - cArtistsMatched);

        const latestCustomArtistsRaw = await prisma.customArtist.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 5,
            select: { id: true, name: true, mbid: true, createdAt: true },
        });
        const latestCustomArtists = latestCustomArtistsRaw.map((x) => ({
            id: x.id,
            name: x.name || '',
            createdAt: x.createdAt ? x.createdAt.toISOString() : undefined,
            mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
        }));
        const lArtistsDownloaded = await prisma.lidarrArtist.count({
            where: {
                removed: false,
                OR: [
                    { sizeOnDisk: { gt: 0 } },
                    { tracks: { gt: 0 } },
                ],
            },
        });
        const lArtistsWithoutDownloads = Math.max(0, lArtistsTotal - lArtistsDownloaded);
        const lArtistsDownloadedPct = lArtistsTotal ? lArtistsDownloaded / lArtistsTotal : 0;
        // учитываем оба вида kind для совместимости
        const yandex = await getRuns(['yandex', 'yandex-pull']);
        const lidarr = await getRuns(['lidarr', 'lidarr-pull']);
        const match = await getRuns(['match']);

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
                },
                latestAlbums: latestLidarr,
                latestArtists: latestLidarrArtists,
            },

            // ⬇️ добавили кастом
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
        res.status(500).json({ message: e?.message || String(e) });
    }
});

export default r;
