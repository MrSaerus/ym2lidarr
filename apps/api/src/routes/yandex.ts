import { Router } from 'express';
import { prisma } from '../prisma';

// ——— утилиты ———
function num(val: any, def: number) {
    const n = parseInt(String(val ?? ''), 10);
    return Number.isFinite(n) ? n : def;
}
function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

// ——— типы DTO для ответа ———
type ApiResp<T> = { page: number; pageSize: number; total: number; items: T[] };

type YArtistDto = {
    id: number;                // internal CacheEntry id
    name: string;
    yandexArtistId: number;
    yandexUrl: string;
    mbid?: string | null;
    mbUrl?: string | null;
};

type YAlbumDto = {
    id: number;                // internal CacheEntry id
    title: string;
    artistName: string;
    yandexAlbumId: number;
    yandexUrl: string;
    rgMbid?: string | null;
    rgUrl?: string | null;
    year?: number | null;
};

const router = Router();

/**
 * GET /api/yandex/artists
 * q, page, pageSize, sortBy=name|id, sortDir=asc|desc
 */
router.get('/artists', async (req, res) => {
    try {
        const q = (req.query.q as string || '').trim().toLowerCase();
        const page = clamp(num(req.query.page, 1), 1, 1_000_000);
        const pageSize = clamp(num(req.query.pageSize, 50), 1, 500);
        const sortBy = (req.query.sortBy as string) === 'id' ? 'id' : 'name';
        const sortDir = (req.query.sortDir as string) === 'desc' ? 'desc' : 'asc';

        const rows = await prisma.cacheEntry.findMany({
            where: { key: { startsWith: 'ya:artist:' } },
            select: { id: true, payload: true },
        });

        let items: YArtistDto[] = [];
        for (const r of rows) {
            try {
                const p = JSON.parse(r.payload);
                if (p?.source && p.source !== 'yandex') continue;
                const name = String(p?.name || '');
                const yid = Number(p?.yandexArtistId);
                if (!yid || !name) continue;
                const mbid = p?.mbid || null;
                items.push({
                    id: r.id,
                    name,
                    yandexArtistId: yid,
                    yandexUrl: `https://music.yandex.ru/artist/${yid}`,
                    mbid,
                    mbUrl: mbid ? `https://musicbrainz.org/artist/${mbid}` : null,
                });
            } catch { /* skip invalid payload */ }
        }

        if (q) items = items.filter(i => i.name.toLowerCase().includes(q));

        items.sort((a, b) => {
            const dir = sortDir === 'desc' ? -1 : 1;
            if (sortBy === 'id') return (a.id - b.id) * dir;
            return a.name.localeCompare(b.name, ['ru', 'en'], { sensitivity: 'base', numeric: true }) * dir;
        });

        const total = items.length;
        const start = (page - 1) * pageSize;
        const sliced = items.slice(start, start + pageSize);

        const resp: ApiResp<YArtistDto> = { page, pageSize, total, items: sliced };
        res.json(resp);
    } catch (e) {
        console.error('GET /api/yandex/artists failed', e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

/**
 * GET /api/yandex/albums
 * q, page, pageSize, sortBy=title|artist|id, sortDir=asc|desc
 */
router.get('/albums', async (req, res) => {
    try {
        const q = (req.query.q as string || '').trim().toLowerCase();
        const page = clamp(num(req.query.page, 1), 1, 1_000_000);
        const pageSize = clamp(num(req.query.pageSize, 50), 1, 500);
        const sortByRaw = (req.query.sortBy as string) || 'title';
        const sortBy = ['title', 'artist', 'id'].includes(sortByRaw) ? sortByRaw : 'title';
        const sortDir = (req.query.sortDir as string) === 'desc' ? 'desc' : 'asc';

        const rows = await prisma.cacheEntry.findMany({
            where: { key: { startsWith: 'ya:album:' } },
            select: { id: true, payload: true },
        });

        let items: YAlbumDto[] = [];
        for (const r of rows) {
            try {
                const p = JSON.parse(r.payload);
                if (p?.source && p.source !== 'yandex') continue;
                const title = String(p?.title || '');
                const artistName = String(p?.artistName || '');
                const yid = Number(p?.yandexAlbumId);
                if (!yid || !title) continue;
                const rg = p?.rgMbid || null;
                items.push({
                    id: r.id,
                    title,
                    artistName,
                    yandexAlbumId: yid,
                    yandexUrl: `https://music.yandex.ru/album/${yid}`,
                    rgMbid: rg,
                    rgUrl: rg ? `https://musicbrainz.org/release-group/${rg}` : null,
                    year: p?.year ?? null,
                });
            } catch { /* skip invalid payload */ }
        }

        if (q) {
            items = items.filter(i =>
                i.title.toLowerCase().includes(q) ||
                i.artistName.toLowerCase().includes(q)
            );
        }

        items.sort((a, b) => {
            const dir = sortDir === 'desc' ? -1 : 1;
            if (sortBy === 'id') return (a.id - b.id) * dir;
            if (sortBy === 'artist') {
                const cmp = a.artistName.localeCompare(b.artistName, ['ru', 'en'], { sensitivity: 'base', numeric: true });
                if (cmp) return cmp * dir;
                return a.title.localeCompare(b.title, ['ru', 'en'], { sensitivity: 'base', numeric: true }) * dir;
            }
            // title
            const cmp = a.title.localeCompare(b.title, ['ru', 'en'], { sensitivity: 'base', numeric: true });
            if (cmp) return cmp * dir;
            return a.artistName.localeCompare(b.artistName, ['ru', 'en'], { sensitivity: 'base', numeric: true }) * dir;
        });

        const total = items.length;
        const start = (page - 1) * pageSize;
        const sliced = items.slice(start, start + pageSize);

        const resp: ApiResp<YAlbumDto> = { page, pageSize, total, items: sliced };
        res.json(resp);
    } catch (e) {
        console.error('GET /api/yandex/albums failed', e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

export default router;
