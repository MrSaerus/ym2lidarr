// apps/api/src/routes/unified.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

/* -------------------- helpers -------------------- */

function nkey(s: string) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function parsePaging(req: any) {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const psRaw = String(req.query.pageSize ?? req.query.pagesize ?? '50');
    const psNum = parseInt(psRaw, 10);
    const pageSize = Number.isFinite(psNum) && psNum > 0 ? psNum : 50;

    const q = String(req.query.q ?? '').trim();
    const sortBy = String(req.query.sortBy ?? 'name'); // artists: 'name'|'id'; albums: 'title'|'artist'|'id'
    const sortDir = String(req.query.sortDir ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    return { page, pageSize, q, sortBy, sortDir };
}
async function getBaseUrls() {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const lidarrUrl = s?.lidarrUrl?.replace(/\/+$/, '') || '';
    return { lidarrUrl };
}

/* ================================================================
   ARTISTS (Yandex + Lidarr)
   ================================================================ */

type UArtistRow = {
    id: number;
    name: string;

    mbUrl?: string | null;

    yandexArtistId?: string | null;
    yandexUrl?: string | null;

    lidarrId?: number | null;
    lidarrUrl?: string | null;
};

r.get('/artists', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    const { lidarrUrl } = await getBaseUrls();

    const [ya, la] = await Promise.all([
        prisma.yandexArtist.findMany({
            where: { present: true },
            select: { ymId: true, name: true, mbid: true },
        }),
        prisma.lidarrArtist.findMany({
            where: { removed: false },
            select: { id: true, name: true, mbid: true },
        }),
    ]);

    const byName = new Map<string, UArtistRow>();
    let counter = 0;

    const ensure = (name: string): UArtistRow => {
        const k = nkey(name);
        let row = byName.get(k);
        if (!row) {
            row = {
                id: ++counter,
                name,
                yandexArtistId: null,
                yandexUrl: null,
                lidarrId: null,
                lidarrUrl: null,
                mbUrl: null,
            };
            byName.set(k, row);
        }
        return row;
    };

    // Yandex
    for (const y of ya) {
        const row = ensure(y.name);
        row.yandexArtistId = String(y.ymId);
        row.yandexUrl = `https://music.yandex.ru/artist/${y.ymId}`;
        if (y.mbid && !row.mbUrl) row.mbUrl = `https://musicbrainz.org/artist/${y.mbid}`;
    }

    // Lidarr
    for (const l of la) {
        const row = ensure(l.name);
        row.lidarrId = l.id;
        if (l.mbid && lidarrUrl) {
            row.lidarrUrl = `${lidarrUrl}/artist/${l.mbid}`;
            if (!row.mbUrl) row.mbUrl = `https://musicbrainz.org/artist/${l.mbid}`;
        }
        // если ссылку на Lidarr ещё можно сформировать по MBID из Yandex — сделаем
        if (!row.lidarrUrl && lidarrUrl && row.mbUrl?.includes('/artist/')) {
            const mbid = row.mbUrl.split('/').pop();
            if (mbid) row.lidarrUrl = `${lidarrUrl}/artist/${mbid}`;
        }
    }

    let items = Array.from(byName.values());

    if (q) {
        const nq = nkey(q);
        items = items.filter((x) => nkey(x.name).includes(nq));
    }

    items.sort((a, b) => {
        if (sortBy === 'id') return sortDir === 'asc' ? a.id - b.id : b.id - a.id;
        const an = nkey(a.name), bn = nkey(b.name);
        if (an < bn) return sortDir === 'asc' ? -1 : 1;
        if (an > bn) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    res.json({ page, pageSize, total, items: pageItems });
});

/* ================================================================
   ALBUMS (Yandex + Lidarr)
   ================================================================ */

type UAlbumRow = {
    id: number;
    title: string;
    artistName: string;

    rgUrl?: string | null;        // MB release-group (если есть)
    releaseUrl?: string | null;   // резерв: MB release

    yandexAlbumId?: string | null;
    yandexUrl?: string | null;

    lidarrAlbumId?: number | null;
    lidarrUrl?: string | null;

    year?: number | null;
};

r.get('/albums', async (req, res) => {
    const { page, pageSize, q, sortBy, sortDir } = parsePaging(req);
    const { lidarrUrl } = await getBaseUrls();

    const [ya, la] = await Promise.all([
        prisma.yandexAlbum.findMany({
            where: { present: true },
            select: { ymId: true, title: true, artist: true, year: true, rgMbid: true },
        }),
        prisma.lidarrAlbum.findMany({
            where: { removed: false },
            select: { id: true, title: true, artistName: true, mbid: true },
        }),
    ]);

    const pairKey = (a: string, t: string) => `${nkey(a)}—${nkey(t)}`;

    const byPair = new Map<string, UAlbumRow>();
    let counter = 0;

    const ensure = (artistName: string, title: string): UAlbumRow => {
        const k = pairKey(artistName, title);
        let row = byPair.get(k);
        if (!row) {
            row = {
                id: ++counter,
                title,
                artistName,
                yandexAlbumId: null,
                yandexUrl: null,
                lidarrAlbumId: null,
                lidarrUrl: null,
                rgUrl: null,
                releaseUrl: null,
                year: null,
            };
            byPair.set(k, row);
        }
        return row;
    };

    // Yandex: основа
    for (const y of ya) {
        const row = ensure(y.artist || '', y.title);
        row.yandexAlbumId = String(y.ymId);
        row.yandexUrl = `https://music.yandex.ru/album/${y.ymId}`;
        if (y.year != null) row.year = row.year ?? y.year;
        if (y.rgMbid) row.rgUrl = `https://musicbrainz.org/release-group/${y.rgMbid}`;
    }

    // Lidarr: факт наличия + возможный release MBID
    for (const l of la) {
        const row = ensure(l.artistName || '', l.title);
        row.lidarrAlbumId = l.id;

        if (l.mbid && !row.releaseUrl) row.releaseUrl = `https://musicbrainz.org/release/${l.mbid}`;
        if (!row.lidarrUrl && lidarrUrl && row.lidarrAlbumId != null && row.rgUrl) {
            const rg = row.rgUrl.split('/').pop();
            if (rg) row.lidarrUrl = `${lidarrUrl}/album/${rg}`;
        }
    }

    let items = Array.from(byPair.values());

    if (q) {
        const nq = nkey(q);
        items = items.filter((x) => nkey(x.title).includes(nq) || nkey(x.artistName).includes(nq));
    }

    items.sort((a, b) => {
        if (sortBy === 'id') return sortDir === 'asc' ? a.id - b.id : b.id - a.id;
        if (sortBy === 'artist') {
            const an = nkey(a.artistName), bn = nkey(b.artistName);
            if (an < bn) return sortDir === 'asc' ? -1 : 1;
            if (an > bn) return sortDir === 'asc' ? 1 : -1;
        }
        const at = nkey(a.title), bt = nkey(b.title);
        if (at < bt) return sortDir === 'asc' ? -1 : 1;
        if (at > bt) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    res.json({ page, pageSize, total, items: pageItems });
});

export default r;
