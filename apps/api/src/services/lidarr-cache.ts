import { prisma } from '../prisma';

// используем ту же функцию, что и в роутере, чтобы взять URL+apikey
import { getLidarrCreds } from '../utils/lidarr-creds'; // см. ниже утилиту

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

// Полная перезапись кэша: upsert по id, помечаем "removed" те, кого больше нет
export async function syncLidarrArtists(): Promise<{ upserted: number; removed: number; total: number; }> {
    const { lidarrUrl, lidarrApiKey } = await getLidarrCreds();

    const resp = await fetch(`${lidarrUrl}/api/v1/artist?apikey=${encodeURIComponent(lidarrApiKey)}`);
    if (!resp.ok) {
        throw new Error(`Lidarr error ${resp.status} ${await resp.text()}`);
    }
    const raw: LArtist[] = await resp.json();

    const now = new Date();
    const incomingIds = new Set<number>();

    // upsert пачкой (последовательно — просто и надёжно; при желании можно batched транзакцией)
    let upserted = 0;
    for (const a of raw) {
        incomingIds.add(a.id);
        await prisma.lidarrArtist.upsert({
            where: { id: a.id },
            create: {
                id: a.id,
                name: a.artistName,
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
                name: a.artistName,
                mbid: a.foreignArtistId || null,
                monitored: !!a.monitored,
                path: a.path || null,
                added: a.added ? new Date(a.added) : null,
                albums: a.statistics?.albumCount ?? null,
                tracks: a.statistics?.trackCount ?? null,
                sizeOnDisk: a.statistics?.sizeOnDisk ?? null,
                removed: false,
                lastSyncAt: now,
            }
        });
        upserted++;
    }

    // пометить отсутствующих как removed=true
    const toRemove = await prisma.lidarrArtist.findMany({
        where: { removed: false },
        select: { id: true },
    });
    let removed = 0;
    for (const r of toRemove) {
        if (!incomingIds.has(r.id)) {
            await prisma.lidarrArtist.update({ where: { id: r.id }, data: { removed: true, lastSyncAt: now } });
            removed++;
        }
    }

    return { upserted, removed, total: raw.length };
}
