// apps/api/src/routes/custom-artists.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { startRun } from '../log';
import { runCustomArtistsMatch } from '../workers';
import type { Prisma } from '@prisma/client';

// НОВОЕ: взаимная блокировка с кроном custom.*
import { ensureNotBusyOrThrow } from '../scheduler';

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
            const lidarrUrl = has && lidarrBase && lidarrId ? `${lidarrBase}/artist/${a.mbid}` : null;

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
    try {
        const namesRaw: unknown = req.body?.names;
        const names = Array.isArray(namesRaw)
          ? [...new Set((namesRaw as any[]).map((s) => String(s ?? '').trim()).filter(Boolean))]
          : [];

        if (!names.length) {
            return res.status(400).json({ ok: false, error: 'No names provided', added: 0, exists: 0, failed: 0 });
        }

        // легкая валидация и сбор ошибок, не ломаем весь батч
        type ErrRec = { name: string; message: string };
        const errors: ErrRec[] = [];
        const validNames: string[] = [];
        for (const nm of names) {
            if (nm.length > 200) errors.push({ name: nm, message: 'Name is too long (max 200 chars)' });
            else validNames.push(nm);
        }
        if (!validNames.length) {
            return res.status(400).json({
                ok: false,
                error: 'All names are invalid',
                added: 0,
                exists: 0,
                failed: errors.length,
                errors,
            });
        }

        const payload = validNames.map((name) => ({ name, nkey: nkey(name) }));
        const keys = [...new Set(payload.map((p) => p.nkey))];

        // узнаём заранее, что уже есть (одним запросом)
        const existing = await prisma.customArtist.findMany({
            where: { nkey: { in: keys } },
            select: { id: true, nkey: true, name: true },
        });
        const existingSet = new Set(existing.map((e) => e.nkey));

        const toInsert = payload.filter((p) => !existingSet.has(p.nkey));

        // если все уже были
        if (toInsert.length === 0) {
            return res.json({
                ok: true,
                added: 0,
                exists: existingSet.size,
                failed: errors.length,
                errors,
                existed: existing.map((e) => e.name).sort(),
                createdIds: [],
            });
        }

        // Вставляем поштучно, ловим P2002 как "exists" (гонка)
        let added = 0;
        let raceExists = 0;
        const createdIds: number[] = [];

        // Можно батчить по 100 для снижения нагрузки
        const chunkSize = 100;
        for (let i = 0; i < toInsert.length; i += chunkSize) {
            const chunk = toInsert.slice(i, i + chunkSize);

            const results = await Promise.allSettled(
              chunk.map((rec) =>
                prisma.customArtist.create({ data: rec })
              )
            );

            for (let j = 0; j < results.length; j++) {
                const resu = results[j];
                const rec = chunk[j];

                if (resu.status === 'fulfilled') {
                    added += 1;
                    createdIds.push(resu.value.id);
                } else {
                    const ex: any = resu.reason;
                    const code = ex?.code || ex?.meta?.code || '';
                    if (String(code).toUpperCase() === 'P2002') {
                        // уникальный конфликт — считаем как "exists" (гонка)
                        raceExists += 1;
                    } else {
                        errors.push({ name: rec.name, message: ex?.message || 'Insert error' });
                    }
                }
            }
        }

        // Итоговое exists = что было до + что поймали на гонке
        const exists = existingSet.size + raceExists;
        const failed = errors.length;

        return res.json({
            ok: true,
            added,
            exists,
            failed,
            errors,
            existed: existing.map((e) => e.name).sort(),
            createdIds,
        });
    } catch (e: any) {
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
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

/** ---------- МАТЧИНГ: запускаем воркер, возвращаем runId ----------
 *  БЛОКИРУЕМ, если идёт любой custom.match.* / custom.push.* (крон/ручной)
 */

// POST /api/custom-artists/:id/match
r.post('/:id/match', async (req, res) => {
    try {
        await ensureNotBusyOrThrow(['custom.'], ['customMatch', 'customPush'] as any);

        const id = parseInt(String(req.params.id), 10);
        if (!id) return res.status(400).json({ error: 'Bad id' });
        const force =
            req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

        const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
        runCustomArtistsMatch(run.id, { onlyId: id, force }).catch(() => {});
        res.json({ ok: true, started: true, runId: run.id });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

// POST /api/custom-artists/match-all
r.post('/match-all', async (req, res) => {
    try {
        await ensureNotBusyOrThrow(['custom.'], ['customMatch', 'customPush'] as any);

        const force =
            req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

        const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
        runCustomArtistsMatch(run.id, { force }).catch(() => {});
        res.json({ ok: true, started: true, runId: run.id });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

export default r;
