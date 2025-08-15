// apps/web/pages/unmatched.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';

type UnmatchedRow = {
  id?: number | string;
  // artists
  name?: string;
  // albums
  artist?: string;
  album?: string;
  title?: string;
  year?: number | string | null;

  // optional
  search?: string;
  candidates?: any[];
};

function isAlbumRow(r: UnmatchedRow) {
  return !!(r?.artist && (r?.album || r?.title));
}
function isArtistRow(r: UnmatchedRow) {
  return !isAlbumRow(r);
}

// «Артист — Альбом/Title» для альбомов; для артистов — имя
function displayTitle(r: UnmatchedRow): string {
  if (isAlbumRow(r)) {
    const artist = r.artist || '';
    const album  = r.album || r.title || '';
    const joined = [artist, album].filter(Boolean).join(' — ');
    return joined || artist || album || '';
  }
  return (r.name || r.artist || '') as string;
}

function mbSearchUrl(row: UnmatchedRow) {
  if (row.search) return row.search;
  const isAlbum = isAlbumRow(row);
  const q = isAlbum
      ? `${row.artist ?? ''} ${row.album ?? row.title ?? ''}`.trim()
      : (row.name || row.artist || '');
  if (!q) return 'https://musicbrainz.org/search';
  const type = isAlbum ? 'release-group' : 'artist';
  return `https://musicbrainz.org/search?query=${encodeURIComponent(q)}&type=${type}&method=indexed`;
}
function ymSearchUrl(row: UnmatchedRow) {
  const q = isAlbumRow(row)
      ? `${row.artist ?? ''} ${row.album ?? row.title ?? ''}`.trim()
      : (row.name || row.artist || '');
  return q ? `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` : 'https://music.yandex.ru/';
}

export default function UnmatchedPage() {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setMsg] = useState<string>('');

  // вкладки
  const [target, setTarget] = useState<'artists' | 'albums'>('artists');

  // пагинация
  const [page, setPage] = useState(1);
  // 0 = All
  const [pageSize, setPageSize] = useState<number>(50);

  // сортировка по имени
  const [nameDir, setNameDir] = useState<'asc' | 'desc'>('asc');

  const fetchUnmatched = useCallback(async (t: 'artists' | 'albums') => {
    // основной эндпоинт с type
    try {
      return await api<any>(`/api/unmatched?type=${t}&limit=100000`);
    } catch {
      // фолбэк — вдруг старый эндпоинт
      return await api<any>(`/api/unmatched`);
    }
  }, []);

  const load = useCallback(async (t: 'artists' | 'albums' = target) => {
    setLoading(true);
    try {
      const r = await fetchUnmatched(t);
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
  }, [fetchUnmatched, target]);

  useEffect(() => { load(target); }, [load, target]);

  // фильтрация на случай, если API вернул всё вперемешку
  const filteredRows = useMemo(() => {
    return target === 'artists' ? rows.filter(isArtistRow) : rows.filter(isAlbumRow);
  }, [rows, target]);

  // сортировка (учитываем кириллицу)
  const sortedRows = useMemo(() => {
    const mult = nameDir === 'asc' ? 1 : -1;
    return filteredRows.slice().sort((a, b) => {
      const A = (displayTitle(a) || '').toString();
      const B = (displayTitle(b) || '').toString();
      const cmp = A.localeCompare(B, ['ru', 'en'], { sensitivity: 'base', numeric: true });
      if (cmp !== 0) return cmp * mult;

      const aid = String(a.id ?? '');
      const bid = String(b.id ?? '');
      return aid.localeCompare(bid, ['ru', 'en'], { numeric: true }) * mult;
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
          <h1 className="h1">Unmatched</h1>

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
                    {target === 'albums' ? 'Artist — Album' : 'Name'}
                    <span className="text-xs text-gray-500">{nameArrow}</span>
                  </button>
                </Th>
                <Th>Candidates</Th>
                <Th>Links</Th>
              </tr>
              </thead>
              <tbody>
              {pageRows.length === 0 ? (
                  <tr>
                    <Td colSpan={4}>
                      <div className="p-4 text-center text-gray-500">Nothing here 🎧</div>
                    </Td>
                  </tr>
              ) : (
                  pageRows.map((r, i) => {
                    const title = displayTitle(r) || '—';
                    const c = Array.isArray(r.candidates) ? r.candidates.length : 0;
                    const rowIndex = (pageSize === 0 ? 0 : sliceStart) + i + 1;

                    return (
                        <tr key={`${title}-${rowIndex}`}>
                          <Td>{rowIndex}</Td>
                          <Td>{title}</Td>
                          <Td>
                            {c > 0 ? (
                                <span className="badge badge-warn">{c}</span>
                            ) : (
                                <span className="text-gray-400">0</span>
                            )}
                          </Td>
                          <Td className="space-x-2">
                            <a
                                href={ymSearchUrl(r)}
                                target="_blank"
                                rel="noreferrer"
                                className="link-chip link-chip--ym"
                            >
                              Yandex
                            </a>
                            <a
                                href={mbSearchUrl(r)}
                                target="_blank"
                                rel="noreferrer"
                                className="link-chip link-chip--mb"
                            >
                              MusicBrainz
                            </a>
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
