import { Router } from 'express';
import { prisma } from '../prisma';
import { searchArtistMB } from '../services/mb';
import type { Prisma } from '@prisma/client';

const r = Router();

function nkey(s: string) {
    return (s || '').trim().toLowerCase();
}

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
        ? {
            OR: [
                // поиск по нормализованному ключу (lowercase)
                { nkey: { contains: q.toLowerCase() } },
                // и по mbid
                { mbid: { contains: q } },
            ],
        }
        : {};

    let orderBy: Prisma.CustomArtistOrderByWithRelationInput[] = [];
    if (sortBy === 'matched') {
        orderBy = [{ matchedAt: sortDir }, { name: 'asc' }];
    } else if (sortBy === 'created') {
        orderBy = [{ createdAt: sortDir }, { name: 'asc' }];
    } else {
        orderBy = [{ name: sortDir }];
    }

    const [total, items] = await Promise.all([
        prisma.customArtist.count({ where }),
        prisma.customArtist.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);

    res.json({
        page,
        pageSize,
        total,
        items: items.map((a) => ({
            id: a.id,
            name: a.name,
            mbid: a.mbid,
            matchedAt: a.matchedAt,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            mbUrl: a.mbid ? `https://musicbrainz.org/artist/${a.mbid}` : null,
        })),
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
        toCreate.map((data) => prisma.customArtist.create({ data })),
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

// POST /api/custom-artists/:id/match
r.post('/:id/match', async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });

    const a = await prisma.customArtist.findUnique({ where: { id } });
    if (!a) return res.status(404).json({ error: 'Not found' });

    try {
        const mbRes = await searchArtistMB(a.name);
        if (!mbRes?.id) return res.json({ matched: false });

        await prisma.customArtist.update({
            where: { id: a.id },
            data: { mbid: mbRes.id, matchedAt: new Date() },
        });

        res.json({ matched: true, id: a.id, mbid: mbRes.id });
    } catch (e) {
        res.status(500).json({ error: 'MB lookup failed' });
    }
});

// POST /api/custom-artists/match-all
r.post('/match-all', async (_req, res) => {
    const items = await prisma.customArtist.findMany({ where: { mbid: null } });
    let matched = 0;

    for (const a of items) {
        try {
            const mbRes = await searchArtistMB(a.name);
            if (mbRes?.id) {
                await prisma.customArtist.update({
                    where: { id: a.id },
                    data: { mbid: mbRes.id, matchedAt: new Date() },
                });
                matched++;
            }
        } catch {
            // пропускаем
        }
    }

    res.json({ matched, total: items.length });
});

export default r;
