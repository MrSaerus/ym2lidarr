// apps/web/pages/custom.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { Table, Th, Td } from '../components/Table';
import { customArtists } from '../lib/api';
import Footer from '../components/Footer';

type SortDir = 'asc' | 'desc';
type SortField = 'name' | 'matched' | 'created';
type Item = Awaited<ReturnType<typeof customArtists.list>>['items'][number];

/* ==== Fixed link slots (Lidarr | MusicBrainz) ==== */
const LINKS_COL_WIDTH = 'w-[14rem]';

function LinkSlot({
                      href,
                      label,
                      className,
                  }: {
    href?: string | null;
    label: 'Lidarr' | 'MusicBrainz';
    className?: string;
}) {
    if (!href) {
        return (
            <span className={`link-chip ${className ?? ''} invisible select-none`} aria-hidden="true">
        {label}
      </span>
        );
    }
    return (
        <a href={href} target="_blank" rel="noreferrer" className={`link-chip ${className ?? ''}`}>
            {label}
        </a>
    );
}

function LinksFixedRow({
                           name,
                           mbUrl,
                           hasLidarr,
                           lidarrUrl,
                       }: {
    name: string;
    mbUrl?: string | null;
    hasLidarr?: boolean;
    lidarrUrl?: string | null;
}) {
    // если прямой URL из API отсутствует — ведём на внутреннюю страницу с поиском
    const hrefLidarr = hasLidarr ? (lidarrUrl || `/lidarr?q=${encodeURIComponent(name)}`) : undefined;

    return (
        <div className={`grid grid-cols-2 gap-2 justify-items-center ${LINKS_COL_WIDTH}`}>
            <LinkSlot href={hrefLidarr} label="Lidarr" className="link-chip--lidarr" />
            <LinkSlot href={mbUrl || undefined} label="MusicBrainz" className="link-chip--mb" />
        </div>
    );
}
/* ================================================ */

