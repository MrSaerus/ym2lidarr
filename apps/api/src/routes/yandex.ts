// apps/api/src/routes/yandex.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

// ===== helpers =====
function nkey(s: string) { return (s || '').trim().toLowerCase(); }
function safeJSON<T = any>(s?: string | null): T | null { if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } }
function num(v: any, def: number) { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) && n > 0 ? n : def; }
function str(v: any, def: string) { const s = String(v ?? '').trim(); return s.length ? s : def; }

// Параметры пагинации/сортировки/поиска
function parsePaging(req: any) {
    const page = num(req.query.page, 1);
    const pageSize = num(req.query.pageSize, 50);
    const q = String(req.query.q ?? '').trim();
    const sortBy = String(req.query.sortBy ?? 'name'); // artists: 'name' | 'id'; albums: 'title' | 'artist' | 'id'
    const sortDir = (String(req.query.sortDir ?? 'asc').toLowerCase() === 'desc') ? 'desc' : 'asc';
    return { page, pageSize, q, sortBy, sortDir };
}

/**
 * Форматы payload в CacheEntry, которые мы поддерживаем:
 *  - артист: { yandexArtistId: number, name: string, mbid?: string }
 *  - альбом: { yandexAlbumId: number, title: string, artistName: string, year?: number, rgMbid?: string }
 *
 * Ключи (поддерживаем оба префикса):
 *  - ya:artist:<id>    | yandex:artist:<id>
 *  - ya:album:<id>     | yandex:album:<id>
 */

// ===== ARTISTS =====
r.get('/artists', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);

    // 1) читаем Яндекс-артистов из кэша (оба префикса)
    const cacheEntries = await prisma.cacheEntry.findMany({
        where: {
            OR: [
                { key: { startsWith: 'ya:artist:' } },
                { key: { startsWith: 'yandex:artist:' } },
            ],
        },
        orderBy: { id: 'asc' },
    });

    type CacheArtist = { yandexArtistId?: number; name?: string; mbid?: string | null };

    // 2) маппим кэш → rowsCache
    const rowsCache = cacheEntries.map((e) => {
        const payload = safeJSON<CacheArtist>(e.payload) || {};
        const yandexArtistId =
            typeof payload.yandexArtistId === 'number'
                ? payload.yandexArtistId
                : Number(
                e.key
                    .replace(/^ya:artist:/, '')
                    .replace(/^yandex:artist:/, ''),
            ) || 0;

        const name = String(payload.name || '').trim();
        const mbid = payload.mbid || null;

        return {
            id: yandexArtistId || 0,
            yandexArtistId: yandexArtistId || 0,
            name,
            mbid,
            yandexUrl: yandexArtistId ? `https://music.yandex.ru/artist/${yandexArtistId}` : 'https://music.yandex.ru/',
            mbUrl: mbid ? `https://musicbrainz.org/artist/${mbid}` : undefined,
            _key: nkey(name),
            _source: 'cache' as const,
        };
    }).filter(x => x.yandexArtistId > 0 && x.name);

    // 3) читаем из Prisma.Artist → rowsDb
    //    (SQLite — без mode:'insensitive', но для q мы всё равно фильтруем ниже в памяти)
    const dbArtists = await prisma.artist.findMany({
        orderBy: { name: 'asc' },
        select: { name: true, mbid: true, key: true },
    });

    const rowsDb = dbArtists.map(a => ({
        id: 0,
        yandexArtistId: 0,
        name: a.name,
        mbid: a.mbid ?? null,
        yandexUrl: `https://music.yandex.ru/search?text=${encodeURIComponent(a.name)}`,
        mbUrl: a.mbid ? `https://musicbrainz.org/artist/${a.mbid}` : undefined,
        _key: a.key || nkey(a.name),
        _source: 'db' as const,
    }));

    // 4) объединяем без дублей (по _key), приоритет — кэш
    const byKey = new Map<string, typeof rowsCache[number] | typeof rowsDb[number]>();
    for (const r0 of rowsDb) byKey.set(r0._key, r0);
    for (const rc of rowsCache) byKey.set(rc._key, rc); // перетираем DB кэшом

    let merged = Array.from(byKey.values());

    // 5) фильтр q
    if (q) {
        const ql = q.toLowerCase();
        merged = merged.filter(a =>
            a.name.toLowerCase().includes(ql) ||
            (a.mbid ? a.mbid.toLowerCase().includes(ql) : false)
        );
    }

    // 6) сортировка
    merged.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'id') cmp = (a.yandexArtistId - b.yandexArtistId);
        else cmp = a.name.localeCompare(b.name, ['ru', 'en'], { sensitivity: 'base', numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
    });

    // 7) пагинация
    const total = merged.length;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = merged.slice(start, end);

    // 8) ответ (убираем служебные поля)
    const items = pageItems.map(x => ({
        id: x.yandexArtistId,
        name: x.name,
        yandexArtistId: x.yandexArtistId,
        yandexUrl: x.yandexUrl,
        mbid: x.mbid || null,
        mbUrl: x.mbid ? `https://musicbrainz.org/artist/${x.mbid}` : undefined,
    }));

    res.json({ page, pageSize, total, items });
});

