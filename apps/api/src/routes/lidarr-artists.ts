// apps/api/src/routes/lidarr-artists.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { request } from 'undici';
import { getLidarrCreds } from '../utils/lidarr-creds';
import { syncLidarrArtists, syncLidarrAlbums } from '../services/lidarr-cache';
import { runLidarrSearchArtists } from '../workers';
import { startRun } from '../log';

// NEW: взаимная блокировка с кроном/другими ручными раннами
import { ensureNotBusyOrThrow } from '../scheduler';

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
            lidarrUrl: base && x.mbid ? `${base}/artist/${cleanMbid(x.mbid)}` : null,
        }));

        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

/** ===== refresh одного артиста в кэше БД =====
 * Блокируем, если идёт любой lidarr.pull.* (крон/ручной)
 */
r.post('/artist/:id/refresh', async (req, res) => {
    try {
        await ensureNotBusyOrThrow(['lidarr.pull.'], ['lidarrPull'] as any);

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
        if (e?.status === 409) return res.status(409).json({ message: e?.message || 'Busy' });
        res.status(500).json({ message: e?.message || String(e) });
    }
});

/** ===== unified resync: artists + albums =====
 * Блокируем, если идёт любой lidarr.pull.* (крон/ручной)
 */
r.post('/resync', async (req, res) => {
    try {
        await ensureNotBusyOrThrow(['lidarr.pull.'], ['lidarrPull'] as any);

        const artists = await syncLidarrArtists();
        const albums  = await syncLidarrAlbums();
        res.json({ ok: true, artists, albums });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

r.get('/stats/downloads', async (_req, res) => {
    try {
        const [total, withDownloads] = await Promise.all([
            prisma.lidarrArtist.count({ where: { removed: false } }),
            prisma.lidarrArtist.count({
                where: {
                    removed: false,
                    OR: [
                        { sizeOnDisk: { gt: 0 } },
                        { tracks: { gt: 0 } },
                    ],
                },
            }),
        ]);
        const withoutDownloads = Math.max(0, total - withDownloads);
        const ratio = total ? withDownloads / total : 0;
        res.json({ total, withDownloads, withoutDownloads, ratio });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

r.post('/search-artists', async (req, res) => {
    try {
        // при желании можно добавить взаимную блокировку с другими lidarr.* задачами
        // await ensureNotBusyOrThrow(['lidarr.'], ['lidarrPull'] as any);

        const delayMs = Number(req.body?.delayMs);
        const run = await startRun('lidarr.search.artists', { phase: 'search', total: 0, done: 0, ok: 0, failed: 0 });
        runLidarrSearchArtists(run.id, { delayMs: Number.isFinite(delayMs) ? delayMs : 150 }).catch(() => {});
        res.json({ started: true, runId: run.id });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});
export default r;
