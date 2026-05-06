// apps/api/src/routes/yandex.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { TorrentStatus } from '../prisma';

// НОВОЕ: взаимная блокировка ручных запусков с кроном
import { ensureNotBusyOrThrow } from '../scheduler';

// НОВОЕ: реальные запускатели воркеров
import {
    runYandexPullAll,
    runYandexMatch,
    runYandexPush,
} from '../workers';

import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.yandex' });

/* ------------------------------------------------------------- */
/* helpers                                                       */
/* ------------------------------------------------------------- */

function num(v: any, def: number) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

function parsePaging(req: any) {
    const pageRaw = num(req.query.page, 1);
    const pageSizeRaw = num(req.query.pageSize, 50);
    const page = Math.max(1, pageRaw);
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw)); // clamp 1..200
    const q = String(req.query.q ?? '').trim();
    const sortBy = String(req.query.sortBy ?? 'name'); // artists: 'name' | 'id'; albums: 'title' | 'artist' | 'id'
    const sortDir = String(req.query.sortDir ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    return { page, pageSize, q, sortBy, sortDir };
}

type MbFilter = 'all' | 'missing' | 'with';
type DownloadedFilter = 'all' | 'downloaded' | 'notDownloaded';

function parseMbFilter(req: any): MbFilter {
    const mb = String(req.query?.mb ?? '').trim();
    if (mb === 'all' || mb === 'missing' || mb === 'with') return mb;

    // Backward compatibility with old frontend URL: ?missingMb=1
    return String(req.query?.missingMb ?? '0') === '1' ? 'missing' : 'all';
}

function parseDownloadedFilter(req: any): DownloadedFilter {
    const v = String(req.query?.downloaded ?? 'all').trim();
    if (v === 'downloaded' || v === 'notDownloaded') return v;
    return 'all';
}

const Y_PREFIXES = ['yandex.'];
const Y_JOB_KEYS = ['yandexPull', 'yandexMatch', 'yandexPush'] as const;

/* ------------------------------------------------------------- */
/* РУЧНЫЕ ЗАПУСКИ (manual endpoints с взаимной блокировкой)      */
/* ------------------------------------------------------------- */