// ===== ALBUMS =====
r.get('/albums', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);

    // 1) читаем Яндекс-альбомы из кэша (оба префикса)
    const cacheEntries = await prisma.cacheEntry.findMany({
        where: {
            OR: [
                { key: { startsWith: 'ya:album:' } },
                { key: { startsWith: 'yandex:album:' } },
            ],
        },
        orderBy: { id: 'asc' },
    });

    type CacheAlbum = { yandexAlbumId?: number; title?: string; artistName?: string; year?: number; rgMbid?: string | null };

    const rowsCache = cacheEntries.map((e) => {
        const payload = safeJSON<CacheAlbum>(e.payload) || {};
        const yandexAlbumId =
            typeof payload.yandexAlbumId === 'number'
                ? payload.yandexAlbumId
                : Number(
                e.key
                    .replace(/^ya:album:/, '')
                    .replace(/^yandex:album:/, ''),
            ) || 0;

        const title = String(payload.title || '').trim();
        const artistName = String(payload.artistName || '').trim();
        const year = Number.isFinite(Number(payload.year)) ? Number(payload.year) : null;
        const rgMbid = payload.rgMbid || null;

        return {
            id: yandexAlbumId || 0,
            yandexAlbumId: yandexAlbumId || 0,
            title,
            artistName,
            year,
            rgMbid,
            yandexUrl: yandexAlbumId ? `https://music.yandex.ru/album/${yandexAlbumId}` : 'https://music.yandex.ru/',
            rgUrl: rgMbid ? `https://musicbrainz.org/release-group/${rgMbid}` : undefined,
            _akey: nkey(`${artistName}|||${title}`),
            _source: 'cache' as const,
        };
    }).filter(x => x.yandexAlbumId > 0 && (x.title || x.artistName));

    // 2) читаем из Prisma.Album → rowsDb
    const dbAlbums = await prisma.album.findMany({
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
        select: { artist: true, title: true, year: true, rgMbid: true, key: true },
    });

    const rowsDb = dbAlbums.map(a => ({
        id: 0,
        yandexAlbumId: 0,
        title: a.title,
        artistName: a.artist,
        year: a.year ?? null,
        rgMbid: a.rgMbid ?? null,
        yandexUrl: `https://music.yandex.ru/search?text=${encodeURIComponent(`${a.artist} ${a.title}`)}`,
        rgUrl: a.rgMbid ? `https://musicbrainz.org/release-group/${a.rgMbid}` : undefined,
        _akey: a.key || nkey(`${a.artist}|||${a.title}`),
        _source: 'db' as const,
    }));

    // 3) объединяем без дублей по _akey, приоритет — кэш
    const byKey = new Map<string, typeof rowsCache[number] | typeof rowsDb[number]>();
    for (const r0 of rowsDb) byKey.set(r0._akey, r0);
    for (const rc of rowsCache) byKey.set(rc._akey, rc);

    let merged = Array.from(byKey.values());

    // 4) фильтр q
    if (q) {
        const ql = q.toLowerCase();
        merged = merged.filter(r =>
            (r.title && r.title.toLowerCase().includes(ql)) ||
            (r.artistName && r.artistName.toLowerCase().includes(ql)) ||
            (r.rgMbid ? r.rgMbid.toLowerCase().includes(ql) : false)
        );
    }

    // 5) сортировка
    merged.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'id') {
            cmp = (a.yandexAlbumId - b.yandexAlbumId);
        } else if (sortBy === 'artist') {
            cmp = (a.artistName || '').localeCompare(b.artistName || '', ['ru', 'en'], { sensitivity: 'base', numeric: true });
            if (cmp === 0) {
                cmp = (a.title || '').localeCompare(b.title || '', ['ru', 'en'], { sensitivity: 'base', numeric: true });
            }
        } else { // 'title'
            const at = [a.artistName, a.title].filter(Boolean).join(' — ');
            const bt = [b.artistName, b.title].filter(Boolean).join(' — ');
            cmp = at.localeCompare(bt, ['ru', 'en'], { sensitivity: 'base', numeric: true });
        }
        return sortDir === 'asc' ? cmp : -cmp;
    });

    // 6) пагинация
    const total = merged.length;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = merged.slice(start, end);

    // 7) ответ
    const items = pageItems.map(x => ({
        id: x.yandexAlbumId,
        yandexAlbumId: x.yandexAlbumId,
        title: x.title,
        artistName: x.artistName,
        year: x.year,
        yandexUrl: x.yandexUrl,
        rgMbid: x.rgMbid || null,
        rgUrl: x.rgMbid ? `https://musicbrainz.org/release-group/${x.rgMbid}` : undefined,
    }));

    res.json({ page, pageSize, total, items });
});

// ===== DEBUG COUNTS (временно; можно удалить после валидации) =====
r.get('/__debug_counts', async (_req, res) => {
    const [cArtists, cAlbums, cYaArtistsYA, cYaAlbumsYA, cYaArtistsYX, cYaAlbumsYX] = await Promise.all([
        prisma.artist.count(),
        prisma.album.count(),
        prisma.cacheEntry.count({ where: { key: { startsWith: 'ya:artist:' } } }),
        prisma.cacheEntry.count({ where: { key: { startsWith: 'ya:album:' } } }),
        prisma.cacheEntry.count({ where: { key: { startsWith: 'yandex:artist:' } } }),
        prisma.cacheEntry.count({ where: { key: { startsWith: 'yandex:album:' } } }),
    ]);
    res.json({
        prismaArtist: cArtists,
        prismaAlbum: cAlbums,
        cacheYaArtist_ya: cYaArtistsYA,
        cacheYaAlbum_ya: cYaAlbumsYA,
        cacheYaArtist_yandex: cYaArtistsYX,
        cacheYaAlbum_yandex: cYaAlbumsYX,
    });
});

export default r;
