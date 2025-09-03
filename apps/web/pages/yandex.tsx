// apps/web/pages/yandex.tsx
import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

type Target = 'artists' | 'albums';

type YArtistRow = {
    id: number;
    name: string;
    yandexArtistId: number;
    yandexUrl: string;
    mbid?: string | null;
    mbUrl?: string | null;
};
type YAlbumRow = {
    id: number;
    title: string;
    artistName: string;
    yandexAlbumId: number;
    yandexUrl: string;
    rgMbid?: string | null;
    rgUrl?: string | null;
    year?: number | null;
};

type ApiResp<T> = { page: number; pageSize: number; total: number; items: T[] };

type SortFieldArtists = 'name' | 'id';
type SortFieldAlbums = 'title' | 'artist' | 'id';

/* ==== Fixed link slots (Yandex | MusicBrainz) ==== */
const LINKS_COL_WIDTH = 'w-[14rem]';

function LinkSlot({
                      href,
                      label,
                      className,
                  }: {
    href?: string | null;
    label: 'Yandex' | 'MusicBrainz';
    className: string;
}) {
    if (!href) {
        return (
            <span className={`link-chip ${className} invisible select-none`} aria-hidden="true">
        {label}
      </span>
        );
    }
    return (
        <a href={href} target="_blank" rel="noreferrer" className={`link-chip ${className}`}>
            {label}
        </a>
    );
}

function LinksFixedRow({
                           yandexUrl,
                           mbUrl,
                       }: {
    yandexUrl?: string | null;
    mbUrl?: string | null;
}) {
    return (
        <div className={`grid grid-cols-2 gap-2 justify-items-center ${LINKS_COL_WIDTH}`}>
            <LinkSlot href={yandexUrl} label="Yandex" className="link-chip--ym" />
            <LinkSlot href={mbUrl} label="MusicBrainz" className="link-chip--mb" />
        </div>
    );
}
/* ================================================ */