// Pull-all (Яндекс → кэш)
r.post('/pull-all', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    try {
        lg.info('yandex pull-all requested', 'yandex.pullAll.start');
        await ensureNotBusyOrThrow(Y_PREFIXES, Y_JOB_KEYS as any);
        const result: any = await runYandexPullAll();
        lg.info('yandex pull-all started', 'yandex.pullAll.done', { runId: result?.runId ?? null });
        res.json({ ok: true, runId: result?.runId ?? null });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        if (status === 409) lg.warn('yandex pull-all rejected: busy', 'yandex.pullAll.busy', { err: e?.message });
        else lg.error('yandex pull-all failed', 'yandex.pullAll.fail', { err: e?.message });
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

// Match (artists|albums|both)
r.post('/match', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    try {
        await ensureNotBusyOrThrow(Y_PREFIXES, Y_JOB_KEYS as any);
        const targetRaw = String(req.body?.target ?? 'both');
        const target: 'artists' | 'albums' | 'both' =
          targetRaw === 'artists' || targetRaw === 'albums' ? (targetRaw as any) : 'both';
        const force = !!req.body?.force;

        lg.info('yandex match requested', 'yandex.match.start', { target, force });

        const result: any = await runYandexMatch(target);
        lg.info('yandex match started', 'yandex.match.done', { runId: result?.runId ?? null });
        res.json({ ok: true, runId: result?.runId ?? null });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        if (status === 409) log.warn('yandex match rejected: busy', 'yandex.match.busy', { err: e?.message });
        else log.error('yandex match failed', 'yandex.match.fail', { err: e?.message });
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

// Push (artists|albums|both) → Lidarr
r.post('/push', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    try {
        await ensureNotBusyOrThrow(Y_PREFIXES, Y_JOB_KEYS as any);
        const targetRaw = String(req.body?.target ?? 'both');
        const target: 'artists' | 'albums' | 'both' =
          targetRaw === 'artists' || targetRaw === 'albums' ? (targetRaw as any) : 'both';

        lg.info('yandex push requested', 'yandex.push.start', { target });

        const result: any = await runYandexPush(target);
        lg.info('yandex push started', 'yandex.push.done', { runId: result?.runId ?? null });
        res.json({ ok: true, runId: result?.runId ?? null });
    } catch (e: any) {
        const status = e?.status === 409 ? 409 : 500;
        if (status === 409) lg.warn('yandex push rejected: busy', 'yandex.push.busy', { err: e?.message });
        else lg.error('yandex push failed', 'yandex.push.fail', { err: e?.message });
        res.status(status).json({ ok: false, error: e?.message || String(e) });
    }
});

/* ------------------------------------------------------------- */
/* ЧТЕНИЕ СПИСКОВ (как было)                                     */
/* ------------------------------------------------------------- */

// ===== ARTISTS =====
r.get('/artists', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    const mbFilter = parseMbFilter(req);
    lg.info('yandex artists requested', 'yandex.artists.start', { page, pageSize, q, sortBy, sortDir, mbFilter });

    try {
        let rows = await prisma.yandexArtist.findMany({
            where: { present: true },
            select: { ymId: true, name: true, mbid: true },
        });
        rows = rows.filter((a) => /^\d+$/.test(String(a.ymId || '')));

        if (q) {
            const ql = q.toLowerCase();
            rows = rows.filter(
              (a) =>
                (a.name || '').toLowerCase().includes(ql) ||
                (a.mbid ? a.mbid.toLowerCase().includes(ql) : false) ||
                String(a.ymId).includes(q),
            );
        }
        if (mbFilter === 'missing') {
            rows = rows.filter((a) => !a.mbid || a.mbid.trim() === '');
        } else if (mbFilter === 'with') {
            rows = rows.filter((a) => !!a.mbid && a.mbid.trim() !== '');
        }
        rows.sort((a, b) => {
            if (sortBy === 'id') {
                const ai = parseInt(String(a.ymId), 10);
                const bi = parseInt(String(b.ymId), 10);
                const cmp = ai - bi;
                return sortDir === 'asc' ? cmp : -cmp;
            }
            const cmp = (a.name || '').localeCompare(b.name || '', ['ru', 'en'], {
                sensitivity: 'base',
                numeric: true,
            });
            return sortDir === 'asc' ? cmp : -cmp;
        });

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const pageItems = rows.slice(start, end);

        const items = pageItems.map((x) => {
            const idNum = Number(x.ymId) || 0;
            const mbid = x.mbid || null;
            return {
                id: idNum,
                name: x.name,
                yandexArtistId: idNum,
                yandexUrl: `https://music.yandex.ru/artist/${idNum}`,
                mbid,
                mbUrl: mbid ? `https://musicbrainz.org/artist/${mbid}` : undefined,
            };
        });

        lg.debug('yandex artists prepared', 'yandex.artists.done', { total, returned: items.length });
        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        lg.error('yandex artists failed', 'yandex.artists.fail', { err: e?.message });
        res.status(500).json({ message: e?.message || String(e) });
    }
});

// ===== ALBUMS =====
r.get('/albums', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    const mbFilter = parseMbFilter(req);
    lg.info('yandex albums requested', 'yandex.albums.start', { page, pageSize, q, sortBy, sortDir, mbFilter });

    try {
        let rows = await prisma.yandexAlbum.findMany({
            where: { present: true },
            select: { ymId: true, title: true, artist: true, year: true, rgMbid: true },
        });
        rows = rows.filter((r) => /^\d+$/.test(String(r.ymId || '')));

        if (q) {
            const ql = q.toLowerCase();
            rows = rows.filter(
              (r) =>
                (r.title || '').toLowerCase().includes(ql) ||
                (r.artist || '').toLowerCase().includes(ql) ||
                (r.rgMbid ? r.rgMbid.toLowerCase().includes(ql) : false) ||
                String(r.ymId).includes(q),
            );
        }
        if (mbFilter === 'missing') {
            rows = rows.filter((r) => !r.rgMbid || r.rgMbid.trim() === '');
        } else if (mbFilter === 'with') {
            rows = rows.filter((r) => !!r.rgMbid && r.rgMbid.trim() !== '');
        }
        rows.sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'id') {
                cmp = (parseInt(String(a.ymId), 10) || 0) - (parseInt(String(b.ymId), 10) || 0);
            } else if (sortBy === 'artist') {
                cmp = (a.artist || '').localeCompare(b.artist || '', ['ru', 'en'], {
                    sensitivity: 'base',
                    numeric: true,
                });
                if (cmp === 0) {
                    cmp = (a.title || '').localeCompare(b.title || '', ['ru', 'en'], {
                        sensitivity: 'base',
                        numeric: true,
                    });
                }
            } else {
                const at = [a.artist, a.title].filter(Boolean).join(' — ');
                const bt = [b.artist, b.title].filter(Boolean).join(' — ');
                cmp = at.localeCompare(bt, ['ru', 'en'], { sensitivity: 'base', numeric: true });
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const pageItems = rows.slice(start, end);

        const items = pageItems.map((x) => {
            const idNum = Number(x.ymId) || 0;
            const rgMbid = x.rgMbid || null;
            return {
                id: idNum,
                yandexAlbumId: idNum,
                title: x.title,
                artistName: x.artist || '',
                year: x.year ?? null,
                yandexUrl: `https://music.yandex.ru/album/${idNum}`,
                rgMbid,
                rgUrl: rgMbid ? `https://musicbrainz.org/release-group/${rgMbid}` : undefined,
            };
        });

        lg.debug('yandex albums prepared', 'yandex.albums.done', { total, returned: items.length });
        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        lg.error('yandex albums failed', 'yandex.albums.fail', { err: e?.message });
        res.status(500).json({ message: e?.message || String(e) });
    }
});


// ===== TRACKS =====
r.get('/tracks', async (req, res) => {
    const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    const mbFilter = parseMbFilter(req);
    const downloadedFilter = parseDownloadedFilter(req);
    lg.info('yandex tracks requested', 'yandex.tracks.start', {
        page, pageSize, q, sortBy, sortDir, mbFilter, downloadedFilter,
    });

    try {
        let rows = await prisma.yandexTrack.findMany({
            where: { present: true },
            select: {
                ymId: true,
                title: true,
                artist: true,
                album: true,
                durationSec: true,
                ymAlbumId: true,
                recMbid: true,
                rgMbid: true,
            },
        });
        rows = rows.filter((r) => /^\d+$/.test(String(r.ymId || '')));

        if (q) {
            const ql = q.toLowerCase();
            rows = rows.filter(
              (r) =>
                (r.title || '').toLowerCase().includes(ql) ||
                (r.artist || '').toLowerCase().includes(ql) ||
                (r.album || '').toLowerCase().includes(ql) ||
                (r.recMbid ? r.recMbid.toLowerCase().includes(ql) : false) ||
                (r.rgMbid ? r.rgMbid.toLowerCase().includes(ql) : false) ||
                String(r.ymId).includes(q),
            );
        }

        if (mbFilter === 'missing') {
            rows = rows.filter((r) =>
              (!r.recMbid || r.recMbid.trim() === '') &&
              (!r.rgMbid || r.rgMbid.trim() === ''),
            );
        } else if (mbFilter === 'with') {
            rows = rows.filter((r) =>
              (!!r.recMbid && r.recMbid.trim() !== '') ||
              (!!r.rgMbid && r.rgMbid.trim() !== ''),
            );
        }

        const completedStatuses = [
            TorrentStatus.downloaded,
            TorrentStatus.moving,
            TorrentStatus.moved,
        ];

        const downloadedTasks = await prisma.torrentTask.findMany({
            where: {
                status: { in: completedStatuses },
                OR: [
                    // Direct track task: mark only that exact track.
                    { ymTrackId: { not: null } },
                    // Album task: mark every cached Yandex track from that album.
                    // Important: track tasks may also have ymAlbumId, so keep this scoped to album tasks.
                    { scope: 'album', ymAlbumId: { not: null } },
                ],
            },
            select: { scope: true, ymTrackId: true, ymAlbumId: true },
        });

        const downloadedTrackIds = new Set<string>();
        const downloadedAlbumIds = new Set<string>();

        for (const t of downloadedTasks) {
            const ymTrackId = String(t.ymTrackId || '').trim();
            const ymAlbumId = String(t.ymAlbumId || '').trim();
            if (ymTrackId) downloadedTrackIds.add(ymTrackId);
            if (t.scope === 'album' && ymAlbumId) downloadedAlbumIds.add(ymAlbumId);
        }

        const isDownloaded = (r: { ymId: string | number; ymAlbumId?: string | null }) => {
            const ymTrackId = String(r.ymId || '').trim();
            const ymAlbumId = String(r.ymAlbumId || '').trim();
            return downloadedTrackIds.has(ymTrackId) || (!!ymAlbumId && downloadedAlbumIds.has(ymAlbumId));
        };

        if (downloadedFilter === 'downloaded') {
            rows = rows.filter((r) => isDownloaded(r));
        } else if (downloadedFilter === 'notDownloaded') {
            rows = rows.filter((r) => !isDownloaded(r));
        }

        rows.sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'id') {
                cmp = (parseInt(String(a.ymId), 10) || 0) - (parseInt(String(b.ymId), 10) || 0);
            } else if (sortBy === 'artist') {
                cmp = (a.artist || '').localeCompare(b.artist || '', ['ru', 'en'], {
                    sensitivity: 'base',
                    numeric: true,
                });
                if (cmp === 0) cmp = (a.title || '').localeCompare(b.title || '', ['ru', 'en'], { sensitivity: 'base', numeric: true });
            } else if (sortBy === 'album') {
                cmp = (a.album || '').localeCompare(b.album || '', ['ru', 'en'], {
                    sensitivity: 'base',
                    numeric: true,
                });
                if (cmp === 0) cmp = (a.title || '').localeCompare(b.title || '', ['ru', 'en'], { sensitivity: 'base', numeric: true });
            } else {
                cmp = (a.title || '').localeCompare(b.title || '', ['ru', 'en'], {
                    sensitivity: 'base',
                    numeric: true,
                });
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });

        const total = rows.length;
        const start = (page - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const pageItems = rows.slice(start, end);

        const items = pageItems.map((x) => {
            const idNum = Number(x.ymId) || 0;
            const ymAlbumId = x.ymAlbumId && /^\d+$/.test(String(x.ymAlbumId)) ? String(x.ymAlbumId) : null;
            const recMbid = x.recMbid || null;
            const rgMbid = x.rgMbid || null;
            return {
                id: idNum,
                yandexTrackId: idNum,
                title: x.title,
                artistName: x.artist || '',
                albumTitle: x.album || '',
                durationSec: x.durationSec ?? null,
                yandexAlbumId: ymAlbumId ? Number(ymAlbumId) : null,
                yandexUrl: ymAlbumId
                  ? `https://music.yandex.ru/album/${ymAlbumId}/track/${idNum}`
                  : `https://music.yandex.ru/track/${idNum}`,
                recMbid,
                rgMbid,
                mbUrl: recMbid
                  ? `https://musicbrainz.org/recording/${recMbid}`
                  : (rgMbid ? `https://musicbrainz.org/release-group/${rgMbid}` : undefined),
                downloaded: isDownloaded(x),
            };
        });

        lg.debug('yandex tracks prepared', 'yandex.tracks.done', { total, returned: items.length });
        res.json({ page, pageSize, total, items });
    } catch (e: any) {
        lg.error('yandex tracks failed', 'yandex.tracks.fail', { err: e?.message });
        res.status(500).json({ message: e?.message || String(e) });
    }
});

export default r;
