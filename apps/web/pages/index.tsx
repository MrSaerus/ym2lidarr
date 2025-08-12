import { useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';

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
  artists: { total: number; found: number; unmatched: number };
  albums: { total: number; found: number; unmatched: number };
  runs: {
    yandex: { active?: RunInfo | null; last?: RunInfo | null };
    lidarr: { active?: RunInfo | null; last?: RunInfo | null };
  };
};

export default function OverviewPage() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyY, setBusyY] = useState(false);
  const [busyL, setBusyL] = useState(false);

  async function load() {
    try {
      const s = await api<Summary>('/api/stats');
      setSum(s);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function runYandex(force = false) {
    setBusyY(true);
    try {
      await api('/api/sync/yandex', { method: 'POST', body: JSON.stringify({ force }) });
      await load();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusyY(false);
    }
  }

  async function runLidarr() {
    setBusyL(true);
    try {
      await api('/api/sync/lidarr', { method: 'POST' });
      await load();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusyL(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Nav />
      <div style={{ padding: 16 }}>
        <h1>Overview</h1>
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
        {!sum ? (
          <p>Loading…</p>
        ) : (
          <>
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
                gap: 12,
                marginBottom: 20,
              }}
            >
              <Card title="Artists">
                <Stat label="Total" value={sum.artists.total} />
                <Stat label="Found" value={sum.artists.found} />
                <Stat label="Unmatched" value={sum.artists.unmatched} />
              </Card>
              <Card title="Albums (release-groups)">
                <Stat label="Total" value={sum.albums.total} />
                <Stat label="Found" value={sum.albums.found} />
                <Stat label="Unmatched" value={sum.albums.unmatched} />
              </Card>
            </section>

            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
                gap: 12,
              }}
            >
              <Card title="Yandex sync">
                <RunBlock run={sum.runs.yandex.active || sum.runs.yandex.last || null} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => runYandex(false)} disabled={busyY}>
                    Run
                  </button>
                  <button
                    onClick={() => runYandex(true)}
                    disabled={busyY}
                    title="Force rematch (ignore cool-down)"
                  >
                    Run (force)
                  </button>
                </div>
              </Card>
              <Card title="Lidarr push">
                <RunBlock run={sum.runs.lidarr.active || sum.runs.lidarr.last || null} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={runLidarr} disabled={busyL}>
                    Push to Lidarr
                  </button>
                </div>
              </Card>
            </section>

            <div style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
              Live-логи переехали во вкладку <b>Live Logs</b>.
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Card({ title, children }: any) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function RunBlock({ run }: { run: RunInfo | null }) {
  if (!run) return <div style={{ opacity: 0.7 }}>No runs yet</div>;
  const statusColor =
    run.status === 'running' ? '#2563eb' : run.status === 'ok' ? '#16a34a' : '#dc2626';
  return (
    <div>
      <div>
        <b>ID:</b> {run.id} • <b>Status:</b>{' '}
        <span style={{ color: statusColor }}>{run.status}</span>
      </div>
      <div style={{ fontSize: 13, opacity: 0.85 }}>
        <b>Started:</b> {new Date(run.startedAt).toLocaleString()}
        {run.finishedAt && (
          <>
            {' '}
            • <b>Finished:</b> {new Date(run.finishedAt).toLocaleString()}
          </>
        )}
        {typeof run.durationSec === 'number' && (
          <>
            {' '}
            • <b>Duration:</b> {run.durationSec}s
          </>
        )}
      </div>
      {run.message && <div style={{ fontSize: 13, marginTop: 4, opacity: 0.8 }}>{run.message}</div>}
    </div>
  );
}
