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
import { assertMusicBrainzContactEmailConfigured } from '../services/mb';

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

function stripTrailingSlashesForExternalLinks(s?: string | null): string {
    return String(s ?? '').replace(/\/+$/, '');
}

function normMbidForExternalLinks(v: unknown): string {
    return String(v || '')
      .replace(/^mbid:/i, '')
      .trim()
      .toLowerCase();
}

function makeLidarrEntityUrl(
    base: string,
    kind: 'artist' | 'album',
    mbid?: string | null,
): string | undefined {
    const b = stripTrailingSlashesForExternalLinks(base);
    const id = normMbidForExternalLinks(mbid);
    return b && id ? `${b}/${kind}/${encodeURIComponent(id)}` : undefined;
}

function makeNavidromeEntityUrl(
    base: string,
    kind: 'artist' | 'album',
    ndId?: string | null,
): string | undefined {
    const b = stripTrailingSlashesForExternalLinks(base);
    const id = String(ndId || '').trim();
    return b && id ? `${b}/app/#/${kind}/${encodeURIComponent(id)}/show` : undefined;
}


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
        const status = e?.status === 400 ? 400 : (e?.status === 409 ? 409 : 500);
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
        await assertMusicBrainzContactEmailConfigured();
        const targetRaw = String(req.body?.target ?? 'both');
        const target: 'artists' | 'albums' | 'both' =
          targetRaw === 'artists' || targetRaw === 'albums' ? (targetRaw as any) : 'both';
        const force = !!req.body?.force;

        lg.info('yandex match requested', 'yandex.match.start', { target, force });

        const result: any = await runYandexMatch(target);
        lg.info('yandex match started', 'yandex.match.done', { runId: result?.runId ?? null });
        res.json({ ok: true, runId: result?.runId ?? null });
    } catch (e: any) {
        const status = e?.status === 400 ? 400 : (e?.status === 409 ? 409 : 500);
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
        const status = e?.status === 400 ? 400 : (e?.status === 409 ? 409 : 500);
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
            select: { ymId: true, name: true, mbid: true, ndId: true },
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

        const externalSettingsForArtists = await prisma.setting.findFirst({
            where: { id: 1 },
            select: { lidarrUrl: true, navidromeUrl: true },
        });
        const lidarrBaseForArtists = stripTrailingSlashesForExternalLinks(externalSettingsForArtists?.lidarrUrl);
        const navidromeBaseForArtists = stripTrailingSlashesForExternalLinks(externalSettingsForArtists?.navidromeUrl);

        const artistMbidsForLinks = Array.from(new Set(
            pageItems.map((x) => normMbidForExternalLinks(x.mbid)).filter(Boolean),
        ));
        const lidarrArtistMbidsForLinks = new Set<string>();

        if (artistMbidsForLinks.length) {
            const lidarrArtistsForLinks = await prisma.lidarrArtist.findMany({
                where: { removed: false, mbid: { in: artistMbidsForLinks } },
                select: { mbid: true },
            });

            for (const artist of lidarrArtistsForLinks) {
                const mbid = normMbidForExternalLinks(artist.mbid);
                if (mbid) lidarrArtistMbidsForLinks.add(mbid);
            }
        }

        const items = pageItems.map((x) => {
            const idNum = Number(x.ymId) || 0;
            const mbid = x.mbid || null;
            const cleanMbid = normMbidForExternalLinks(mbid);

            return {
                id: idNum,
                name: x.name,
                yandexArtistId: idNum,
                yandexUrl: `https://music.yandex.ru/artist/${idNum}`,
                mbid,
                mbUrl: mbid ? `https://musicbrainz.org/artist/${mbid}` : undefined,
                lidarrUrl: cleanMbid && lidarrArtistMbidsForLinks.has(cleanMbid)
                  ? makeLidarrEntityUrl(lidarrBaseForArtists, 'artist', cleanMbid)
                  : undefined,
                navidromeUrl: makeNavidromeEntityUrl(navidromeBaseForArtists, 'artist', x.ndId),
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
    const downloadedFilter = parseDownloadedFilter(req);

    lg.info('yandex albums requested', 'yandex.albums.start', {
        page,
        pageSize,
        q,
        sortBy,
        sortDir,
        mbFilter,
        downloadedFilter,
    });

    try {
        let rows = await prisma.yandexAlbum.findMany({
            where: { present: true },
            select: {
                ymId: true,
                title: true,
                artist: true,
                year: true,
                rgMbid: true,
                ndId: true,
            },
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

        const normMbid = (v: unknown) =>
          String(v || '')
            .replace(/^mbid:/i, '')
            .trim()
            .toLowerCase();

        const chunked = <T,>(xs: T[], size = 500): T[][] => {
            const out: T[][] = [];
            for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
            return out;
        };

        const completedStatuses = [
            TorrentStatus.downloaded,
            TorrentStatus.moving,
            TorrentStatus.moved,
        ];

        /*
         * Source 1: YM2LIDARR service.
         * For Albums we mark only album-scope tasks as album downloaded.
         */
        const serviceAlbumTasks = await prisma.torrentTask.findMany({
            where: {
                status: { in: completedStatuses },
                scope: 'album',
                ymAlbumId: { not: null },
            },
            select: {
                ymAlbumId: true,
            },
        });

        const serviceDownloadedAlbumIds = new Set<string>();
        for (const t of serviceAlbumTasks) {
            const ymAlbumId = String(t.ymAlbumId || '').trim();
            if (ymAlbumId) serviceDownloadedAlbumIds.add(ymAlbumId);
        }

        /*
         * Source 2: Lidarr.
         * Match Yandex album MusicBrainz release-group id to Lidarr album mbid.
         * Use sizeOnDisk > 0 as actual downloaded signal.
         */
        const candidateRgMbids = Array.from(new Set(
            rows
              .map((r) => normMbid(r.rgMbid))
              .filter(Boolean),
        ));

        const lidarrDownloadedAlbumMbids = new Set<string>();

        if (candidateRgMbids.length) {
            for (const mbidsChunk of chunked(candidateRgMbids, 500)) {
                const lidarrAlbums = await prisma.lidarrAlbum.findMany({
                    where: {
                        removed: false,
                        mbid: { in: mbidsChunk },
                        sizeOnDisk: { gt: 0 },
                    },
                    select: {
                        mbid: true,
                    },
                });

                for (const a of lidarrAlbums) {
                    const mbid = normMbid(a.mbid);
                    if (mbid) lidarrDownloadedAlbumMbids.add(mbid);
                }
            }
        }

        /*
         * Source 3: Navidrome/YandexLikeSync.
         * Direct album sync is strongest.
         * Additionally, if at least one confirmed synced Yandex track belongs to this album,
         * mark the album as present in Navidrome. This mirrors the track-level fallback.
         */
        const albumYmIds = Array.from(new Set(
            rows
              .map((r) => String(r.ymId || '').trim())
              .filter(Boolean),
        ));

        const navidromeDownloadedAlbumIds = new Set<string>();

        if (albumYmIds.length) {
            for (const idsChunk of chunked(albumYmIds, 500)) {
                const directAlbumLikes = await prisma.yandexLikeSync.findMany({
                    where: {
                        kind: 'album',
                        ymId: { in: idsChunk },
                        OR: [
                            { status: 'synced' },
                            { starConfirmedAt: { not: null } },
                        ],
                    },
                    select: {
                        ymId: true,
                    },
                });

                for (const row of directAlbumLikes) {
                    const ymAlbumId = String(row.ymId || '').trim();
                    if (ymAlbumId) navidromeDownloadedAlbumIds.add(ymAlbumId);
                }

                const syncedTracks = await prisma.yandexTrack.findMany({
                    where: {
                        present: true,
                        ymAlbumId: { in: idsChunk },
                        likeSyncs: {
                            some: {
                                kind: 'track',
                                OR: [
                                    { status: 'synced' },
                                    { starConfirmedAt: { not: null } },
                                ],
                            },
                        },
                    },
                    select: {
                        ymAlbumId: true,
                    },
                });

                for (const track of syncedTracks) {
                    const ymAlbumId = String(track.ymAlbumId || '').trim();
                    if (ymAlbumId) navidromeDownloadedAlbumIds.add(ymAlbumId);
                }
            }
        }

        const isDownloadedByService = (r: { ymId: string | number }) => {
            const ymAlbumId = String(r.ymId || '').trim();
            return !!ymAlbumId && serviceDownloadedAlbumIds.has(ymAlbumId);
        };

        const isDownloadedByLidarr = (r: { rgMbid?: string | null }) => {
            const rgMbid = normMbid(r.rgMbid);
            return !!rgMbid && lidarrDownloadedAlbumMbids.has(rgMbid);
        };

        const isDownloadedByNavidrome = (r: { ymId: string | number; ndId?: string | null }) => {
            const directNdId = String(r.ndId || '').trim();
            if (directNdId) return true;

            const ymAlbumId = String(r.ymId || '').trim();
            return !!ymAlbumId && navidromeDownloadedAlbumIds.has(ymAlbumId);
        };

        const getDownloadedSources = (r: { ymId: string | number; rgMbid?: string | null }) => {
            const sources: Array<'ym2lidarr' | 'lidarr' | 'navidrome'> = [];
            if (isDownloadedByService(r)) sources.push('ym2lidarr');
            if (isDownloadedByLidarr(r)) sources.push('lidarr');
            if (isDownloadedByNavidrome(r)) sources.push('navidrome');
            return sources;
        };

        const isDownloaded = (r: { ymId: string | number; rgMbid?: string | null }) =>
          getDownloadedSources(r).length > 0;

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

        const externalSettingsForAlbums = await prisma.setting.findFirst({
            where: { id: 1 },
            select: { lidarrUrl: true, navidromeUrl: true },
        });
        const lidarrBaseForAlbums = stripTrailingSlashesForExternalLinks(externalSettingsForAlbums?.lidarrUrl);
        const navidromeBaseForAlbums = stripTrailingSlashesForExternalLinks(externalSettingsForAlbums?.navidromeUrl);

        const albumRgMbidsForLinks = Array.from(new Set(
            pageItems.map((x) => normMbid(x.rgMbid)).filter(Boolean),
        ));
        const lidarrAlbumMbidsForLinks = new Set<string>();

        if (albumRgMbidsForLinks.length) {
            for (const mbidsChunk of chunked(albumRgMbidsForLinks, 500)) {
                const lidarrAlbumsForLinks = await prisma.lidarrAlbum.findMany({
                    where: { removed: false, mbid: { in: mbidsChunk } },
                    select: { mbid: true },
                });

                for (const album of lidarrAlbumsForLinks) {
                    const mbid = normMbid(album.mbid);
                    if (mbid) lidarrAlbumMbidsForLinks.add(mbid);
                }
            }
        }

        const items = pageItems.map((x) => {
            const idNum = Number(x.ymId) || 0;
            const rgMbid = x.rgMbid || null;
            const cleanRgMbid = normMbid(rgMbid);

            return {
                id: idNum,
                yandexAlbumId: idNum,
                title: x.title,
                artistName: x.artist || '',
                year: x.year ?? null,
                yandexUrl: `https://music.yandex.ru/album/${idNum}`,
                rgMbid,
                rgUrl: rgMbid ? `https://musicbrainz.org/release-group/${rgMbid}` : undefined,
                lidarrUrl: cleanRgMbid && lidarrAlbumMbidsForLinks.has(cleanRgMbid)
                  ? makeLidarrEntityUrl(lidarrBaseForAlbums, 'album', cleanRgMbid)
                  : undefined,
                navidromeUrl: makeNavidromeEntityUrl(navidromeBaseForAlbums, 'album', x.ndId),
                downloaded: isDownloaded(x),
                downloadedBy: getDownloadedSources(x),
                lidarrDownloaded: isDownloadedByLidarr(x),
                navidromeDownloaded: isDownloadedByNavidrome(x),
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

        const normMbid = (v: unknown) =>
          String(v || '')
            .replace(/^mbid:/i, '')
            .trim()
            .toLowerCase();

        const chunked = <T,>(xs: T[], size = 500): T[][] => {
            const out: T[][] = [];
            for (let i = 0; i < xs.length; i += size) {
                out.push(xs.slice(i, i + size));
            }
            return out;
        };

        /*
         * yandexTrack.rgMbid может быть пустым.
         * Поэтому для MusicBrainz/Lidarr статуса трека используем album fallback:
         * yandexTrack.ymAlbumId -> yandexAlbum.rgMbid.
         */
        const trackYmAlbumIds = Array.from(new Set(
            rows
              .map((r) => String(r.ymAlbumId || '').trim())
              .filter(Boolean),
        ));

        const yandexAlbumRgByYmAlbumId = new Map<string, string>();
        const yandexAlbumNdByYmAlbumId = new Map<string, string>();

        if (trackYmAlbumIds.length) {
            for (const idsChunk of chunked(trackYmAlbumIds, 500)) {
                const yandexAlbumsForTracks = await prisma.yandexAlbum.findMany({
                    where: {
                        present: true,
                        ymId: { in: idsChunk },
                    },
                    select: {
                        ymId: true,
                        rgMbid: true,
                        ndId: true,
                    },
                });

                for (const a of yandexAlbumsForTracks) {
                    const ymAlbumId = String(a.ymId || '').trim();
                    const rgMbid = normMbid(a.rgMbid);
                    if (ymAlbumId && rgMbid) {
                        yandexAlbumRgByYmAlbumId.set(ymAlbumId, rgMbid);
                    }

                    const ndId = String(a.ndId || '').trim();
                    if (ymAlbumId && ndId) {
                        yandexAlbumNdByYmAlbumId.set(ymAlbumId, ndId);
                    }
                }
            }
        }

        const getAlbumRgMbid = (r: { ymAlbumId?: string | null }) => {
            const ymAlbumId = String(r.ymAlbumId || '').trim();
            return ymAlbumId ? yandexAlbumRgByYmAlbumId.get(ymAlbumId) || '' : '';
        };

        const rowHasMusicBrainz = (r: { recMbid?: string | null; rgMbid?: string | null; ymAlbumId?: string | null }) => {
            return !!normMbid(r.recMbid) || !!normMbid(r.rgMbid) || !!getAlbumRgMbid(r);
        };

        if (mbFilter === 'missing') {
            rows = rows.filter((r) => !rowHasMusicBrainz(r));
        } else if (mbFilter === 'with') {
            rows = rows.filter((r) => rowHasMusicBrainz(r));
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
                    { ymTrackId: { not: null } },
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

        const candidateRgMbids = Array.from(new Set([
            ...rows
              .map((r) => normMbid(r.rgMbid))
              .filter(Boolean),
            ...rows
              .map((r) => getAlbumRgMbid(r))
              .filter(Boolean),
        ]));

        const lidarrDownloadedAlbumMbids = new Set<string>();

        if (candidateRgMbids.length) {
            for (const mbidsChunk of chunked(candidateRgMbids, 500)) {
                const lidarrDownloadedAlbums = await prisma.lidarrAlbum.findMany({
                    where: {
                        removed: false,
                        mbid: { in: mbidsChunk },
                        sizeOnDisk: { gt: 0 },
                    },
                    select: { mbid: true },
                });

                for (const a of lidarrDownloadedAlbums) {
                    const mbid = normMbid(a.mbid);
                    if (mbid) lidarrDownloadedAlbumMbids.add(mbid);
                }
            }
        }

        const externalSettingsForTracks = await prisma.setting.findFirst({
            where: { id: 1 },
            select: { lidarrUrl: true, navidromeUrl: true },
        });
        const lidarrBaseForTracks = stripTrailingSlashesForExternalLinks(externalSettingsForTracks?.lidarrUrl);
        const navidromeBaseForTracks = stripTrailingSlashesForExternalLinks(externalSettingsForTracks?.navidromeUrl);

        const lidarrAlbumMbidsForTrackLinks = new Set<string>();

        if (candidateRgMbids.length) {
            for (const mbidsChunk of chunked(candidateRgMbids, 500)) {
                const lidarrAlbumsForTrackLinks = await prisma.lidarrAlbum.findMany({
                    where: { removed: false, mbid: { in: mbidsChunk } },
                    select: { mbid: true },
                });

                for (const album of lidarrAlbumsForTrackLinks) {
                    const mbid = normMbid(album.mbid);
                    if (mbid) lidarrAlbumMbidsForTrackLinks.add(mbid);
                }
            }
        }

        const getExternalTrackAlbumLidarrUrl = (r: { ymAlbumId?: string | null; rgMbid?: string | null }) => {
            const trackRgMbid = normMbid(r.rgMbid);
            const albumRgMbid = getAlbumRgMbid(r);
            const mbid = trackRgMbid && lidarrAlbumMbidsForTrackLinks.has(trackRgMbid)
              ? trackRgMbid
              : albumRgMbid;

            return mbid && lidarrAlbumMbidsForTrackLinks.has(mbid)
              ? makeLidarrEntityUrl(lidarrBaseForTracks, 'album', mbid)
              : undefined;
        };

        const getExternalTrackAlbumNavidromeUrl = (r: { ymAlbumId?: string | null }) => {
            const ymAlbumId = String(r.ymAlbumId || '').trim();
            const ndId = ymAlbumId ? yandexAlbumNdByYmAlbumId.get(ymAlbumId) : undefined;
            return makeNavidromeEntityUrl(navidromeBaseForTracks, 'album', ndId);
        };

        const isDownloadedByService = (r: { ymId: string | number; ymAlbumId?: string | null }) => {
            const ymTrackId = String(r.ymId || '').trim();
            const ymAlbumId = String(r.ymAlbumId || '').trim();
            return downloadedTrackIds.has(ymTrackId) || (!!ymAlbumId && downloadedAlbumIds.has(ymAlbumId));
        };

        const navidromeDownloadedTrackIds = new Set<string>();

        const trackYmIds = Array.from(new Set(
            rows
              .map((r) => String(r.ymId || '').trim())
              .filter(Boolean),
        ));

        if (trackYmIds.length) {
            for (const idsChunk of chunked(trackYmIds, 500)) {
                const likeRows = await prisma.yandexLikeSync.findMany({
                    where: {
                        kind: 'track',
                        ymId: { in: idsChunk },
                        OR: [
                            { status: 'synced' },
                            { starConfirmedAt: { not: null } },
                        ],
                    },
                    select: {
                        ymId: true,
                    },
                });

                for (const row of likeRows) {
                    const ymId = String(row.ymId || '').trim();
                    if (ymId) navidromeDownloadedTrackIds.add(ymId);
                }
            }
        }

        const isDownloadedByNavidrome = (r: { ymId: string | number; ymAlbumId?: string | null }) => {
            const ymTrackId = String(r.ymId || '').trim();
            if (ymTrackId && navidromeDownloadedTrackIds.has(ymTrackId)) return true;

            const ymAlbumId = String(r.ymAlbumId || '').trim();
            return !!ymAlbumId && !!yandexAlbumNdByYmAlbumId.get(ymAlbumId);
        };

        const isDownloadedByLidarr = (r: { ymAlbumId?: string | null; rgMbid?: string | null }) => {
            const trackRgMbid = normMbid(r.rgMbid);
            if (trackRgMbid && lidarrDownloadedAlbumMbids.has(trackRgMbid)) return true;

            const albumRgMbid = getAlbumRgMbid(r);
            return !!albumRgMbid && lidarrDownloadedAlbumMbids.has(albumRgMbid);
        };

        const getDownloadedSources = (r: { ymId: string | number; ymAlbumId?: string | null; rgMbid?: string | null }) => {
            const sources: Array<'ym2lidarr' | 'lidarr' | 'navidrome'> = [];
            if (isDownloadedByService(r)) sources.push('ym2lidarr');
            if (isDownloadedByLidarr(r)) sources.push('lidarr');
            if (isDownloadedByNavidrome(r)) sources.push('navidrome');
            return sources;
        };

        const isDownloaded = (r: { ymId: string | number; ymAlbumId?: string | null; rgMbid?: string | null }) =>
          getDownloadedSources(r).length > 0;

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

            // Prefer track.rgMbid, but fall back to album.rgMbid.
            const rgMbid = x.rgMbid || getAlbumRgMbid(x) || null;

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
                lidarrUrl: getExternalTrackAlbumLidarrUrl(x),
                navidromeUrl: getExternalTrackAlbumNavidromeUrl(x),
                downloaded: isDownloaded(x),
                downloadedBy: getDownloadedSources(x),
                lidarrDownloaded: isDownloadedByLidarr(x),
                navidromeDownloaded: isDownloadedByNavidrome(x),
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
