// apps/api/src/routes/lidarr-artists.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { request } from 'undici';
import { getLidarrCreds } from '../utils/lidarr-creds';
import { syncLidarrArtists, syncLidarrAlbums } from '../services/lidarr-cache';

const r = Router();

/** ===== list artists from DB with filters/sort/paging ===== */
type SortField = 'name' | 'monitored' | 'albums' | 'tracks' | 'size' | 'path' | 'added';

function i(v: any, d: number) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : d;
}

async function getLidarrBase(): Promise<string> {
    const s = await prisma.setting.findFirst({ where: { id: 1 }, select: { lidarrUrl: true } });
    return String(s?.lidarrUrl || '').replace(/\/+$/, '');
}
function cleanMbid(v?: string | null) {
    return v ? v.replace(/^mbid:/i, '') : '';
}

r.get('/artists', async (req, res) => {
    try {
        const page = Math.max(1, i(req.query.page, 1));
        const pageSize = Math.max(1, i(req.query.pageSize, 50));
        const q = String(req.query.q ?? '').trim();
        const monitored = String(req.query.monitored ?? 'all'); // 'all'|'true'|'false'
        const sortBy = (String(req.query.sortBy ?? 'name') as SortField);
        const sortDir = String(req.query.sortDir ?? 'asc') === 'desc' ? 'desc' : 'asc';

        const where: any = { removed: false };
        if (q) {
            where.OR = [
                { name: { contains: q, mode: 'insensitive' } },
                { mbid: { contains: q } },
                { path: { contains: q } },
            ];
        }
        if (monitored === 'true') where.monitored = true;
        if (monitored === 'false') where.monitored = false;

        const orderBy: any = (() => {
            switch (sortBy) {
                case 'monitored': return { monitored: sortDir };
                case 'albums':    return { albums: sortDir };
                case 'tracks':    return { tracks: sortDir };
                case 'size':      return { sizeOnDisk: sortDir };
                case 'path':      return { path: sortDir };
                case 'added':     return { added: sortDir };
                case 'name':
                default:          return { name: sortDir };
            }
        })();

        const [total, rows, base] = await Promise.all([
            prisma.lidarrArtist.count({ where }),
            prisma.lidarrArtist.findMany({
                where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            getLidarrBase(),
        ]);

        const items = rows.map((x) => ({
            id: x.id,
            name: x.name,
            mbid: x.mbid || null,
            monitored: x.monitored,
            path: x.path || null,
            added: x.added ? x.added.toISOString() : null,
            albums: x.albums ?? null,
            tracks: x.tracks ?? null,
            sizeOnDisk: x.sizeOnDisk ?? null,
            lidarrUrl: base ? `${base}/artist/${x.id}` : null,
        }));

        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

/** ===== refresh одного артиста в кэше БД ===== */
r.post('/artist/:id/refresh', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id)) return res.status(400).json({ message: 'Bad artist id' });

        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const base = String(lidarrUrl || '').replace(/\/+$/, '');
        const url = `${base}/api/v1/artist/${id}?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

        const resp = await request(url, { method: 'GET' });
        const text = await resp.body.text();
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            return res.status(502).json({ message: `Lidarr error ${resp.statusCode}: ${text?.slice(0, 500)}` });
        }

        let a: any = null;
        try { a = JSON.parse(text); } catch {}
        if (!a || typeof a !== 'object') return res.status(404).json({ message: 'Artist not found in Lidarr' });

        await prisma.lidarrArtist.upsert({
            where: { id },
            create: {
                id,
                name: a.artistName || '',
                mbid: a.foreignArtistId || null,
                monitored: !!a.monitored,
                path: a.path || null,
                added: a.added ? new Date(a.added) : null,
                albums: a.statistics?.albumCount ?? null,
                tracks: a.statistics?.trackCount ?? null,
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                removed: false,
                lastSyncAt: new Date(),
            },
            update: {
                name: a.artistName || '',
                mbid: a.foreignArtistId || null,
                monitored: !!a.monitored,
                path: a.path || null,
                added: a.added ? new Date(a.added) : null,
                albums: a.statistics?.albumCount ?? null,
                tracks: a.statistics?.trackCount ?? null,
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                removed: false,
                lastSyncAt: new Date(),
            },
        });

        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

/** ===== unified resync: artists + albums ===== */
r.post('/resync', async (req, res) => {
    try {
        const artists = await syncLidarrArtists();
        const albums  = await syncLidarrAlbums();
        res.json({ artists, albums });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

export default r;
