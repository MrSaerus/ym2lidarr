// apps/api/src/services/yandex-cache.ts
import { prisma } from '../prisma';

export async function upsertYandexArtistCache(a: {
    yandexArtistId: number;
    name: string;
    mbid?: string;
    aliases?: string[];
    covers?: string[];
}) {
    const key = `ya:artist:${a.yandexArtistId}`;
    const payload = JSON.stringify({
        source: 'yandex',
        yandexArtistId: a.yandexArtistId,
        name: a.name,
        mbid: a.mbid ?? undefined,
        aliases: a.aliases ?? undefined,
        covers: a.covers ?? undefined,
        ts: new Date().toISOString(),
    });
    await prisma.cacheEntry.upsert({
        where: { key },
        create: { scope: 'artist', key, payload },
        update: { payload }, // updatedAt сработает автоматически
    });
}

export async function upsertYandexAlbumCache(alb: {
    yandexAlbumId: number;
    title: string;
    artistName: string;
    rgMbid?: string;
    year?: number;
}) {
    const key = `ya:album:${alb.yandexAlbumId}`;
    const payload = JSON.stringify({
        source: 'yandex',
        yandexAlbumId: alb.yandexAlbumId,
        title: alb.title,
        artistName: alb.artistName,
        rgMbid: alb.rgMbid ?? undefined,
        year: alb.year ?? undefined,
        ts: new Date().toISOString(),
    });
    await prisma.cacheEntry.upsert({
        where: { key },
        create: { scope: 'album', key, payload },
        update: { payload },
    });
}
