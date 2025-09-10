// apps/api/src/routes/custom-artists.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { startRun } from '../log';
import { runCustomArtistsMatch } from '../workers';
import type { Prisma } from '@prisma/client';

// НОВОЕ: взаимная блокировка с кроном custom.*
import { ensureNotBusyOrThrow } from '../scheduler';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.custom-artists' });

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
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    lg.info('list custom artists requested', 'custom.artists.list.start', { page, pageSize, q, sortBy, sortDir });

    try {
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

        lg.debug('fetched custom artists from DB', 'custom.artists.list.db', { total, itemsCount: items.length });

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
            lg.debug('resolved lidarr presence by mbid', 'custom.artists.list.lidarr', { checked: mbids.length, found: lidarrSet.size });
        }

        // Если задан base URL Лидара в настройках — сформируем прямую ссылку
        const setting = await prisma.setting.findUnique({ where: { id: 1 } });
        const lidarrBase = (setting?.lidarrUrl || '').replace(/\/+$/, ''); // обрежем хвостовые /
        lg.debug('resolved lidarr base url', 'custom.artists.list.lidarr.base', { lidarrBase });

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

        lg.info('list custom artists completed', 'custom.artists.list.done', { returned: items.length, total });
    } catch (err: any) {
        lg.error('list custom artists failed', 'custom.artists.list.fail', { err: err?.message });
        res.status(500).json({ ok: false, error: 'Failed to list custom artists' });
    }
});

// POST /api/custom-artists  { names: string[] }
r.post('/', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    lg.info('create custom artists requested', 'custom.artists.create.start');

    try {
        const namesRaw: unknown = req.body?.names;
        const names = Array.isArray(namesRaw)
          ? [...new Set((namesRaw as any[]).map((s) => String(s ?? '').trim()).filter(Boolean))]
          : [];

        if (!names.length) {
            lg.warn('empty names payload', 'custom.artists.create.empty');
            return res.status(400).json({ ok: false, error: 'No names provided', added: 0, exists: 0, failed: 0, created: 0 });
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
            lg.warn('all names invalid', 'custom.artists.create.invalid', { invalidCount: errors.length });
            return res.status(400).json({
                ok: false,
                error: 'All names are invalid',
                added: 0,
                exists: 0,
                failed: errors.length,
                errors,
                created: 0
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

        lg.debug('prechecked existing artists', 'custom.artists.create.precheck', {
            requested: names.length, valid: validNames.length, alreadyExists: existingSet.size, toInsert: toInsert.length
        });

        // если все уже были
        if (toInsert.length === 0) {
            lg.info('no new artists to insert', 'custom.artists.create.nothing');
            return res.json({
                ok: true,
                added: 0,
                exists: existingSet.size,
                failed: errors.length,
                errors,
                existed: existing.map((e) => e.name).sort(),
                createdIds: [],
                created: 0
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
            lg.debug('insert chunk processed', 'custom.artists.create.chunk', { chunkSize: chunk.length, addedSoFar: added, raceExistsSoFar: raceExists });
        }

        // Итоговое exists = что было до + что поймали на гонке
        const exists = existingSet.size + raceExists;
        const failed = errors.length;

        lg.info('create custom artists completed', 'custom.artists.create.done', { added, exists, failed });

        return res.json({
            ok: true,
            added,
            exists,
            failed,
            errors,
            existed: existing.map((e) => e.name).sort(),
            createdIds,
            created: added,
        });
    } catch (e: any) {
        log.error('create custom artists failed', 'custom.artists.create.fail', { err: e?.message });
        return res.status(500).json({
            ok: false,
            error: e?.message || String(e),
            created: 0,
        });
    }
});

// PATCH /api/custom-artists/:id  { name?: string, mbid?: string | null }
r.patch('/:id', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
        lg.warn('bad id for patch', 'custom.artists.patch.badid', { raw: req.params.id });
        return res.status(400).json({ error: 'Bad id' });
    }

    try {
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
        lg.info('custom artist updated', 'custom.artists.patch.done', { id, changedName: !!data.name, changedMbid: 'mbid' in data });
        res.json(updated);
    } catch (e: any) {
        lg.error('custom artist patch failed', 'custom.artists.patch.fail', { id, err: e?.message });
        res.status(500).json({ error: 'Failed to update custom artist' });
    }
});

// DELETE /api/custom-artists/:id
r.delete('/:id', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
        lg.warn('bad id for delete', 'custom.artists.delete.badid', { raw: req.params.id });
        return res.status(400).json({ error: 'Bad id' });
    }
    try {
        await prisma.customArtist.delete({ where: { id } });
        lg.info('custom artist deleted', 'custom.artists.delete.done', { id });
        res.json({ ok: true });
    } catch (e: any) {
        lg.error('custom artist delete failed', 'custom.artists.delete.fail', { id, err: e?.message });
        res.status(500).json({ ok: false, error: 'Failed to delete custom artist' });
    }
});

/** ---------- МАТЧИНГ: запускаем воркер, возвращаем runId ----------
 *  БЛОКИРУЕМ, если идёт любой custom.match.* / custom.push.* (крон/ручной)
 */

// POST /api/custom-artists/:id/match
r.post('/:id/match', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    try {
        await ensureNotBusyOrThrow(['custom.'], ['customMatch', 'customPush'] as any);

        const id = parseInt(String(req.params.id), 10);
        if (!id) {
            lg.warn('bad id for single match', 'custom.artists.match.badid', { raw: req.params.id });
            return res.status(400).json({ error: 'Bad id' });
        }
        const force =
          req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

        const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
        lg.info('custom artist match started', 'custom.artists.match.start', { runId: run.id, id, force });

        runCustomArtistsMatch(run.id, { onlyId: id, force }).catch((e) => {
            lg.error('worker crash (single match)', 'custom.artists.match.worker.fail', { runId: run.id, err: e?.message });
        });

        res.json({ ok: true, started: true, runId: run.id });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        if (status === 409) {
            lg.warn('custom match rejected: busy', 'custom.artists.match.busy', { err: e?.message });
        } else {
            lg.error('custom match start failed', 'custom.artists.match.fail', { err: e?.message });
        }
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

// POST /api/custom-artists/match-all
r.post('/match-all', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    try {
        await ensureNotBusyOrThrow(['custom.'], ['customMatch', 'customPush'] as any);

        const force =
          req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';

        const run = await startRun('custom', { phase: 'start', c_total: 0, c_done: 0, c_matched: 0 });
        lg.info('custom artists match-all started', 'custom.artists.matchAll.start', { runId: run.id, force });

        runCustomArtistsMatch(run.id, { force }).catch((e) => {
            lg.error('worker crash (match-all)', 'custom.artists.matchAll.worker.fail', { runId: run.id, err: e?.message });
        });

        res.json({ ok: true, started: true, runId: run.id });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        if (status === 409) {
            lg.warn('custom match-all rejected: busy', 'custom.artists.matchAll.busy', { err: e?.message });
        } else {
            lg.error('custom match-all start failed', 'custom.artists.matchAll.fail', { err: e?.message });
        }
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

export default r;