export default function CustomArtistsPage() {
    const [loading, setLoading] = useState(false);
    const [items, setItems] =
        useState<Awaited<ReturnType<typeof customArtists.list>>['items']>([]);
    const [total, setTotal] = useState(0);

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [q, setQ] = useState('');
    const [sortBy, setSortBy] = useState<SortField>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const [bulkText, setBulkText] = useState('');
    const [adding, setAdding] = useState(false);
    const [matching, setMatching] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await customArtists.list({ page, pageSize, q, sortBy, sortDir });
            setItems(resp.items);
            setTotal(resp.total);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, q, sortBy, sortDir]);

    useEffect(() => { load(); }, [load]);

    const onAdd = useCallback(async () => {
        const lines = (bulkText || '')
            .split(/[\r\n,;]+/g)
            .map(s => s.trim())
            .filter(Boolean);
        const uniq = Array.from(new Set(lines));
        if (!uniq.length) return;

        setAdding(true);
        try {
            await customArtists.addMany(uniq);
            setBulkText('');
            await load();
        } finally {
            setAdding(false);
        }
    }, [bulkText, load]);

    const onMatchAll = useCallback(async () => {
        setMatching(true);
        try {
            await customArtists.matchAll();
            await load();
        } finally {
            setMatching(false);
        }
    }, [load]);

    const onMatchOne = useCallback(async (id: number) => {
        await customArtists.matchOne(id);
        await load();
    }, [load]);

    const onDelete = useCallback(async (id: number) => {
        await customArtists.remove(id);
        await load();
    }, [load]);

    const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

    const setSort = (field: SortField) => {
        if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        else { setSortBy(field); setSortDir('asc'); }
        setPage(1);
    };

    const headerArrow = (active: boolean) =>
        active ? <span className="text-xs text-gray-500">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

    const pageCount = pages;

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-4">
                <h1 className="h1">Custom Artists</h1>

                {/* Toolbar */}
                <div className="toolbar">
                    <div className="flex items-center gap-2">
                        <input
                            className="input w-80"
                            placeholder="Search by name…"
                            value={q}
                            onChange={(e) => { setQ(e.target.value); setPage(1); }}
                        />
                        <button className="btn btn-outline" onClick={load} disabled={loading}>
                            {loading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    </div>
                </div>
                <div className="toolbar">
                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-gray-500 text-nowrap">Rows per page:</span>
                        <select
                            className="bg-slate-900 text-slate-100 text-sm border border-slate-700 rounded px-2 py-1"
                            value={pageSize}
                            onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
                        >
                            {[25, 50, 100, 200].map((n) => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>

                        <span className="text-xs text-gray-500 text-nowrap">
              {total ? `Page ${page} of ${pageCount} — total ${total}` : 'No data'}
            </span>
                        <div className="flex items-center gap-1">
                            <button className="btn btn-outline" onClick={() => setPage(1)} disabled={page <= 1}>{'«'}</button>
                            <button className="btn btn-outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>{'‹'}</button>
                            <span className="text-xs text-gray-500 px-2">Page {page}/{pageCount}</span>
                            <button className="btn btn-outline" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>{'›'}</button>
                            <button className="btn btn-outline" onClick={() => setPage(pageCount)} disabled={page >= pageCount}>{'»'}</button>
                        </div>
                    </div>
                </div>

                {/* Bulk add panel */}
                <div className="panel p-3">
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <textarea
                className="input h-28"
                placeholder="Вставьте имена артистов (по одному в строке, либо через запятую/точку с запятой)"
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
            />
                        <div className="flex md:flex-col gap-2">
                            <button
                                className="btn btn-primary"
                                onClick={onAdd}
                                disabled={adding}
                                title="Добавить в базу"
                            >
                                {adding ? 'Добавляю…' : 'Добавить'}
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={onMatchAll}
                                disabled={matching}
                                title="Сопоставить всех с MusicBrainz"
                            >
                                {matching ? 'Матчу…' : 'Match all (MB)'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="panel overflow-x-auto">
                    <Table className="table-default">
                        <thead>
                        <tr>
                            <Th className="select-none">
                                <button
                                    type="button"
                                    onClick={() => setSort('name')}
                                    className="inline-flex items-center gap-1 hover:underline"
                                >
                                    Name {headerArrow(sortBy === 'name')}
                                </button>
                            </Th>
                            <Th className="select-none">
                                <button
                                    type="button"
                                    onClick={() => setSort('matched')}
                                    className="inline-flex items-center gap-1 hover:underline"
                                >
                                    Matched {headerArrow(sortBy === 'matched')}
                                </button>
                            </Th>
                            <Th className="select-none">
                                <button
                                    type="button"
                                    onClick={() => setSort('created')}
                                    className="inline-flex items-center gap-1 hover:underline"
                                >
                                    Created {headerArrow(sortBy === 'created')}
                                </button>
                            </Th>
                            <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                            <Th className="text-right">Actions</Th>
                        </tr>
                        </thead>
                        <tbody>
                        {(!items || items.length === 0) ? (
                            <tr>
                                <Td colSpan={5}>
                                    <div className="p-4 text-center text-gray-500">{loading ? 'Loading…' : 'No data'}</div>
                                </Td>
                            </tr>
                        ) : items.map((a: Item & { hasLidarr?: boolean; lidarrUrl?: string | null }) => (
                            <tr key={a.id}>
                                <Td>{a.name}</Td>
                                <Td>{a.mbid ? 'Yes' : 'No'}</Td>
                                <Td>{a.createdAt ? new Date(a.createdAt).toLocaleString() : '-'}</Td>
                                <Td className="text-center">
                                    <LinksFixedRow
                                        name={a.name}
                                        mbUrl={a.mbid ? `https://musicbrainz.org/artist/${a.mbid}` : undefined}
                                        hasLidarr={a.hasLidarr}
                                        lidarrUrl={a.lidarrUrl}
                                    />
                                </Td>
                                <Td className="text-right">
                                    <div className="inline-flex gap-2">
                                        {!a.mbid && (
                                            <button className="btn btn-outline" onClick={() => onMatchOne(a.id)}>
                                                Match (MB)
                                            </button>
                                        )}
                                        <button className="btn btn-outline danger" onClick={() => onDelete(a.id)}>
                                            Delete
                                        </button>
                                    </div>
                                </Td>
                            </tr>
                        ))}
                        </tbody>
                    </Table>
                </div>
            </main>
            <Footer />
        </>
    );
}
