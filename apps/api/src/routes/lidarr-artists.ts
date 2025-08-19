import { Router } from 'express';
import { prisma } from '../prisma';
import { getLidarrCreds } from '../utils/lidarr-creds';
import { syncLidarrArtists } from '../services/lidarr-cache';

const r = Router();

// GET /api/lidarr/artists?q=&monitored=all|true|false&sortBy=&sortDir=&page=&pageSize=
r.get('/artists', async (req, res) => {
    try {
        const page = Math.max(parseInt(String(req.query.page || '1'), 10), 1);
        const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10), 1), 200);
        const q = String(req.query.q || '').trim();
        const monitoredFilter = String(req.query.monitored || 'all');
        type SortField = 'name'|'monitored'|'albums'|'tracks'|'size'|'path'|'added';
        const sortBy = (String(req.query.sortBy || 'name') as SortField);
        const sortDir = (String(req.query.sortDir || 'asc') === 'desc') ? 'desc' : 'asc';

        // WHERE
        const where: any = { removed: false };
        if (monitoredFilter === 'true') where.monitored = true;
        if (monitoredFilter === 'false') where.monitored = false;
        if (q) {
            // поиск по имени и mbid (ILIKE)
            where.OR = [
                { name: { contains: q, mode: 'insensitive' } },
                { mbid: { contains: q, mode: 'insensitive' } },
            ];
        }

        // ORDER BY (mapping)
        const orderBy: any[] = [];
        const add = (o: any) => orderBy.push(o);
        switch (sortBy) {
            case 'name':      add({ name: sortDir }); add({ mbid: 'asc' }); break;
            case 'monitored': add({ monitored: sortDir }); add({ name: 'asc' }); break;
            case 'albums':    add({ albums: sortDir }); break;
            case 'tracks':    add({ tracks: sortDir }); break;
            case 'size':      add({ sizeOnDisk: sortDir }); break;
            case 'path':      add({ path: sortDir }); break;
            case 'added':     add({ added: sortDir }); break;
            default:          add({ name: 'asc' }); break;
        }

        const total = await prisma.lidarrArtist.count({ where });
        const itemsRaw = await prisma.lidarrArtist.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        // собрать lidarrUrl (по MBID), чтобы фронт не знал базу
        const { lidarrUrl } = await getLidarrCreds();
        const items = itemsRaw.map(a => ({
            id: a.id,
            name: a.name,
            mbid: a.mbid,
            monitored: a.monitored,
            path: a.path,
            added: a.added ? a.added.toISOString() : null,
            albums: a.albums,
            tracks: a.tracks,
            sizeOnDisk: a.sizeOnDisk != null ? Number(a.sizeOnDisk) : null,
            lidarrUrl: `${lidarrUrl}/artist/${a.mbid || a.id}`,
        }));

        res.json({ page, pageSize, total, items, sortBy, sortDir });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Internal error' });
    }
});

// POST /api/lidarr/resync  — принудительно подтянуть в кэш
r.post('/resync', async (_req, res) => {
    try {
        const r = await syncLidarrArtists();
        res.json({ ok: true, ...r });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Internal error' });
    }
});

// Оставляем как было: триггер refresh артиста в самом Lidarr
r.post('/artist/:id/refresh', async (req, res) => {
    try {
        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

        const resp = await fetch(`${lidarrUrl}/api/v1/command?apikey=${encodeURIComponent(lidarrApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ name: 'RefreshArtist', artistId: id })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return res.status(resp.status).json({ error: 'Lidarr error', detail: data });

        // маленький апдейт кэша по факту refresh (best-effort)
        await prisma.lidarrArtist.updateMany({
            where: { id },
            data: { lastSyncAt: new Date() },
        });

        res.json({ ok: true, command: data });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Internal error' });
    }
});

export default r;
