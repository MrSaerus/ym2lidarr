import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';

type BackupEntry = { file: string; size: number; mtime: number };
type ListResp = { ok: boolean; dir: string; files: BackupEntry[] };

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return String(bytes);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let b = bytes;
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
        b /= 1024;
        i++;
    }
    return `${b.toFixed(b < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms: number): string {
    try {
        const d = new Date(ms);
        return d.toLocaleString();
    } catch {
        return String(ms);
    }
}

export default function BackupsPage() {
    const [data, setData] = useState<ListResp | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api<ListResp>('/api/backup/list');
            setData(r);
            setErr(null);
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const totalSize = useMemo(
        () => (data?.files || []).reduce((acc, f) => acc + (f.size || 0), 0),
        [data],
    );

    return (
        <>
            <Nav />
            <main style={{ padding: 16 }}>
                <h1 style={{ marginBottom: 12 }}>Backups</h1>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <button
                        onClick={load}
                        disabled={loading}
                        style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6 }}
                    >
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>

                    {data?.dir ? (
                        <span style={{ color: '#555' }}>
              Directory:&nbsp;<code>{data.dir}</code>
            </span>
                    ) : null}

                    {data ? (
                        <span style={{ color: '#555' }}>
              Files:&nbsp;<b>{data.files.length}</b>, total:&nbsp;<b>{formatBytes(totalSize)}</b>
            </span>
                    ) : null}
                </div>

                {err ? (
                    <div style={{ color: '#b00020', marginBottom: 12 }}>Error: {err}</div>
                ) : null}

                <div style={{ overflowX: 'auto' }}>
                    <table
                        style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            border: '1px solid #eee',
                            minWidth: 600,
                        }}
                    >
                        <thead>
                        <tr style={{ background: '#fafafa' }}>
                            <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>#</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>File</th>
                            <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Size</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Modified</th>
                        </tr>
                        </thead>
                        <tbody>
                        {(data?.files || []).length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    style={{ padding: 12, textAlign: 'center', color: '#777', fontStyle: 'italic' }}
                                >
                                    No backups yet.
                                </td>
                            </tr>
                        ) : (
                            (data?.files || []).map((f, i) => (
                                <tr key={f.file}>
                                    <td style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                                        {i + 1}
                                    </td>
                                    <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                                        <code>{f.file}</code>
                                    </td>
                                    <td style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                                        {formatBytes(f.size)}
                                    </td>
                                    <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                                        {formatDate(f.mtime)}
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>

                <p style={{ marginTop: 12, color: '#777', fontSize: 13 }}>
                    Note: files are stored on the API host. To download them, copy the path and fetch via the host
                    filesystem or add a download endpoint later if needed.
                </p>
            </main>
        </>
    );
}
