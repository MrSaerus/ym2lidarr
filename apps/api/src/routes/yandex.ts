// apps/api/src/routes/yandex.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

// ===== helpers =====
function num(v: any, def: number) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

// Параметры пагинации/сортировки/поиска
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

/**
 * НОВЫЕ эндпоинты: читаем напрямую из YandexArtist/YandexAlbum.
 * MusicBrainz-поля можно игнорить на фронте; ссылки на Яндекс строим ТОЛЬКО из числового ymId.
 */

// ===== ARTISTS =====
r.get('/artists', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);

    // Берём только present:true и только записи с ЧИСЛОВЫМ ymId
    let rows = await prisma.yandexArtist.findMany({
        where: { present: true },
        select: { ymId: true, name: true, mbid: true },
    });
    rows = rows.filter((a) => /^\d+$/.test(String(a.ymId || '')));

    // Фильтр q
    if (q) {
        const ql = q.toLowerCase();
        rows = rows.filter(
            (a) =>
                (a.name || '').toLowerCase().includes(ql) ||
                (a.mbid ? a.mbid.toLowerCase().includes(ql) : false) ||
                String(a.ymId).includes(q),
        );
    }

    // Сортировка
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

    // Пагинация
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = rows.slice(start, end);

    // Ответ под фронт
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

    res.json({ page, pageSize, total, items });
});

// ===== ALBUMS =====
r.get('/albums', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);

    // Берём только present:true и только с ЧИСЛОВЫМ ymId
    let rows = await prisma.yandexAlbum.findMany({
        where: { present: true },
        select: { ymId: true, title: true, artist: true, year: true, rgMbid: true },
    });
    rows = rows.filter((r) => /^\d+$/.test(String(r.ymId || '')));

    // Фильтр q
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

    // Сортировка
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
            // title (по умолчанию) — сортируем по "Artist — Title"
            const at = [a.artist, a.title].filter(Boolean).join(' — ');
            const bt = [b.artist, b.title].filter(Boolean).join(' — ');
            cmp = at.localeCompare(bt, ['ru', 'en'], { sensitivity: 'base', numeric: true });
        }
        return sortDir === 'asc' ? cmp : -cmp;
    });

    // Пагинация
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = rows.slice(start, end);

    // Ответ под фронт
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

    res.json({ page, pageSize, total, items });
});

export default r;
