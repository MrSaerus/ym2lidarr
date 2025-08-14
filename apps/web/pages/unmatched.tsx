import React, { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<any>('/api/unmatched');
      const items: any[] = Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []);
      setRows(items);
      setMsg('');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
              {rows.length === 0 ? (
                  <tr>
                    <Td colSpan={4}>
                      <div className="p-4 text-center text-gray-500">Nothing here 🎧</div>
                    </Td>
                  </tr>
              ) : (
                  rows.map((r, i) => {
                    const q = r.name || (r.artist && r.album ? `${r.artist} — ${r.album}` : r.artist) || '—';
                    const c = Array.isArray(r.candidates) ? r.candidates.length : 0;
                    return (
                        <tr key={`${q}-${i}`}>
                          <Td>{i + 1}</Td>
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
