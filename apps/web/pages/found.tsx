import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';

type FoundRow = any;

function mbLink(mbid: string, kind?: 'artist' | 'album' | 'rg') {
    if (!mbid) return '#';
    const isRG = kind === 'album' || kind === 'rg';
    return `https://musicbrainz.org/${isRG ? 'release-group' : 'artist'}/${mbid}`;
}

function ymLink(row: any) {
    if (row?.yandexArtistId) return `https://music.yandex.ru/artist/${row.yandexArtistId}`;
    if (row?.yandexAlbumId)  return `https://music.yandex.ru/album/${row?.yandexAlbumId}`;

    const artist = row?.artist || row?.Artist || '';
    const album  = row?.album  || row?.title  || row?.Album || '';
    const name   = row?.name || '';

    // для альбомов ищем по "artist album/title", для артистов — по name/artist
    const q = isAlbumRow(row)
        ? (artist && album ? `${artist} ${album}` : artist || album || name)
        : (name || artist);

    return q ? `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` : 'https://music.yandex.ru/';
}

function displayTitle(r: any): string {
    // если это альбом — всегда показываем "Артист — Альбом/Title"
    if (isAlbumRow(r)) {
        const artist = r?.artist || r?.Artist || r?.name || '';
        const album  = r?.album  || r?.title  || r?.Album || '';
        const joined = [artist, album].filter(Boolean).join(' — ');
        return joined || artist || album || '';
    }

    // иначе (артист) — прежняя логика
    return (
        r?.name ||
        r?.artist ||
        r?.Artist ||
        r?.title ||
        r?.Album ||
        ''
    ) as string;
}

// эвристика определения типа строки
function isAlbumRow(r: any) {
    return !!(
        r?.ReleaseGroupMBID || r?.rgMbid ||
        (r?.artist && (r?.album || r?.title)) ||
        r?.kind === 'album' || r?.kind === 'rg'
    );
}
function isArtistRow(r: any) {
    return !isAlbumRow(r);
}

