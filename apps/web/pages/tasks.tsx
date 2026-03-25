// apps/web/pages/tasks.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';

type TorrentTaskRow = {
  id: number;
  scope: string;
  status: string;

  artistName?: string | null;
  albumTitle?: string | null;
  albumYear?: number | null;

  query?: string | null;
  ymArtistId?: string | null;
  ymAlbumId?: string | null;
  ymTrackId?: string | null;

  source?: string | null;

  minSeeders?: number | null;
  limitReleases?: number | null;
  indexerId?: number | null;

  finalPath?: string | null;
  scheduledAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;

  qbitHash?: string | null;
  lastError?: string | null;
};

type TorrentTasksResponse = {
  items: TorrentTaskRow[];
  total: number;
  page: number;
  pageSize: number;
};

const STATUS_OPTIONS: string[] = [
  'any',
  'queued',
  'searching',
  'found',
  'added',
  'downloading',
  'downloaded',
  'moving',
  'moved',
  'failed',
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function humanStatusLabel(s: string): string {
  if (s === 'any') return 'All';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusChipClass(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-slate-800 text-slate-100';
    case 'searching':
      return 'bg-blue-900 text-blue-100';
    case 'found':
      return 'bg-emerald-900 text-emerald-100';
    case 'added':
      return 'bg-sky-900 text-sky-100';
    case 'downloading':
      return 'bg-indigo-900 text-indigo-100';
    case 'downloaded':
      return 'bg-green-900 text-green-100';
    case 'moving':
    case 'moved':
      return 'bg-purple-900 text-purple-100';
    case 'failed':
      return 'bg-red-900 text-red-100';
    default:
      return 'bg-slate-800 text-slate-100';
  }
}

function formatDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

export default function TorrentsPage() {
  const router = useRouter();

  const [rows, setRows] = useState<TorrentTaskRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [status, setStatus] = useState<string>('any');
  const [q, setQ] = useState<string>('');

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // читаем начальные параметры из URL
  useEffect(() => {
    if (!router.isReady) return;

    const qsStatus = String(router.query.status ?? 'any');
    if (STATUS_OPTIONS.includes(qsStatus)) {
      setStatus(qsStatus);
    }

    const qq = router.query.q as string | undefined;
    if (typeof qq === 'string') setQ(qq);

    const qp = router.query.page as string | undefined;
    if (qp) {
      const n = parseInt(qp, 10);
      if (Number.isFinite(n) && n > 0) setPage(n);
    }

    const qsPageSize = router.query.pageSize as string | undefined;
    if (qsPageSize) {
      const n = parseInt(qsPageSize, 10);
      if (Number.isFinite(n) && n > 0) setPageSize(n);
    }

    const qsSortField = router.query.sortField as string | undefined;
    if (typeof qsSortField === 'string') {
      setSortField(qsSortField);
    }

    const qsSortDir = router.query.sortDir as string | undefined;
    if (qsSortDir === 'asc' || qsSortDir === 'desc') {
      setSortDir(qsSortDir);
    }
  }, [
    router.isReady,
    router.query.status,
    router.query.q,
    router.query.page,
    router.query.pageSize,
    router.query.sortField,
    router.query.sortDir,
  ]);

  function updateUrl(params: Record<string, string>) {
    if (!router.isReady) return;
    router.replace(
      {
        pathname: router.pathname,
        query: { ...router.query, ...params },
      },
      undefined,
      { shallow: true },
    );
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const params = new URLSearchParams();
      params.set('status', status || 'any');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortField', sortField);
      params.set('sortDir', sortDir);
      if (q.trim()) {
        params.set('q', q.trim());
      }

      const data = await api<TorrentTasksResponse>(
        `/api/torrents/tasks?${params.toString()}`,
      );

      if (data && Array.isArray(data.items)) {
        setRows(data.items);
        setTotal(data.total ?? data.items.length);
      } else if (Array.isArray((data as any))) {
        const arr = data as any as TorrentTaskRow[];
        setRows(arr);
        setTotal(arr.length);
      } else {
        setRows([]);
        setTotal(0);
      }
    } catch (e: any) {
      setRows([]);
      setTotal(0);
      setErrorMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [status, q, page, pageSize, sortField, sortDir]);

  // загрузка при изменении фильтров / страницы / сортировки
  useEffect(() => {
    if (!router.isReady) return;
    load();
  }, [router.isReady, load]);

  function setStatusAndUrl(next: string) {
    setStatus(next);
    setPage(1);
    updateUrl({
      status: next,
      q,
      page: '1',
      pageSize: String(pageSize),
      sortField,
      sortDir,
    });
  }

  function setQAndUrl(next: string) {
    setQ(next);
    setPage(1);
    updateUrl({
      status,
      q: next,
      page: '1',
      pageSize: String(pageSize),
      sortField,
      sortDir,
    });
  }

  function setPageAndUrl(p: number) {
    setPage(p);
    updateUrl({
      status,
      q,
      page: String(p),
      pageSize: String(pageSize),
      sortField,
      sortDir,
    });
  }

  function setPageSizeAndUrl(ps: number) {
    setPageSize(ps);
    setPage(1);
    updateUrl({
      status,
      q,
      page: '1',
      pageSize: String(ps),
      sortField,
      sortDir,
    });
  }

  function applySort(field: string) {
    if (sortField === field) {
      const nextDir: 'asc' | 'desc' = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(nextDir);
      setPage(1);
      updateUrl({
        status,
        q,
        page: '1',
        pageSize: String(pageSize),
        sortField: field,
        sortDir: nextDir,
      });
    } else {
      setSortField(field);
      setSortDir('asc');
      setPage(1);
      updateUrl({
        status,
        q,
        page: '1',
        pageSize: String(pageSize),
        sortField: field,
        sortDir: 'asc',
      });
    }
  }

  function renderSortIcon(field: string) {
    if (sortField !== field) return null;
    return (
      <span className="text-[10px] text-gray-400">
        {sortDir === 'asc' ? '▲' : '▼'}
      </span>
    );
  }

  const pageCount = useMemo(() => {
    if (!total) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  return (
    <>
      <Nav />

      <main className="mx-auto max-w-6xl px-4 py-4">
        <h1 className="h1">Torrent tasks</h1>

        {/* Фильтры по статусу */}
        <div className="toolbar">
          <div className="inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                className={`btn ${
                  status === s ? 'btn-primary' : 'btn-outline'
                } text-xs`}
                onClick={() => setStatusAndUrl(s)}
              >
                {humanStatusLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {/* Поиск + Refresh + пагинация */}
        <div className="toolbar">
          <input
            placeholder="Search by artist, album, query, hash…"
            className="input w-96"
            value={q}
            onChange={(e) => setQAndUrl(e.target.value)}
          />

          <button
            className="btn btn-outline"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500 text-nowrap">
              Rows per page:
            </span>
            <select
              className="bg-slate-900 text-slate-100 text-sm border border-slate-700 rounded px-2 py-1"
              value={pageSize}
              onChange={(e) => setPageSizeAndUrl(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(1)}
                disabled={page <= 1}
              >
                {'«'}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                {'‹'}
              </button>
              <span className="text-xs text-gray-500 px-2">
                Page {page}/{pageCount}{' '}
                {total ? `(${total} total)` : ''}
              </span>
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(Math.min(pageCount, page + 1))}
                disabled={page >= pageCount}
              >
                {'›'}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(pageCount)}
                disabled={page >= pageCount}
              >
                {'»'}
              </button>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="panel p-3 text-red-500 text-sm">{errorMsg}</div>
        )}

        <div className="panel overflow-x-auto">
          <Table className="table-default">
            <thead>
            <tr>
              <Th className="w-16">
                <button
                  type="button"
                  className="flex items-center gap-1 w-full text-left cursor-pointer select-none"
                  onClick={() => applySort('id')}
                >
                  <span>ID</span>
                  {renderSortIcon('id')}
                </button>
              </Th>

              <Th className="w-32">
                <button
                  type="button"
                  className="flex items-center gap-1 w-full text-left cursor-pointer select-none"
                  onClick={() => applySort('scope')}
                >
                  <span>Scope / Source</span>
                  {renderSortIcon('scope')}
                </button>
              </Th>

              <Th className="w-48">
                <button
                  type="button"
                  className="flex items-center gap-1 w-full text-left cursor-pointer select-none"
                  onClick={() => applySort('artistName')}
                >
                  <span>Artist</span>
                  {renderSortIcon('artistName')}
                </button>
              </Th>

              <Th className="w-64">
                <button
                  type="button"
                  className="flex items-center gap-1 w-full text-left cursor-pointer select-none"
                  onClick={() => applySort('albumTitle')}
                >
                  <span>Album</span>
                  {renderSortIcon('albumTitle')}
                </button>
              </Th>

              <Th className="w-40">
                <button
                  type="button"
                  className="flex items-center gap-1 w-full text-left cursor-pointer select-none"
                  onClick={() => applySort('status')}
                >
                  <span>Status</span>
                  {renderSortIcon('status')}
                </button>
              </Th>

            </tr>
            </thead>
            <tbody>
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={7}>
                  <div className="p-4 text-center text-gray-500">
                    {loading ? 'Loading…' : 'No tasks'}
                  </div>
                </Td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id}>
                  <Td className="align-top">
                    <div className="font-mono text-sm">{t.id}</div>
                    {t.createdAt && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        {formatDateTime(t.createdAt)}
                      </div>
                    )}
                  </Td>

                  <Td className="align-top">
                    <div className="uppercase text-xs font-semibold">
                      {t.scope || '—'}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {t.source || 'manual'}
                    </div>
                  </Td>

                  <Td className="align-top">
                    <div>{t.artistName || '—'}</div>
                  </Td>

                  <Td className="align-top">
                    {t.albumTitle ? (
                      <div className="text-[13px]">
                        {t.albumTitle}
                        {t.albumYear ? ` (${t.albumYear})` : ''}
                      </div>
                    ) : (
                      '—'
                    )}
                  </Td>

                  <Td className="align-top">
                    <div
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusChipClass(
                        t.status,
                      )}`}
                    >
                      {t.status}
                    </div>
                    {t.scheduledAt && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        next: {formatDateTime(t.scheduledAt)}
                      </div>
                    )}
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