export default function YandexPage() {
    const router = useRouter();

    const [target, setTarget] = useState<Target>('artists');
    const [rows, setRows] = useState<(YArtistRow | YAlbumRow)[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string>('');

    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(50);
    const [total, setTotal] = useState(0);

    const [sortByArtists, setSortByArtists] = useState<SortFieldArtists>('name');
    const [sortDirArtists, setSortDirArtists] = useState<'asc' | 'desc'>('asc');
    const [sortByAlbums, setSortByAlbums] = useState<SortFieldAlbums>('title');
    const [sortDirAlbums, setSortDirAlbums] = useState<'asc' | 'desc'>('asc');

    useEffect(() => {
        if (!router.isReady) return;
        const t = router.query.target as string | undefined;
        if (t === 'albums' || t === 'artists') setTarget(t);

        const qp = router.query.page as string | undefined;
        const qs = router.query.pageSize as string | undefined;
        const qq = router.query.q as string | undefined;

        const sba = router.query.sortByArtists as string | undefined;
        const sda = router.query.sortDirArtists as string | undefined;
        const sbb = router.query.sortByAlbums as string | undefined;
        const sdb = router.query.sortDirAlbums as string | undefined;

        if (qp) setPage(Math.max(1, parseInt(qp, 10) || 1));
        if (qs) setPageSize(Math.max(1, parseInt(qs, 10) || 50));
        if (typeof qq === 'string') setQ(qq);

        if (sba === 'name' || sba === 'id') setSortByArtists(sba as SortFieldArtists);
        if (sda === 'asc' || sda === 'desc') setSortDirArtists(sda);
        if (sbb === 'title' || sbb === 'artist' || sbb === 'id') setSortByAlbums(sbb as SortFieldAlbums);
        if (sdb === 'asc' || sdb === 'desc') setSortDirAlbums(sdb);
    }, [
        router.isReady,
        router.query.target,
        router.query.page,
        router.query.pageSize,
        router.query.q,
        router.query.sortByArtists,
        router.query.sortDirArtists,
        router.query.sortByAlbums,
        router.query.sortDirAlbums,
    ]);

    const load = useCallback(
        async (p = page) => {
            setLoading(true);
            setErrorMsg('');
            try {
                const params = new URLSearchParams({
                    page: String(p),
                    pageSize: String(pageSize),
                    q,
                    sortBy: target === 'artists' ? sortByArtists : sortByAlbums,
                    sortDir: target === 'artists' ? sortDirArtists : sortDirAlbums,
                } as Record<string, string>);

                const path =
                    target === 'artists'
                        ? `/api/yandex/artists?${params.toString()}`
                        : `/api/yandex/albums?${params.toString()}`;

                const r = await api<ApiResp<YArtistRow | YAlbumRow>>(path);
                setRows(r.items || []);
                setPage(p);
                setTotal(r.total || 0);
            } catch (e: any) {
                setErrorMsg(e?.message || String(e));
                setRows([]);
                setTotal(0);
            } finally {
                setLoading(false);
            }
        },
        [page, pageSize, q, target, sortByArtists, sortDirArtists, sortByAlbums, sortDirAlbums],
    );

    useEffect(() => {
        if (!router.isReady) return;
        load(page);
    }, [router.isReady, page, q, pageSize, target, sortByArtists, sortDirArtists, sortByAlbums, sortDirAlbums, load]);

    function updateUrl(params: Record<string, string>) {
        if (!router.isReady) return;
        router.replace({ pathname: router.pathname, query: { ...router.query, ...params } }, undefined, {
            shallow: true,
        });
    }
    function setTargetAndUrl(t: Target) {
        setTarget(t);
        setPage(1);
        updateUrl({
            target: t,
            page: '1',
            pageSize: String(pageSize),
            q,
            sortByArtists,
            sortDirArtists,
            sortByAlbums,
            sortDirAlbums,
        });
    }
    function setPageAndUrl(p: number) {
        setPage(p);
        updateUrl({
            target,
            page: String(p),
            pageSize: String(pageSize),
            q,
            sortByArtists,
            sortDirArtists,
            sortByAlbums,
            sortDirAlbums,
        });
    }
    function setPageSizeAndUrl(ps: number) {
        setPageSize(ps);
        setPage(1);
        updateUrl({
            target,
            page: '1',
            pageSize: String(ps),
            q,
            sortByArtists,
            sortDirArtists,
            sortByAlbums,
            sortDirAlbums,
        });
    }
    function setQAndUrl(newQ: string) {
        setQ(newQ);
        setPage(1);
        updateUrl({
            target,
            page: '1',
            pageSize: String(pageSize),
            q: newQ,
            sortByArtists,
            sortDirArtists,
            sortByAlbums,
            sortDirAlbums,
        });
    }

    function setSortArtistsAndUrl(field: SortFieldArtists) {
        const dir = sortByArtists === field ? (sortDirArtists === 'asc' ? 'desc' : 'asc') : 'asc';
        setSortByArtists(field);
        setSortDirArtists(dir);
        setPage(1);
        updateUrl({
            target,
            page: '1',
            pageSize: String(pageSize),
            q,
            sortByArtists: field,
            sortDirArtists: dir,
            sortByAlbums,
            sortDirAlbums,
        });
    }
    function setSortAlbumsAndUrl(field: SortFieldAlbums) {
        const dir = sortByAlbums === field ? (sortDirAlbums === 'asc' ? 'desc' : 'asc') : 'asc';
        setSortByAlbums(field);
        setSortDirAlbums(dir);
        setPage(1);
        updateUrl({
            target,
            page: '1',
            pageSize: String(pageSize),
            q,
            sortByArtists,
            sortDirArtists,
            sortByAlbums: field,
            sortDirAlbums: dir,
        });
    }


    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const headerArrow = (active: boolean) =>
        active ? (
            <span className="text-xs text-gray-500">
        {(target === 'artists' ? sortDirArtists : sortDirAlbums) === 'asc' ? '▲' : '▼'}
      </span>
        ) : null;

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-4">
                <h1 className="h1">Yandex</h1>
                <div className="toolbar">
                    <div className="inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
                        <button
                            className={`btn ${target === 'artists' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setTargetAndUrl('artists')}
                        >
                            Artists
                        </button>
                        <button
                            className={`btn ${target === 'albums' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setTargetAndUrl('albums')}
                        >
                            Albums
                        </button>
                    </div>
                </div>
                <div className="toolbar">
                    <input
                        placeholder={target === 'albums' ? 'Search title or artist…' : 'Search by name…'}
                        className="input w-80"
                        value={q}
                        onChange={(e) => setQAndUrl(e.target.value)}
                    />
                    <button className="btn btn-outline" onClick={() => load(page)} disabled={loading}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>
                <div className="toolbar">
                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-gray-500 text-nowrap">Rows per page:</span>
                        <select className="bg-slate-900 text-slate-100 text-sm border border-slate-700 rounded px-2 py-1" value={pageSize}
                                onChange={(e) => setPageSizeAndUrl(Number(e.target.value))}>
                            {[25, 50, 100, 200].map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                        <div className="flex items-center gap-1">
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(1)} disabled={page <= 1}>
                                {'«'}
                            </button>
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(Math.max(1, page - 1))}
                                    disabled={page <= 1}>
                                {'‹'}
                            </button>
                            <span className="text-xs text-gray-500 px-2">Page {page}/{pageCount}</span>
                            <button className="btn btn-outline"
                                    onClick={() => setPageAndUrl(Math.min(pageCount, page + 1))}
                                    disabled={page >= pageCount}>
                                {'›'}
                            </button>
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(pageCount)}
                                    disabled={page >= pageCount}>
                                {'»'}
                            </button>
                        </div>
                    </div>
                </div>

                {errorMsg && <div className="panel p-3 text-red-500 text-sm">{errorMsg}</div>}

                <div className="panel overflow-x-auto">
                    <Table className="table-default">
                        <thead>
                        <tr>
                            <Th>#</Th>
                            {target === 'artists' ? (
                                <>
                                    <Th className="select-none">
                                        <button
                                            type="button"
                                            onClick={() => setSortArtistsAndUrl('name')}
                                            className="inline-flex items-center gap-1 hover:underline"
                                        >
                                            Name {headerArrow(sortByArtists === 'name')}
                                        </button>
                                    </Th>
                                    <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                                </>
                            ) : (
                                <>
                                    <Th className="select-none">
                                        <button
                                            type="button"
                                            onClick={() => setSortAlbumsAndUrl('title')}
                                            className="inline-flex items-center gap-1 hover:underline"
                                        >
                                            Album {headerArrow(sortByAlbums === 'title')}
                                        </button>
                                    </Th>
                                    <Th className="select-none">
                                        <button
                                            type="button"
                                            onClick={() => setSortAlbumsAndUrl('artist')}
                                            className="inline-flex items-center gap-1 hover:underline"
                                        >
                                            Artist {headerArrow(sortByAlbums === 'artist')}
                                        </button>
                                    </Th>
                                    <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                                </>
                            )}
                        </tr>
                        </thead>
                        <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <Td colSpan={target === 'artists' ? 3 : 4}>
                                    <div
                                        className="p-4 text-center text-gray-500">{loading ? 'Loading…' : 'No data'}</div>
                                </Td>
                            </tr>
                        ) : target === 'artists' ? (
                            (rows as YArtistRow[]).map((r, i) => (
                                <tr key={`${r.yandexArtistId}-${i}`}>
                                    <Td>{i + 1 + (page - 1) * pageSize}</Td>
                                    <Td>{r.name || '—'}</Td>
                                    <Td className="text-center">
                                        <LinksFixedRow
                                            yandexUrl={r.yandexUrl}
                                            mbUrl={(r.mbid ? r.mbUrl : undefined) || undefined}
                                        />
                                    </Td>
                                </tr>
                            ))
                        ) : (
                            (rows as YAlbumRow[]).map((r, i) => (
                                <tr key={`${r.yandexAlbumId}-${i}`}>
                                    <Td>{i + 1 + (page - 1) * pageSize}</Td>
                                    <Td>{r.title || '—'}</Td>
                                    <Td>{r.artistName || '—'}</Td>
                                    <Td className="text-center">
                                        <LinksFixedRow
                                            yandexUrl={r.yandexUrl}
                                            mbUrl={(r.rgMbid ? r.rgUrl : undefined) || undefined}
                                        />
                                    </Td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </Table>
                </div>
            </main>
            <Footer />
        </>
    );
}
