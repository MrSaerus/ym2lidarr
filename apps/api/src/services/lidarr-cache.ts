// apps/api/src/services/lidarr-cache.ts
import { request } from 'undici';
import { prisma } from '../prisma';
import { getLidarrCreds } from '../utils/lidarr-creds';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'service.lidarrCache' });

/** ===== helpers ===== */
function sanitizeBase(url?: string | null) {
    return String(url || '').replace(/\/+$/, '');
}

export async function syncLidarrArtists(): Promise<{ upserted: number; removed: number; total: number }> {
    const startedAt = Date.now();
    try {
        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const base = sanitizeBase(lidarrUrl);
        const url = `${base}/api/v1/artist?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

        log.info('artists sync start', 'lidarr.cache.artists.start', { base, path: '/api/v1/artist' });

        const resp = await request(url, { method: 'GET' });
        const text = await resp.body.text();
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            log.error('artists sync http error', 'lidarr.cache.artists.http', { status: resp.statusCode, preview: text?.slice(0, 180) });
            throw new Error(`Lidarr error ${resp.statusCode}: ${text?.slice(0, 500)}`);
        }

        type LArtist = {
            id: number;
            artistName: string;
            foreignArtistId?: string; // mbid
            monitored?: boolean;
            path?: string;
            added?: string;
            statistics?: { albumCount?: number; trackCount?: number; sizeOnDisk?: number };
        };

        let raw: LArtist[] = [];
        try { raw = JSON.parse(text); }
        catch {
            log.error('artists sync parse error', 'lidarr.cache.artists.parse', { size: text?.length || 0 });
            raw = [];
        }

        log.debug('artists fetched', 'lidarr.cache.artists.fetched', { count: raw.length });

        const now = new Date();
        const incomingIds = new Set<number>();
        let upserted = 0;

        for (const a of raw) {
            incomingIds.add(a.id);
            await prisma.lidarrArtist.upsert({
                where: { id: a.id },
                create: {
                    id: a.id,
                    name: a.artistName || '',
                    mbid: a.foreignArtistId || null,
                    monitored: !!a.monitored,
                    path: a.path || null,
                    added: a.added ? new Date(a.added) : null,
                    albums: a.statistics?.albumCount ?? null,
                    tracks: a.statistics?.trackCount ?? null,
                    sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                    removed: false,
                    lastSyncAt: now,
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
                    lastSyncAt: now,
                },
            });
            upserted++;
        }

        // помечаем отсутствующих как removed
        const toCheck = await prisma.lidarrArtist.findMany({ where: { removed: false }, select: { id: true } });
        let removed = 0;
        for (const r of toCheck) {
            if (!incomingIds.has(r.id)) {
                await prisma.lidarrArtist.update({
                    where: { id: r.id },
                    data: { removed: true, lastSyncAt: now },
                });
                removed++;
            }
        }

        const durMs = Date.now() - startedAt;
        log.info('artists sync done', 'lidarr.cache.artists.done', { total: raw.length, upserted, removed, durMs });
        return { upserted, removed, total: raw.length };
    } catch (e: any) {
        const durMs = Date.now() - startedAt;
        log.error('artists sync failed', 'lidarr.cache.artists.fail', { err: e?.message || String(e), durMs });
        throw e;
    }
}

export async function syncLidarrAlbums(): Promise<{ upserted: number; removed: number; total: number }> {
    const startedAt = Date.now();
    try {
        const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
        const base = sanitizeBase(lidarrUrl);
        const url = `${base}/api/v1/album?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

        log.info('albums sync start', 'lidarr.cache.albums.start', { base, path: '/api/v1/album' });

        const resp = await request(url, { method: 'GET' });
        const text = await resp.body.text();
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            log.error('albums sync http error', 'lidarr.cache.albums.http', { status: resp.statusCode, preview: text?.slice(0, 180) });
            throw new Error(`Lidarr error ${resp.statusCode}: ${text?.slice(0, 500)}`);
        }

        type LAlbum = {
            id: number;
            title: string;
            foreignAlbumId?: string;
            monitored?: boolean;
            added?: string;
            path?: string;
            statistics?: { sizeOnDisk?: number; trackCount?: number };
            artist?: { artistName?: string };
        };

        let raw: LAlbum[] = [];
        try { raw = JSON.parse(text); }
        catch {
            log.error('albums sync parse error', 'lidarr.cache.albums.parse', { size: text?.length || 0 });
            raw = [];
        }

        log.debug('albums fetched', 'lidarr.cache.albums.fetched', { count: raw.length });

        const now = new Date();
        const incoming = new Set<number>();
        let upserted = 0;

        for (const a of raw) {
            incoming.add(a.id);
            await prisma.lidarrAlbum.upsert({
                where: { id: a.id },
                create: {
                    id: a.id,
                    mbid: a.foreignAlbumId || null,
                    title: a.title || '',
                    artistName: a.artist?.artistName || null,
                    path: a.path || null,
                    monitored: !!a.monitored,
                    added: a.added ? new Date(a.added) : null,
                    sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                    // tracks: a.statistics?.trackCount ?? null,
                    removed: false,
                    lastSyncAt: now,
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
                    lastSyncAt: now,
                },
            });
            upserted++;
        }

        const existing = await prisma.lidarrAlbum.findMany({ where: { removed: false }, select: { id: true } });
        let removed = 0;
        for (const e of existing) {
            if (!incoming.has(e.id)) {
                await prisma.lidarrAlbum.update({
                    where: { id: e.id },
                    data: { removed: true, lastSyncAt: now },
                });
                removed++;
            }
        }

        const durMs = Date.now() - startedAt;
        log.info('albums sync done', 'lidarr.cache.albums.done', { total: raw.length, upserted, removed, durMs });
        return { upserted, removed, total: raw.length };
    } catch (e: any) {
        const durMs = Date.now() - startedAt;
        log.error('albums sync failed', 'lidarr.cache.albums.fail', { err: e?.message || String(e), durMs });
        throw e;
    }
}

export default { syncLidarrArtists, syncLidarrAlbums };
