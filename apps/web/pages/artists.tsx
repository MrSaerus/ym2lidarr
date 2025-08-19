import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';
import { useRouter } from 'next/router';

type ArtistRow = {
    id: number;
    name: string;
    mbid: string | null;
    monitored: boolean;
    path: string | null;
    added: string | null;
    albums: number | null;
    tracks: number | null;
    sizeOnDisk: number | null; // bytes
    lidarrUrl?: string;
};

type ApiResp = {
    page: number;
    pageSize: number;
    total: number;
    items: ArtistRow[];
};

type SortField = 'name'|'monitored'|'albums'|'tracks'|'size'|'path'|'added';

function mbArtistLink(mbid?: string | null) {
    return mbid ? `https://musicbrainz.org/artist/${mbid}` : '#';
}
function fmtBytes(n?: number | null) {
    if (n === null || n === undefined) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let x = n; let i = 0;
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(1)} ${units[i]}`;
}

// Фолбэк, если бек не прислал lidarrUrl
const LIDARR_BASE = process.env.NEXT_PUBLIC_LIDARR_BASE || '';

export default function ArtistsPage() {
    const router = useRouter();

    const [rows, setRows] = useState<ArtistRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string>('');

    // фильтры
    const [q, setQ] = useState('');
    const [monitored, setMonitored] = useState<'all' | 'true' | 'false'>('all');

    // пагинация
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(50);
    const [total, setTotal] = useState(0);

    // сортировка (целиком на бэке)
    const [sortBy, setSortBy] = useState<SortField>('name');
    const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

    // Инициализация из URL — один раз
    useEffect(() => {
        if (!router.isReady) return;
        const qp = router.query.page as string | undefined;
        const qs = router.query.pageSize as string | undefined;
        const qq = router.query.q as string | undefined;
        const qm = router.query.monitored as string | undefined;
        const qsb = router.query.sortBy as string | undefined;
        const qsd = router.query.sortDir as string | undefined;

        if (qp) setPage(Math.max(1, parseInt(qp, 10) || 1));
        if (qs) setPageSize(Math.max(1, parseInt(qs, 10) || 50));
        if (typeof qq === 'string') setQ(qq);
        if (qm === 'true' || qm === 'false' || qm === 'all') setMonitored(qm);
        if (qsb && ['name','monitored','albums','tracks','size','path','added'].includes(qsb)) {
            setSortBy(qsb as SortField);
        }
        if (qsd === 'asc' || qsd === 'desc') setSortDir(qsd);
    }, [router.isReady]);

    // Загрузка данных
    const load = useCallback(async (p = page) => {
        setLoading(true);
        setErrorMsg('');
        try {
            const params = new URLSearchParams({
                page: String(p),
                pageSize: String(pageSize),
                q,
                monitored,
                sortBy,
                sortDir,
            });
            const r = await api<ApiResp>(`/api/lidarr/artists?${params.toString()}`);
            setRows(r.items || []);
            setPage(p);      // фиксируем именно запрошенную страницу
            setTotal(r.total || 0);
        } catch (e: any) {
            setErrorMsg(e?.message || String(e));
            setRows([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, q, monitored, sortBy, sortDir]);

    // Триггер загрузки при изменении параметров
    useEffect(() => {
        if (!router.isReady) return;
        load(page);
    }, [router.isReady, page, q, monitored, pageSize, sortBy, sortDir, load]);

    // ——— helpers для обновления URL ТОЛЬКО при действиях пользователя ———
    function updateUrl(params: Record<string, string>) {
        if (!router.isReady) return;
        router.replace({ pathname: router.pathname, query: { ...router.query, ...params } }, undefined, { shallow: true });
    }
    function setPageAndUrl(p: number) {
        setPage(p);
        updateUrl({ page: String(p), pageSize: String(pageSize), q, monitored, sortBy, sortDir });
    }
    function setPageSizeAndUrl(ps: number) {
        setPageSize(ps);
        setPage(1);
        updateUrl({ page: '1', pageSize: String(ps), q, monitored, sortBy, sortDir });
    }
    function setFilterQAndUrl(newQ: string) {
        setQ(newQ);
        setPage(1);
        updateUrl({ page: '1', pageSize: String(pageSize), q: newQ, monitored, sortBy, sortDir });
    }
    function setFilterMonAndUrl(newMon: 'all'|'true'|'false') {
        setMonitored(newMon);
        setPage(1);
        updateUrl({ page: '1', pageSize: String(pageSize), q, monitored: newMon, sortBy, sortDir });
    }
    function setSortAndUrl(field: SortField) {
        const dir = (sortBy === field) ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
        setSortBy(field);
        setSortDir(dir);
        setPage(1);
        updateUrl({ page: '1', pageSize: String(pageSize), q, monitored, sortBy: field, sortDir: dir });
    }

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const headerArrow = (f: SortField) =>
        sortBy === f ? <span className="text-xs text-gray-500">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

    async function refreshArtist(id: number) {
        try {
            await api(`/api/lidarr/artist/${id}/refresh`, { method: 'POST' });
        } catch (e: any) {
            alert('Refresh failed: ' + (e?.message || String(e)));
        }
    }

    // Безопасный конструктор «Open in Lidarr»
    function linkToLidarr(row: ArtistRow) {
        if (row.lidarrUrl) return row.lidarrUrl;
        if (LIDARR_BASE && row.mbid) return `${LIDARR_BASE.replace(/\/+$/,'')}/artist/${row.mbid}`;
        return '#';
    }

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-4">
                <h1 className="h1">Artists</h1>

                <div className="toolbar">
                    <input
                        placeholder="Search by name or MBID…"
                        className="input w-80"
                        value={q}
                        onChange={(e) => setFilterQAndUrl(e.target.value)}
                    />
                    <select
                        className="select"
                        value={monitored}
                        onChange={(e) => setFilterMonAndUrl(e.target.value as any)}
                    >
                        <option value="all">All</option>
                        <option value="true">Monitored</option>
                        <option value="false">Unmonitored</option>
                    </select>
                    <button className="btn btn-outline" onClick={() => load(page)} disabled={loading}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-gray-500">Rows per page:</span>
                        <select
                            className="select"
                            value={pageSize}
                            onChange={(e) => setPageSizeAndUrl(Number(e.target.value))}
                        >
                            {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="text-xs text-gray-500">
              {total ? `Page ${page} of ${pageCount} — total ${total}` : 'No data'}
            </span>
                        <div className="flex items-center gap-1">
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(1)} disabled={page <= 1}>{'«'}</button>
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(Math.max(1, page - 1))} disabled={page <= 1}>{'‹'}</button>
                            <span className="text-xs text-gray-500 px-2">Page {page}/{pageCount}</span>
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>{'›'}</button>
                            <button className="btn btn-outline" onClick={() => setPageAndUrl(pageCount)} disabled={page >= pageCount}>{'»'}</button>
                        </div>
                    </div>
                </div>

                {errorMsg && <div className="panel p-3 text-red-500 text-sm">{errorMsg}</div>}

                <div className="panel overflow-x-auto">
                    <Table className="table-default">
                        <thead>
                        <tr>
                            <Th>#</Th>
                            <Th className="select-none">
                                <button
                                    type="button"
                                    onClick={() => setSortAndUrl('name')}
                                    className="inline-flex items-center gap-1 hover:underline"
                                >
                                    Name {headerArrow('name')}
                                </button>
                            </Th>
                            <Th>MBID</Th>
                            <Th className="select-none">
                                <button type="button" onClick={() => setSortAndUrl('monitored')} className="inline-flex items-center gap-1 hover:underline">
                                    Monitored {headerArrow('monitored')}
                                </button>
                            </Th>
                            <Th className="text-right select-none">
                                <button type="button" onClick={() => setSortAndUrl('albums')} className="inline-flex items-center gap-1 hover:underline">
                                    Albums {headerArrow('albums')}
                                </button>
                            </Th>
                            <Th className="text-right select-none">
                                <button type="button" onClick={() => setSortAndUrl('tracks')} className="inline-flex items-center gap-1 hover:underline">
                                    Tracks {headerArrow('tracks')}
                                </button>
                            </Th>
                            <Th className="text-right select-none">
                                <button type="button" onClick={() => setSortAndUrl('size')} className="inline-flex items-center gap-1 hover:underline">
                                    Size {headerArrow('size')}
                                </button>
                            </Th>
                            <Th className="select-none">
                                <button type="button" onClick={() => setSortAndUrl('path')} className="inline-flex items-center gap-1 hover:underline">
                                    Path {headerArrow('path')}
                                </button>
                            </Th>
                            <Th className="select-none">
                                <button type="button" onClick={() => setSortAndUrl('added')} className="inline-flex items-center gap-1 hover:underline">
                                    Added {headerArrow('added')}
                                </button>
                            </Th>
                            <Th>Actions</Th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <Td colSpan={10}>
                                    <div className="p-4 text-center text-gray-500">
                                        {loading ? 'Loading…' : 'No data'}
                                    </div>
                                </Td>
                            </tr>
                        ) : (
                            rows.map((r, i) => (
                                <tr key={r.id} className="align-top">
                                    <Td>{(i + 1) + (page - 1) * pageSize}</Td>
                                    <Td>{r.name || '—'}</Td>
                                    <Td>
                                        {r.mbid ? (
                                            <a href={mbArtistLink(r.mbid)} target="_blank" rel="noreferrer" className="text-primary underline">
                                                {r.mbid}
                                            </a>
                                        ) : <span className="text-gray-400">—</span>}
                                    </Td>
                                    <Td>{r.monitored ? 'Yes' : 'No'}</Td>
                                    <Td className="text-right">{r.albums ?? '—'}</Td>
                                    <Td className="text-right">{r.tracks ?? '—'}</Td>
                                    <Td className="text-right">{fmtBytes(r.sizeOnDisk)}</Td>
                                    <Td className="max-w-[22rem]">
                                        <span className="block truncate" title={r.path || ''}>{r.path || '—'}</span>
                                    </Td>
                                    <Td>{r.added ? new Date(r.added).toLocaleString() : '—'}</Td>
                                    <Td className="space-x-2">
                                        <a href={linkToLidarr(r)} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">
                                            Open in Lidarr
                                        </a>
                                        <button className="link-chip" onClick={() => refreshArtist(r.id)}>
                                            Refresh
                                        </button>
                                    </Td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </Table>
                </div>
            </main>
        </>
    );
}
