// apps/api/src/routes/lidarr-artists.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

async function getLidarrCreds() {
    // 1) пробуем из БД настроек
    const s = await prisma.setting.findFirst();
    const lidarrUrl = s?.lidarrUrl || process.env.LIDARR_URL;
    const lidarrApiKey = s?.lidarrApiKey || process.env.LIDARR_API_KEY;
    if (!lidarrUrl || !lidarrApiKey) {
        throw new Error('Lidarr URL or API key is not configured');
    }
    return { lidarrUrl: lidarrUrl.replace(/\/+$/,''),
        lidarrApiKey };
}

// GET /api/lidarr/artists?q=&page=1&pageSize=50&monitored=all|true|false
r.get('/artists', async (req, res) => {
    try {
        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();

        const page = Math.max(parseInt(String(req.query.page || '1'), 10), 1);
        const pageSize = Math.min(
            Math.max(parseInt(String(req.query.pageSize || '50'), 10), 1),
            200
        );
        const q = String(req.query.q || '').toLowerCase().trim();
        const monitoredFilter = String(req.query.monitored || 'all'); // all|true|false
        type SortField = 'name'|'monitored'|'albums'|'tracks'|'size'|'path'|'added';
        const sortBy = (String(req.query.sortBy || 'name') as SortField);
        const sortDir = (String(req.query.sortDir || 'asc') === 'desc') ? 'desc' : 'asc';
        const mult = sortDir === 'asc' ? 1 : -1;
        const validFields: SortField[] = ['name','monitored','albums','tracks','size','path','added'];
        const field: SortField = validFields.includes(sortBy) ? sortBy : 'name';
        // Забираем полный список из Lidarr (обычно ~сотни — ок; если тысячи, позже включим кэш)
        const url = `${lidarrUrl}/api/v1/artist?apikey=${encodeURIComponent(lidarrApiKey)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            const text = await resp.text();
            return res.status(resp.status).json({ error: 'Lidarr error', detail: text });
        }
        const all = await resp.json();

        // Нормализация + фильтрация
        type LArtist = {
            id: number;
            artistName: string;
            foreignArtistId?: string; // MBID
            monitored: boolean;
            path?: string;
            added?: string;
            statistics?: {
                albumCount?: number;
                trackCount?: number;
                sizeOnDisk?: number;
            };
        };

        let list = (all as LArtist[]).map(a => ({
            id: a.id,
            name: a.artistName,
            mbid: a.foreignArtistId || null,
            monitored: !!a.monitored,
            path: a.path || null,
            added: a.added || null,
            albums: a.statistics?.albumCount ?? null,
            tracks: a.statistics?.trackCount ?? null,
            sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
            lidarrUrl: `${lidarrUrl}/artist/${a.foreignArtistId || a.id}`
        }));

        if (q) {
            list = list.filter(x =>
                (x.name || '').toLowerCase().includes(q) ||
                (x.mbid || '').toLowerCase().includes(q)
            );
        }
        if (monitoredFilter === 'true') list = list.filter(x => x.monitored);
        if (monitoredFilter === 'false') list = list.filter(x => !x.monitored);

        // Сортируем
        const cmpNullsLast = (a: any, b: any) => {
            const aN = a === null || a === undefined;
            const bN = b === null || b === undefined;
            if (aN && bN) return 0;
            if (aN) return 1;
            if (bN) return -1;
            return 0;
        };
        list.sort((a, b) => {
            let cmp = 0;
            switch (field) {
                case 'name': {
                    const A = a.name || '';
                    const B = b.name || '';
                    cmp = A.localeCompare(B, ['ru','en'], { sensitivity: 'base', numeric: true });
                    if (cmp !== 0) break;
                    cmp = String(a.mbid || '').localeCompare(String(b.mbid || ''));
                    break;
                }
                case 'monitored': {
                    cmp = (a.monitored === b.monitored) ? 0 : (a.monitored ? -1 : 1);
                    // затем по имени для стабильности
                    if (cmp !== 0) break;
                    const A = a.name || ''; const B = b.name || '';
                    cmp = A.localeCompare(B, ['ru','en'], { sensitivity: 'base', numeric: true });
                    break;
                }
                case 'albums': {
                    cmp = cmpNullsLast(a.albums, b.albums);
                    if (cmp === 0) cmp = (a.albums! - b.albums!);
                    break;
                }
                case 'tracks': {
                    cmp = cmpNullsLast(a.tracks, b.tracks);
                    if (cmp === 0) cmp = (a.tracks! - b.tracks!);
                    break;
                }
                case 'size': {
                    cmp = cmpNullsLast(a.sizeOnDisk, b.sizeOnDisk);
                    if (cmp === 0) cmp = (a.sizeOnDisk! - b.sizeOnDisk!);
                    break;
                }
                case 'path': {
                    cmp = cmpNullsLast(a.path, b.path);
                    if (cmp === 0) {
                        const A = a.path || ''; const B = b.path || '';
                        cmp = A.localeCompare(B, ['ru','en'], { sensitivity: 'base', numeric: true });
                    }
                    break;
                }
                case 'added': {
                    const aT = a.added ? Date.parse(a.added) : null;
                    const bT = b.added ? Date.parse(b.added) : null;
                    cmp = cmpNullsLast(aT, bT);
                    if (cmp === 0) cmp = (aT! - bT!);
                    break;
                }
            }
            return cmp * mult;
        });

        const total = list.length;
        const start = (page - 1) * pageSize;
        const pageItems = list.slice(start, start + pageSize);

        res.json({
            page,
            pageSize,
            total,
            sortBy: field,
            sortDir,
            items: pageItems
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Internal error' });
    }
});

// POST /api/lidarr/artist/:id/refresh
r.post('/artist/:id/refresh', async (req, res) => {
    try {
        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

        // Lidarr: POST /api/v1/command { name: "RefreshArtist", artistId: <id> }
        const resp = await fetch(`${lidarrUrl}/api/v1/command?apikey=${encodeURIComponent(lidarrApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ name: 'RefreshArtist', artistId: id })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return res.status(resp.status).json({ error: 'Lidarr error', detail: data });
        res.json({ ok: true, command: data });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Internal error' });
    }
});

export default r;
