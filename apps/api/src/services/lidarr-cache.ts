// apps/api/src/services/lidarr-cache.ts
import { request } from 'undici';
import { prisma } from '../prisma';
import { getLidarrCreds } from '../utils/lidarr-creds';

/** ===== helpers ===== */
function sanitizeBase(url?: string | null) {
    return String(url || '').replace(/\/+$/, '');
}

/** ===== ARTISTS SYNC (Lidarr → DB) =====
 * Полный ресинк артистов:
 *  - читаем /api/v1/artist
 *  - upsert по id
 *  - отсутствующих помечаем removed=true
 */
export async function syncLidarrArtists(): Promise<{ upserted: number; removed: number; total: number }> {
    const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
    const base = sanitizeBase(lidarrUrl);
    const url = `${base}/api/v1/artist?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

    const resp = await request(url, { method: 'GET' });
    const text = await resp.body.text();
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
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
    try { raw = JSON.parse(text); } catch { raw = []; }

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
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null, // Float? в схеме — норм
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

    return { upserted, removed, total: raw.length };
}

/** ===== ALBUMS SYNC (Lidarr → DB) =====
 * Полный ресинк альбомов:
 *  - читаем /api/v1/album
 *  - upsert по id
 *  - отсутствующих помечаем removed=true
 *  Схема: LidarrAlbum (см. prisma/schema.prisma)
 */
export async function syncLidarrAlbums(): Promise<{ upserted: number; removed: number; total: number }> {
    const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();
    const base = sanitizeBase(lidarrUrl);
    const url = `${base}/api/v1/album?apikey=${encodeURIComponent(lidarrApiKey || '')}`;

    const resp = await request(url, { method: 'GET' });
    const text = await resp.body.text();
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
        throw new Error(`Lidarr error ${resp.statusCode}: ${text?.slice(0, 500)}`);
    }

    type LAlbum = {
        id: number;
        title: string;
        foreignAlbumId?: string; // RG mbid
        monitored?: boolean;
        added?: string;
        path?: string;
        statistics?: { sizeOnDisk?: number; trackCount?: number };
        artist?: { artistName?: string };
    };

    let raw: LAlbum[] = [];
    try { raw = JSON.parse(text); } catch { raw = []; }

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
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,  // Float?
                // tracks: в схеме его нет — фильтр по трекам можно делать через Artist.stats на фронте,
                // но если добавишь в схему 'tracks Int?', раскомментируй:
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

    return { upserted, removed, total: raw.length };
}

export default { syncLidarrArtists, syncLidarrAlbums };
