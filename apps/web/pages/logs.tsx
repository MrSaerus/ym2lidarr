import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import { api, API_BASE } from '../lib/api';

type RunInfo = {
  id: number;
  kind: 'yandex' | 'lidarr';
  status: 'running' | 'ok' | 'error';
  message?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  durationSec?: number | null;
  stats?: any;
};

type Summary = {
  runs: {
    yandex: { active?: RunInfo | null; last?: RunInfo | null };
    lidarr: { active?: RunInfo | null; last?: RunInfo | null };
  };
};

type LogRow = {
  id: number;
  ts: string; // ISO
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: any;
};

export default function LiveLogsPage() {
  const [source, setSource] = useState<'yandex' | 'lidarr'>('yandex');
  const [follow, setFollow] = useState<'active' | 'last'>('active');
  const [run, setRun] = useState<RunInfo | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const lastIdRef = useRef<number>(0);
  const autoscrollRef = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const title = useMemo(
    () => `${source.toUpperCase()} — ${follow === 'active' ? 'Active' : 'Last'} run`,
    [source, follow],
  );

  // pick run (active/last) from /api/stats
  async function pickRun() {
    try {
      const s = await api<Summary>('/api/stats');
      const block = (s.runs as any)[source] || {};
      const candidate: RunInfo | null = (block[follow] as RunInfo) || null;
      if (!candidate) {
        setRun(null);
        return;
      }
      // if changed — reset log state
      if (!run || run.id !== candidate.id) {
        setRun(candidate);
        setRows([]);
        lastIdRef.current = 0;
      } else {
        setRun(candidate); // refresh status
      }
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  // pull logs for chosen run
  async function pollLogs() {
    if (!run?.id) return;
    try {
      const after = lastIdRef.current || 0;
      const url = `${API_BASE}/api/runs/${run.id}/logs?after=${after}&limit=200`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      const items: LogRow[] = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      if (items.length) {
        // keep order ascending by id
        const sorted = items.slice().sort((a, b) => a.id - b.id);
        lastIdRef.current = sorted[sorted.length - 1].id;
        setRows((prev) => {
          const merged = [...prev, ...sorted];
          // limit in memory
          return merged.slice(-2000);
        });
      }
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  // autoscroll
  useEffect(() => {
    if (!autoscrollRef.current) return;
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  useEffect(() => {
    pickRun();
    const t1 = setInterval(pickRun, 2000);
    const t2 = setInterval(pollLogs, 1000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, follow, run?.id]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Nav />
      <div style={{ padding: 16 }}>
        <h1>Live Logs</h1>

        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <label>
            Source:&nbsp;
            <select value={source} onChange={(e) => setSource(e.target.value as any)}>
              <option value="yandex">Yandex</option>
              <option value="lidarr">Lidarr</option>
            </select>
          </label>

          <label>
            Follow:&nbsp;
            <select value={follow} onChange={(e) => setFollow(e.target.value as any)}>
              <option value="active">Active run</option>
              <option value="last">Last finished</option>
            </select>
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={autoscrollRef.current}
              onChange={(e) => {
                autoscrollRef.current = e.target.checked;
              }}
            />
            Autoscroll
          </label>

          <div style={{ opacity: 0.8 }}>
            {run ? (
              <span>
                {title}: <b>#{run.id}</b> • <StatusTag status={run.status} />
              </span>
            ) : (
              <span>No run selected</span>
            )}
          </div>
        </div>

        {err && (
          <div
            style={{
              background: '#fee2e2',
              border: '1px solid #fecaca',
              padding: 8,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        <div
          ref={boxRef}
          style={{
            border: '1px solid #eee',
            borderRadius: 8,
            minHeight: 360,
            maxHeight: 540,
            overflow: 'auto',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            padding: 8,
            background: '#0b1020',
            color: '#e5e7eb',
            lineHeight: 1.4,
          }}
        >
          {rows.length === 0 && <div style={{ opacity: 0.6 }}>No logs yet…</div>}
          {rows.map((r) => (
            <div key={r.id} style={{ whiteSpace: 'pre-wrap' }}>
              <span style={{ opacity: 0.6 }}>{fmtTime(r.ts)}</span> <LevelTag level={r.level} />{' '}
              <span>{r.message}</span>
              {r.meta && <span style={{ opacity: 0.75 }}> — {safeMeta(r.meta)}</span>}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function fmtTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function safeMeta(meta: any) {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function LevelTag({ level }: { level: LogRow['level'] }) {
  const color =
    level === 'error'
      ? '#ef4444'
      : level === 'warn'
        ? '#f59e0b'
        : level === 'info'
          ? '#60a5fa'
          : '#a78bfa';
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        padding: '1px 6px',
        borderRadius: 999,
        fontSize: 12,
      }}
    >
      {level}
    </span>
  );
}

function StatusTag({ status }: { status: 'running' | 'ok' | 'error' }) {
  const color = status === 'running' ? '#60a5fa' : status === 'ok' ? '#22c55e' : '#ef4444';
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        padding: '1px 6px',
        borderRadius: 999,
        fontSize: 12,
      }}
    >
      {status}
    </span>
  );
}
