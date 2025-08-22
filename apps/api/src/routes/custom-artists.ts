import { Router } from 'express';
import { prisma } from '../prisma';
import { startRun } from '../log';
import { runCustomArtistsMatch } from '../workers';
import type { Prisma } from '@prisma/client';

const r = Router();

function nkey(s: string) { return (s || '').trim().toLowerCase(); }

function parsePaging(req: any) {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10) || 50);
    const q = String(req.query.q ?? '').trim();
    const sortBy = String(req.query.sortBy ?? 'name') as 'name' | 'matched' | 'created';
    const sortDirStr = String(req.query.sortDir ?? 'asc') === 'desc' ? 'desc' : 'asc';
    const sortDir: Prisma.SortOrder = sortDirStr;
    return { page, pageSize, q, sortBy, sortDir };
}

// GET /api/custom-artists
r.get('/', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);

    const where: Prisma.CustomArtistWhereInput = q
        ? { OR: [{ nkey: { contains: q.toLowerCase() } }, { mbid: { contains: q } }] }
        : {};

    let orderBy: Prisma.CustomArtistOrderByWithRelationInput[] = [];
    if (sortBy === 'matched') orderBy = [{ matchedAt: sortDir }, { name: 'asc' }];
    else if (sortBy === 'created') orderBy = [{ createdAt: sortDir }, { name: 'asc' }];
    else orderBy = [{ name: sortDir }];

    const [total, items] = await Promise.all([
        prisma.customArtist.count({ where }),
        prisma.customArtist.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);

    // --- NEW: наличие в Lidarr по MBID + опциональный прямой URL
    const mbids = items.map(a => a.mbid).filter((x): x is string => !!x);
    let lidarrSet = new Set<string>();
    const lidarrIdByMbid = new Map<string, number>();

    if (mbids.length) {
        const rows = await prisma.lidarrArtist.findMany({
            where: { mbid: { in: mbids } },
            select: { id: true, mbid: true },
        });
        for (const row of rows) {
            if (row.mbid) {
                lidarrSet.add(row.mbid);
                lidarrIdByMbid.set(row.mbid, row.id);
            }
        }
    }

    // Если задан base URL Лидара в настройках — сформируем прямую ссылку
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    const lidarrBase = (setting?.lidarrUrl || '').replace(/\/+$/, ''); // обрежем хвостовые /

    res.json({
        page,
        pageSize,
        total,
        items: items.map((a) => {
            const has = !!(a.mbid && lidarrSet.has(a.mbid));
            const lidarrId = a.mbid ? lidarrIdByMbid.get(a.mbid) : undefined;
            const lidarrUrl = has && lidarrBase && lidarrId ? `${lidarrBase}/artist/${lidarrId}` : null;

            return {
                id: a.id,
                name: a.name,
                mbid: a.mbid,
                matchedAt: a.matchedAt,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                mbUrl: a.mbid ? `https://musicbrainz.org/artist/${a.mbid}` : null,
                hasLidarr: has,
                lidarrUrl,
            };
        }),
    });
});

// POST /api/custom-artists  { names: string[] }
r.post('/', async (req, res) => {
    const namesRaw: unknown = req.body?.names;
    const names = Array.isArray(namesRaw)
        ? [...new Set(namesRaw.map((s) => String(s || '').trim()).filter(Boolean))]
        : [];
    if (!names.length) return res.status(400).json({ error: 'No names provided' });

    const toCreate: { name: string; nkey: string }[] = [];
    for (const name of names) {
        const key = nkey(name);
        const exists = await prisma.customArtist.findUnique({ where: { nkey: key } });
        if (!exists) toCreate.push({ name, nkey: key });
    }
    if (!toCreate.length) return res.json({ created: 0 });

    const created = await prisma.$transaction(
        toCreate.map((data) => prisma.customArtist.create({ data }))
    );
    res.json({ created: created.length });
});

// PATCH /api/custom-artists/:id  { name?: string, mbid?: string | null }
r.patch('/:id', async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });

    const data: Prisma.CustomArtistUpdateInput = {};
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
        const name = req.body.name.trim();
        data.name = name;
        data.nkey = nkey(name);
    }
    if ('mbid' in req.body) {
        const mbid = req.body.mbid ? String(req.body.mbid) : null;
        data.mbid = mbid;
        data.matchedAt = mbid ? new Date() : null;
    }

    const updated = await prisma.customArtist.update({ where: { id }, data });
    res.json(updated);
});

// DELETE /api/custom-artists/:id
r.delete('/:id', async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    await prisma.customArtist.delete({ where: { id } });
    res.json({ ok: true });
});

/** ---------- МАТЧИНГ: запускаем воркер, возвращаем runId ---------- */

// POST /api/custom-artists/:id/match
r.post('/:id/match', async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    const force =
        req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

    const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
    runCustomArtistsMatch(run.id, { onlyId: id, force }).catch(() => {});
    res.json({ started: true, runId: run.id });
});

// POST /api/custom-artists/match-all
r.post('/match-all', async (req, res) => {
    const force =
        req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

    const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
    runCustomArtistsMatch(run.id, { force }).catch(() => {});
    res.json({ started: true, runId: run.id });
});

export default r;
