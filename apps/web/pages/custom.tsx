import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { Table, Th, Td } from '../components/Table';
import { customArtists } from '../lib/api';

type SortDir = 'asc' | 'desc';

export default function CustomArtistsPage() {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<Awaited<ReturnType<typeof customArtists.list>>['items']>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [q, setQ] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'matched' | 'created'>('name');
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

    const setSort = (field: 'name' | 'matched' | 'created') => {
        if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        else { setSortBy(field); setSortDir('asc'); }
    };

    return (
        <div className="min-h-screen">
            <Nav />
            <div className="max-w-7xl mx-auto p-4 space-y-6">
                <h1 className="text-2xl font-semibold">Custom Artists</h1>

                {/* Ввод списка */}
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <textarea
              className="w-full h-28 border rounded-lg p-3"
              placeholder="Вставьте имена артистов (по одному в строке, либо через запятую/точку с запятой)"
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
          />
                    <div className="flex md:flex-col gap-2">
                        <button
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                            onClick={onAdd}
                            disabled={adding}
                            title="Добавить в базу"
                        >
                            {adding ? 'Добавляю…' : 'Добавить'}
                        </button>
                        <button
                            className="px-4 py-2 rounded-lg bg-purple-600 text-white disabled:opacity-50"
                            onClick={onMatchAll}
                            disabled={matching}
                            title="Сопоставить всех с MusicBrainz"
                        >
                            {matching ? 'Матчу…' : 'Match all (MB)'}
                        </button>
                    </div>
                </div>

                {/* Фильтры/поиск */}
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Поиск…"
                        value={q}
                        onChange={e => { setQ(e.target.value); setPage(1); }}
                    />
                    <select
                        className="border rounded-lg px-3 py-2"
                        value={pageSize}
                        onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
                    >
                        {[25, 50, 100].map(s => <option key={s} value={s}>{s}/page</option>)}
                    </select>

                    <div className="ml-auto text-sm opacity-70">{loading ? 'Loading…' : `${total} total`}</div>
                </div>

                {/* Таблица */}
                <div className="overflow-x-auto">
                    <Table>
                        <thead>
                        <tr>
                            <Th>
                                <button
                                    type="button"
                                    onClick={() => setSort('name')}
                                    className="flex items-center gap-1"
                                    aria-label="Sort by name"
                                >
                                    Name
                                    <span className="opacity-60 text-xs">
                                  {sortBy === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                                </span>
                                </button>
                            </Th>
                            <Th>
                                <button
                                    type="button"
                                    onClick={() => setSort('matched')}
                                    className="flex items-center gap-1"
                                    aria-label="Sort by matched"
                                >
                                    Matched
                                    <span className="opacity-60 text-xs">
                                  {sortBy === 'matched' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                                </span>
                                </button>
                            </Th>
                            <Th>
                                <button
                                    type="button"
                                    onClick={() => setSort('created')}
                                    className="flex items-center gap-1"
                                    aria-label="Sort by created"
                                >
                                    Created
                                    <span className="opacity-60 text-xs">
                                  {sortBy === 'created' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                                </span>
                                </button>
                            </Th>
                            <Th>MusicBrainz</Th>
                            <Th className="text-right">Actions</Th>
                        </tr>
                        </thead>
                        <tbody>
                        {items.map(a => (
                            <tr key={a.id}>
                                <Td>{a.name}</Td>
                                <Td>{a.mbid ? 'Yes' : 'No'}</Td>
                                <Td>{a.createdAt ? new Date(a.createdAt).toLocaleString() : '-'}</Td>
                                <Td>
                                    {a.mbid ? (
                                        <a className="text-blue-600 underline" href={`https://musicbrainz.org/artist/${a.mbid}`} target="_blank" rel="noreferrer">
                                            {a.mbid}
                                        </a>
                                    ) : '—'}
                                </Td>
                                <Td className="text-right">
                                    <div className="inline-flex gap-2">
                                        {!a.mbid && (
                                            <button className="px-3 py-1 rounded bg-purple-600 text-white" onClick={() => onMatchOne(a.id)}>
                                                Match (MB)
                                            </button>
                                        )}
                                        <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={() => onDelete(a.id)}>
                                            Delete
                                        </button>
                                    </div>
                                </Td>
                            </tr>
                        ))}
                        {!items.length && !loading && (
                            <tr><Td colSpan={5} className="text-center opacity-70">Пусто</Td></tr>
                        )}
                        </tbody>
                    </Table>
                </div>

                {/* Пагинация */}
                <div className="flex items-center gap-2">
                    <button className="px-3 py-1 border rounded" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
                    <span className="text-sm">Page {page} / {pages}</span>
                    <button className="px-3 py-1 border rounded" disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>Next</button>
                </div>
            </div>
        </div>
    );
}