export default function FoundPage() {
    const [rows, setRows] = useState<FoundRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [, setMsg] = useState<string>('');

    // filter (tab)
    const [target, setTarget] = useState<'artists' | 'albums'>('artists');

    // pagination
    const [page, setPage] = useState(1);
    // 0 = All
    const [pageSize, setPageSize] = useState<number>(50);

    // sorting
    const [nameDir, setNameDir] = useState<'asc' | 'desc'>('asc');

    const fetchFound = useCallback(async (t: 'artists' | 'albums') => {
        // пробуем сначала целевой эндпоинт с target
        try {
            return await api<any>(`/api/found?target=${t}&limit=100000`);
        } catch {
            // фолбэк — без target
            try {
                return await api<any>(`/api/found?limit=100000`);
            } catch {
                // последний фолбэк — базовый
                return await api<any>(`/api/found`);
            }
        }
    }, []);

    const load = useCallback(async (t: 'artists' | 'albums' = target) => {
        setLoading(true);
        try {
            const r = await fetchFound(t);
            const items: any[] =
                Array.isArray(r) ? r :
                    Array.isArray(r?.items) ? r.items :
                        Array.isArray(r?.rows)  ? r.rows  : [];
            setRows(items);
            setMsg('');
            setPage(1);
        } catch (e: any) {
            setMsg(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, [fetchFound, target]);

    useEffect(() => { load(target); }, [load, target]);

    // применяем фильтр по выбранной вкладке (если бэкенд вернул всё вперемешку)
    const filteredRows = useMemo(() => {
        if (target === 'artists') return rows.filter(isArtistRow);
        return rows.filter(isAlbumRow);
    }, [rows, target]);

    // сортировка (локализованная, учитывает кириллицу)
    const sortedRows = useMemo(() => {
        const mult = nameDir === 'asc' ? 1 : -1;
        return filteredRows.slice().sort((a, b) => {
            const A = (displayTitle(a) || '').toString();
            const B = (displayTitle(b) || '').toString();
            const cmp = A.localeCompare(B, ['ru', 'en'], { sensitivity: 'base', numeric: true });
            if (cmp !== 0) return cmp * mult;

            // стабильность по MBID
            const amid = (a?.mbid || a?.MusicBrainzId || a?.ReleaseGroupMBID || '').toString();
            const bmid = (b?.mbid || b?.MusicBrainzId || b?.ReleaseGroupMBID || '').toString();
            return amid.localeCompare(bmid) * mult;
        });
    }, [filteredRows, nameDir]);

    // пагинация
    const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sortedRows.length / pageSize));
    useEffect(() => {
        setPage((p) => Math.min(Math.max(1, p), pageCount));
    }, [pageSize, sortedRows.length, pageCount]);

    const sliceStart = pageSize === 0 ? 0 : (page - 1) * pageSize;
    const sliceEnd   = pageSize === 0 ? sortedRows.length : sliceStart + pageSize;
    const pageRows   = useMemo(() => sortedRows.slice(sliceStart, sliceEnd), [sortedRows, sliceStart, sliceEnd]);

    const rangeFrom = sortedRows.length ? sliceStart + 1 : 0;
    const rangeTo   = Math.min(sliceEnd, sortedRows.length);
    const nameArrow = nameDir === 'asc' ? '▲' : '▼';

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-4">
                <h1 className="h1">Found</h1>

                <div className="toolbar">
                    <div className="inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
                        <button
                            className={`btn ${target === 'artists' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setTarget('artists')}
                        >
                            Artists
                        </button>
                        <button
                            className={`btn ${target === 'albums' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setTarget('albums')}
                        >
                            Albums
                        </button>
                    </div>

                    <button className="btn btn-outline" onClick={() => load(target)} disabled={loading}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-gray-500">Rows per page:</span>
                        <select
                            className="select"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                        >
                            {[25, 50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
                            <option value={0}>All</option>
                        </select>
                        <span className="text-xs text-gray-500">
              {sortedRows.length ? `Showing ${rangeFrom}–${rangeTo} of ${sortedRows.length}` : 'No data'}
            </span>
                        {pageSize !== 0 && (
                            <div className="flex items-center gap-1">
                                <button className="btn btn-outline" onClick={() => setPage(1)} disabled={page <= 1}>{'«'}</button>
                                <button className="btn btn-outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>{'‹'}</button>
                                <span className="text-xs text-gray-500 px-2">Page {page}/{pageCount}</span>
                                <button className="btn btn-outline" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>{'›'}</button>
                                <button className="btn btn-outline" onClick={() => setPage(pageCount)} disabled={page >= pageCount}>{'»'}</button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="panel overflow-x-auto">
                    <Table className="table-default">
                        <thead>
                        <tr>
                            <Th>#</Th>
                            <Th className="select-none">
                                <button
                                    type="button"
                                    onClick={() => setNameDir(d => (d === 'asc' ? 'desc' : 'asc'))}
                                    title="Sort by name"
                                    className="inline-flex items-center gap-1 hover:underline"
                                >
                                    Name <span className="text-xs text-gray-500">{nameArrow}</span>
                                </button>
                            </Th>
                            <Th>MBID</Th>
                            <Th>Links</Th>
                        </tr>
                        </thead>
                        <tbody>
                        {pageRows.length === 0 ? (
                            <tr>
                                <Td colSpan={4}>
                                    <div className="p-4 text-center text-gray-500">No data</div>
                                </Td>
                            </tr>
                        ) : (
                            pageRows.map((r: any, i: number) => {
                                const mbid = r?.mbid || r?.MusicBrainzId || r?.ReleaseGroupMBID || '';
                                const kind: 'artist' | 'album' | 'rg' = r?.ReleaseGroupMBID ? 'rg' : (r?.kind || 'artist');
                                const title = displayTitle(r) || '—';
                                const rowIndex = (pageSize === 0 ? 0 : sliceStart) + i + 1;

                                return (
                                    <tr key={`${mbid || title}-${rowIndex}`}>
                                        <Td>{rowIndex}</Td>
                                        <Td>{title}</Td>
                                        <Td>
                                            {mbid ? (
                                                <a
                                                    href={mbLink(mbid, kind)}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-primary underline"
                                                >
                                                    {mbid}
                                                </a>
                                            ) : <span className="text-gray-400">—</span>}
                                        </Td>
                                        <Td className="space-x-2">
                                            <a href={ymLink(r)} target="_blank" rel="noreferrer" className="link-chip link-chip--ym">Yandex</a>
                                            {mbid && (
                                                <a href={mbLink(mbid, kind)} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">
                                                    MusicBrainz
                                                </a>
                                            )}
                                        </Td>
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </Table>
                </div>
            </main>
        </>
    );
}
