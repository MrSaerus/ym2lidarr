// apps/api/src/routes/lidarr-albums.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { request } from 'undici';
import { getLidarrCreds } from '../utils/lidarr-creds';

const r = Router();

type SortField = 'title' | 'artistName' | 'tracks' | 'size' | 'path' | 'added' | 'monitored';

function i(v: any, d: number) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : d;
}
function iU(v: any) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : undefined;
}
function parseBytes(v: any) {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).trim().toLowerCase();
    const m = s.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb|pb)?$/i);
    if (!m) return undefined;
    const num = parseFloat(m[1]);
    const mult: Record<string, number> = { b:1, kb:1024, mb:1024**2, gb:1024**3, tb:1024**4, pb:1024**5 };
    const unit = (m[2] || 'b').toLowerCase();
    return Math.round(num * (mult[unit] ?? 1));
}

async function getLidarrBase(): Promise<string> {
    const s = await prisma.setting.findFirst({ where: { id: 1 }, select: { lidarrUrl: true } });
    return String(s?.lidarrUrl || '').replace(/\/+$/, '');
}
function cleanMbid(v?: string | null) {
    return v ? v.replace(/^mbid:/i, '') : '';
}

/** ===== list albums from DB with filters/sort/paging ===== */
r.get('/albums', async (req, res) => {
    try {
        const page = Math.max(1, i(req.query.page, 1));
        const pageSize = Math.max(1, i(req.query.pageSize, 50));
        const q = String(req.query.q ?? '').trim();

        const monitored = String(req.query.monitored ?? 'all'); // 'all'|'true'|'false'
        const sortBy = (String(req.query.sortBy ?? 'title') as SortField);
        const sortDir = String(req.query.sortDir ?? 'asc') === 'desc' ? 'desc' : 'asc';

        // доп. фильтры (оставляем совместимость — фронт может их не присылать)
        const minTracks = iU(req.query.minTracks);
        const maxTracks = iU(req.query.maxTracks);
        const minSize = parseBytes(req.query.minSize);
        const maxSize = parseBytes(req.query.maxSize);
        const hasPath = String(req.query.hasPath ?? 'all'); // 'all'|'with'|'without'

        const where: any = { removed: false };

        if (q) {
            where.OR = [
                { title: { contains: q, mode: 'insensitive' } },
                { artistName: { contains: q, mode: 'insensitive' } },
                { mbid: { contains: q } },
            ];
        }
        if (monitored === 'true') where.monitored = true;
        if (monitored === 'false') where.monitored = false;

        // tracks: только если поле добавлено в схему; иначе фильтр проигнорируется
        if (minTracks !== undefined || maxTracks !== undefined) {
            where.tracks = {};
            if (minTracks !== undefined) where.tracks.gte = minTracks;
            if (maxTracks !== undefined) where.tracks.lte = maxTracks;
        }

        if (minSize !== undefined || maxSize !== undefined) {
            where.sizeOnDisk = {};
            if (minSize !== undefined) where.sizeOnDisk.gte = minSize;
            if (maxSize !== undefined) where.sizeOnDisk.lte = maxSize;
        }
        if (hasPath === 'with') where.path = { not: null };
        if (hasPath === 'without') where.path = null;

        const orderBy: any = (() => {
            switch (sortBy) {
                case 'artistName': return { artistName: sortDir };
                case 'tracks':     return { tracks: sortDir };      // при наличии поля в схеме
                case 'size':       return { sizeOnDisk: sortDir };
                case 'path':       return { path: sortDir };
                case 'added':      return { added: sortDir };
                case 'monitored':  return { monitored: sortDir };
                case 'title':
                default:           return { title: sortDir };
            }
        })();

        const [total, rows, base] = await Promise.all([
            prisma.lidarrAlbum.count({ where }),
            prisma.lidarrAlbum.findMany({
                where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            getLidarrBase(),
        ]);

        const items = rows.map((x) => ({
            id: x.id,
            title: x.title,
            artistName: x.artistName || '',
            mbid: x.mbid || null,            // RG MBID
            monitored: x.monitored,
            path: x.path || null,
            added: x.added ? x.added.toISOString() : null,
            sizeOnDisk: x.sizeOnDisk ?? null,
            tracks: (x as any).tracks ?? null, // если поля нет — будет null
            // корректная ссылка только при наличии RG MBID и base
            lidarrUrl: base && x.mbid ? `${base}/album/${cleanMbid(x.mbid)}` : null,
        }));

        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

/** ===== refresh одного альбома в кэше БД ===== */
r.post('/album/:id/refresh', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id)) return res.status(400).json({ message: 'Bad album id' });

        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const base = String(lidarrUrl || '').replace(/\/+$/, '');
        const url = `${base}/api/v1/album/${id}?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

        const resp = await request(url, { method: 'GET' });
        const text = await resp.body.text();
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            return res.status(502).json({ message: `Lidarr error ${resp.statusCode}: ${text?.slice(0, 500)}` });
        }

        let a: any = null;
        try { a = JSON.parse(text); } catch {}
        if (!a || typeof a !== 'object') return res.status(404).json({ message: 'Album not found in Lidarr' });

        await prisma.lidarrAlbum.upsert({
            where: { id },
            create: {
                id,
                mbid: a.foreignAlbumId || null,
                title: a.title || '',
                artistName: a.artist?.artistName || null,
                path: a.path || null,
                monitored: !!a.monitored,
                added: a.added ? new Date(a.added) : null,
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                // tracks: a.statistics?.trackCount ?? null,
                removed: false,
                lastSyncAt: new Date(),
            },
            update: {
                mbid: a.foreignAlbumId || null,
                title: a.title || '',
                artistName: a.artist?.artistName || null,
                path: a.path || null,
                monitored: !!a.monitored,
                added: a.added ? new Date(a.added) : null,
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                // tracks: a.statistics?.trackCount ?? null,
                removed: false,
                lastSyncAt: new Date(),
            },
        });

        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ message: e?.message || String(e) });
    }
});

export default r;
