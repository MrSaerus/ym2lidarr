import React, { useCallback, useEffect, useState } from 'react';
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
    if (row?.yandexAlbumId) return `https://music.yandex.ru/album/${row.yandexAlbumId}`;
    const q =
        row?.name ||
        row?.artist ||
        row?.Artist ||
        (row?.artist && row?.album ? `${row.artist} ${row.album}` : '') ||
        row?.title ||
        '';
    if (!q) return 'https://music.yandex.ru/';
    return `https://music.yandex.ru/search?text=${encodeURIComponent(q)}`;
}

export default function FoundPage() {
    const [rows, setRows] = useState<FoundRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string>('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api<any>('/api/found');
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
                <h1 className="h1">Found</h1>

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
                            <Th>Name</Th>
                            <Th>MBID</Th>
                            <Th>Links</Th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <Td colSpan={4}>
                                    <div className="p-4 text-center text-gray-500">No data</div>
                                </Td>
                            </tr>
                        ) : (
                            rows.map((r: any, i: number) => {
                                const mbid = r?.mbid || r?.MusicBrainzId || r?.ReleaseGroupMBID || '';
                                const kind: 'artist' | 'album' | 'rg' =
                                    r?.ReleaseGroupMBID ? 'rg' : (r?.kind || 'artist');
                                const title =
                                    r?.name ||
                                    r?.artist ||
                                    r?.Artist ||
                                    (r?.artist && r?.album ? `${r.artist} — ${r.album}` : (r?.title || r?.Album || '—'));

                                return (
                                    <tr key={`${mbid}-${i}`}>
                                        <Td>{i + 1}</Td>
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
