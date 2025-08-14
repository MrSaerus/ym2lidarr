import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';

type UnmatchedRow = {
  name?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  candidates?: any[];
  search?: string;
};

function mbSearchUrl(row: UnmatchedRow) {
  if (row.search) return row.search;
  const q = row.album && row.artist ? `${row.album} artist:${row.artist}` : (row.name || row.artist || '');
  if (!q) return 'https://musicbrainz.org/search';
  return `https://musicbrainz.org/search?query=${encodeURIComponent(q)}&type=${row.album ? 'release-group' : 'artist'}&method=indexed`;
}
function ymSearchUrl(row: UnmatchedRow) {
  const q = row.album && row.artist ? `${row.artist} ${row.album}` : (row.name || row.artist || '');
  return q ? `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` : 'https://music.yandex.ru/';
}

export default function UnmatchedPage() {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<any>('/api/unmatched');
      const items: any[] = Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []);
      setRows(items);
      setMsg('');
      setPage(1);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // pagination calcs
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { setPage((p) => Math.min(Math.max(1, p), pageCount)); }, [pageSize, rows.length, pageCount]);
  const sliceStart = (page - 1) * pageSize;
  const sliceEnd = sliceStart + pageSize;
  const pageRows = useMemo(() => rows.slice(sliceStart, sliceEnd), [rows, sliceStart, sliceEnd]);
  const rangeFrom = rows.length ? sliceStart + 1 : 0;
  const rangeTo = Math.min(sliceEnd, rows.length);

  return (
      <>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="h1">Unmatched</h1>

          <div className="toolbar">
            <button className="btn btn-outline" onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {msg && <div className="badge badge-err">{msg}</div>}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-500">Rows per page:</span>
              <select
                  className="select"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 50)}
              >
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-xs text-gray-500">
              {rows.length ? `Showing ${rangeFrom}–${rangeTo} of ${rows.length}` : 'No data'}
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

          <div className="panel overflow-x-auto">
            <Table className="table-like-logs">
              <thead>
              <tr>
                <Th>#</Th>
                <Th>Query</Th>
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
                    const q = r.name || (r.artist && r.album ? `${r.artist} — ${r.album}` : r.artist) || '—';
                    const c = Array.isArray(r.candidates) ? r.candidates.length : 0;
                    const rowIndex = sliceStart + i + 1;

                    return (
                        <tr key={`${q}-${rowIndex}`}>
                          <Td>{rowIndex}</Td>
                          <Td>{q}</Td>
                          <Td>{c > 0 ? <span className="badge badge-warn">{c}</span> : <span className="text-gray-400">0</span>}</Td>
                          <Td className="space-x-2">
                            <a href={ymSearchUrl(r)} target="_blank" rel="noreferrer" className="link-chip link-chip--ym">Yandex</a>
                            <a href={mbSearchUrl(r)} target="_blank" rel="noreferrer" className="link-chip link-chip--mb">MusicBrainz</a>
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
