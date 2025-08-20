// apps/web/pages/backups.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import Skeleton from '../components/Skeleton';
import { Table, Th, Td } from '../components/Table';

type BackupEntry = { file: string; size: number; mtime: number };
type ListResp = { ok: boolean; dir: string; files: BackupEntry[] };
type RunResp = { ok: boolean; file?: string; path?: string; error?: string };

function fmtBytes(n: number) {
    if (!Number.isFinite(n)) return String(n);
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function toMs(x: number) {
    // если пришли секунды, домножим
    return x < 1e12 ? x * 1000 : x;
}
function fmtDate(msOrSec: number) {
    try { return new Date(toMs(msOrSec)).toLocaleString(); } catch { return String(msOrSec); }
}

export default function BackupsPage() {
    const [data, setData] = useState<ListResp | null>(null);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);
        try {
            const r = await api<ListResp>('/api/backup/list');
            setData(r); setErr(null);
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sortedFiles = useMemo(() => {
        const files = data?.files || [];
        // Новые сверху
        return files.slice().sort((a, b) => b.mtime - a.mtime);
    }, [data]);

    const totalSize = useMemo(
        () => (data?.files || []).reduce((acc, f) => acc + (f.size || 0), 0),
        [data],
    );

    async function runBackupNow() {
        setRunning(true);
        setErr(null);
        setMsg('Running backup…');
        try {
            const r = await api<RunResp>('/api/backup/run', { method: 'POST' });
            if (!r.ok) {
                setErr(r.error || 'Backup failed');
                setMsg(null);
            } else {
                setMsg(`Backup completed${r.file ? `: ${r.file}` : ''}`);
                await load();
            }
        } catch (e: any) {
            setErr(e?.message || String(e));
            setMsg(null);
        } finally {
            setRunning(false);
        }
    }

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-4">
                <h1 className="h1">Backups</h1>

                <div className="toolbar">
                    <button onClick={load} disabled={loading} className="btn btn-outline">
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button onClick={runBackupNow} disabled={running} className="btn btn-primary">
                        {running ? 'Running…' : 'Run backup now'}
                    </button>
                    {data?.dir && <span className="text-sm text-gray-500">Directory: <code>{data.dir}</code></span>}
                    {data && (
                        <span className="text-sm text-gray-500">
              Files: <b>{data.files.length}</b>, total: <b>{fmtBytes(totalSize)}</b>
            </span>
                    )}
                </div>

                {err && <div className="badge badge-err mb-3">Error: {err}</div>}
                {msg && !err && <div className="badge mb-3">{msg}</div>}

                <div className="panel overflow-x-auto">
                    {loading ? (
                        <div className="p-4"><Skeleton rows={6} /></div>
                    ) : (
                        <Table>
                            <thead>
                            <tr>
                                <Th>#</Th>
                                <Th>File</Th>
                                <Th>Size</Th>
                                <Th>Modified</Th>
                            </tr>
                            </thead>
                            <tbody>
                            {sortedFiles.length === 0 ? (
                                <tr>
                                    <Td colSpan={4}>
                                        <div className="p-4 text-center text-gray-500">No backups yet.</div>
                                    </Td>
                                </tr>
                            ) : (
                                sortedFiles.map((f, i) => (
                                    <tr key={f.file}>
                                        <Td>{i + 1}</Td>
                                        <Td><code className="font-mono">{f.file}</code></Td>
                                        <Td>{fmtBytes(f.size)}</Td>
                                        <Td>{fmtDate(f.mtime)}</Td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </Table>
                    )}
                </div>

                <p className="mt-3 text-sm text-gray-500">
                    Files live on the API host. For downloads expose a static route or copy from the mounted volume.
                </p>
            </main>
        </>
    );
}
