import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { useRouter } from 'next/router';

type Settings = {
  // Yandex
  yandexToken?: string | null;
  yandexDriver?: 'pyproxy' | 'native' | string | null;
  pyproxyUrl?: string | null;
  yandexCron?: string | null;

  // Lidarr
  lidarrUrl?: string | null;
  lidarrApiKey?: string | null;
  pushTarget?: 'artists' | 'albums' | string | null;
  lidarrCron?: string | null;

  // Backup
  backupEnabled?: boolean | null;
  backupCron?: string | null;
  backupRetention?: number | null;
  backupDir?: string | null;

  // Notifications
  notifyType?: 'none' | 'telegram' | 'webhook' | string | null;
  telegramBot?: string | null;
  telegramChatId?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
};

type YandexTestResp = {
  ok: boolean;
  uid?: number | null;
  login?: string | null;
  tracks?: number;
  reason?: string;
  error?: string;
};
type LidarrTestResp = { ok: boolean; status?: number; data?: any; error?: string };
type BackupList = { dir: string; files: string[] };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const emptySettings: Settings = {
  // Yandex
  yandexToken: '',
  yandexDriver: 'pyproxy',
  pyproxyUrl: '',
  yandexCron: '',

  // Lidarr
  lidarrUrl: '',
  lidarrApiKey: '',
  pushTarget: 'artists',
  lidarrCron: '',

  // Backup
  backupEnabled: false,
  backupCron: '',
  backupRetention: 14,
  backupDir: '',

  // Notifications
  notifyType: 'none',
  telegramBot: '',
  telegramChatId: '',
  webhookUrl: '',
  webhookSecret: '',
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [, setBackup] = useState<BackupList | null>(null);
  const [busyBackup, setBusyBackup] = useState(false);
  const router = useRouter();
  const [runningBackup, setRunningBackup] = useState(false);

  const runBackup = useCallback(async () => {
    setRunningBackup(true);
    try {
      const r = await api<{ ok: boolean; file?: string; path?: string; error?: string }>(
          '/api/backup/run',
          { method: 'POST' }
      );
      if (!r.ok) {
        throw new Error(r.error || 'Backup failed');
      }
      // покажем простой тост/алерт; при желании замени на свой UI
      alert(`Backup created: ${r.path || r.file}`);
    } catch (e: any) {
      alert(`Backup error: ${e?.message || String(e)}`);
    } finally {
      setRunningBackup(false);
    }
  }, []);

  function upd<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((p) => ({ ...p, [k]: v }));
  }

  async function load() {
    setLoading(true);
    try {
      const data = await api<Settings>('/api/settings');
      setS({ ...emptySettings, ...(data || {}) });
      setMsg(null);
    } catch (e: any) {
      setMsg('Load failed: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify(s) });
      setMsg('Settings saved.');
    } catch (e: any) {
      setMsg('Save failed: ' + e.message);
    }
  }

  async function testYandex() {
    const r = await api<YandexTestResp>('/api/settings/test/yandex', {
      method: 'POST',
      body: JSON.stringify({ token: s.yandexToken }),
    });
    setMsg(
      r.ok
        ? `Yandex OK${
            r.uid ? ` (uid: ${r.uid}` : ''
          }${r.login ? `, login: ${r.login}` : ''}${r.uid ? ')' : ''}${
            typeof r.tracks === 'number' ? `, likes: ${r.tracks}` : ''
          }`
        : `Yandex failed${r.reason ? `: ${r.reason}` : ''}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  async function testLidarr() {
    try {
      const r = await api<LidarrTestResp>('/api/settings/test/lidarr', {
        method: 'POST',
        body: JSON.stringify(s),
      });
      setMsg(r.ok ? 'Lidarr OK' : `Lidarr failed: ${r.status ?? ''} ${r.error ?? ''}`);
    } catch (e: any) {
      setMsg('Lidarr test error: ' + e.message);
    }
  }

  async function loadBackups() {
    try {
      setBackup(await api<BackupList>('/api/backup/list'));
    } catch {
      setBackup({ dir: s.backupDir || '/app/data/backups', files: [] });
    }
  }

  async function runBackupNow() {
    setBusyBackup(true);
    try {
      await api('/api/backup/run', { method: 'POST' });
      setMsg('Backup started.');
      setTimeout(loadBackups, 1000);
    } catch (e: any) {
      setMsg('Backup failed: ' + e.message);
    } finally {
      setBusyBackup(false);
    }
  }

  useEffect(() => {
    load()
      .then(loadBackups)
      .catch(() => {});
  }, []);

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Nav />
      <div style={{ padding: 16 }}>
        <h1>Settings</h1>
        {msg && (
          <div
            style={{
              background: '#eef6ff',
              border: '1px solid #bfdbfe',
              padding: 8,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {msg}
          </div>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            {/* Yandex */}
            <section style={{ marginBottom: 24 }}>
              <h2>Yandex Music</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 1fr',
                  rowGap: 10,
                  columnGap: 12,
                }}
              >
                <label>Driver</label>
                <div>
                  <select
                    value={(s.yandexDriver as any) || 'pyproxy'}
                    onChange={(e) => upd('yandexDriver', e.target.value as any)}
                  >
                    <option value="pyproxy">pyproxy (Python sidecar)</option>
                    <option value="native">native (direct from Node)</option>
                  </select>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Рекомендуется pyproxy — помогает обходить SmartCaptcha.
                  </div>
                </div>

                <label>PyProxy URL</label>
                <div>
                  <input
                    type="text"
                    placeholder="http://pyproxy:8080"
                    value={s.pyproxyUrl || ''}
                    onChange={(e) => upd('pyproxyUrl', e.target.value)}
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Если пусто — возьмётся из переменной окружения <code>YA_PYPROXY_URL</code>.
                  </div>
                </div>

                <label>Yandex token</label>
                <div>
                  <input
                    type="password"
                    placeholder="OAuth token"
                    value={s.yandexToken || ''}
                    onChange={(e) => upd('yandexToken', e.target.value)}
                    style={{ width: '100%' }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <button onClick={testYandex}>Test Yandex</button>
                  </div>
                </div>

                <label>Sync cron (Yandex)</label>
                <div>
                  <input
                    type="text"
                    placeholder="e.g. 0 * * * *"
                    value={s.yandexCron || ''}
                    onChange={(e) => upd('yandexCron', e.target.value)}
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Пусто — планировщик выключен. Пример: <code>0 * * * *</code> — раз в час.
                  </div>
                </div>
              </div>
            </section>

            {/* Lidarr */}
            <section style={{ marginBottom: 24 }}>
              <h2>Lidarr</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 1fr',
                  rowGap: 10,
                  columnGap: 12,
                }}
              >
                <label>Push target</label>
                <div>
                  <select
                    value={(s.pushTarget as any) || 'artists'}
                    onChange={(e) => upd('pushTarget', e.target.value as any)}
                  >
                    <option value="artists">Artists (default)</option>
                    <option value="albums">Albums (release-groups)</option>
                  </select>
                </div>

                <label>Lidarr URL</label>
                <input
                  type="text"
                  placeholder="http://lidarr:8686"
                  value={s.lidarrUrl || ''}
                  onChange={(e) => upd('lidarrUrl', e.target.value)}
                />

                <label>Lidarr API key</label>
                <input
                  type="password"
                  placeholder="apikey"
                  value={s.lidarrApiKey || ''}
                  onChange={(e) => upd('lidarrApiKey', e.target.value)}
                />

                <label>Sync cron (Lidarr push)</label>
                <input
                  type="text"
                  placeholder="e.g. 15 * * * *"
                  value={s.lidarrCron || ''}
                  onChange={(e) => upd('lidarrCron', e.target.value)}
                />

                <div />
                <div style={{ marginTop: 8 }}>
                  <button onClick={testLidarr}>Test Lidarr</button>
                </div>
              </div>
            </section>

            {/* Backup */}
            <section style={{ marginBottom: 24 }}>
              <h2>Backups (SQLite)</h2>
              <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '220px 1fr',
                    rowGap: 10,
                    columnGap: 12,
                  }}
              >
                <label>Enabled</label>
                <input
                    type="checkbox"
                    checked={!!s.backupEnabled}
                    onChange={(e) => upd('backupEnabled', e.target.checked)}
                />

                <label>Cron</label>
                <input
                    type="text"
                    placeholder="e.g. 0 3 * * *"
                    value={s.backupCron || ''}
                    onChange={(e) => upd('backupCron', e.target.value)}
                />

                <label>Retention (files)</label>
                <input
                    type="number"
                    min={1}
                    value={Number(s.backupRetention ?? 14)}
                    onChange={(e) => upd('backupRetention', parseInt(e.target.value || '0', 10))}
                />

                <label>Directory</label>
                <input
                    type="text"
                    placeholder="/app/data/backups"
                    value={s.backupDir || ''}
                    onChange={(e) => upd('backupDir', e.target.value)}
                />

                <div/>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8}}>
                  <button
                      onClick={() => router.push('/backups')}
                      style={{padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6}}
                  >
                    Open backups list
                  </button>

                  <button
                      onClick={runBackup}
                      disabled={runningBackup}
                      style={{padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6}}
                  >
                    {runningBackup ? 'Running…' : 'Run backup now'}
                  </button>
                </div>
              </div>

              <div style={{marginTop: 12}}>
                <b>Exports:</b>{' '}
                <a href={`/api/export/artists.json`} target="_blank" rel="noreferrer">
                  Artists JSON
                </a>{' '}
                •{' '}
                <a href={`/api/export/artists.csv`} target="_blank" rel="noreferrer">
                  Artists CSV
                </a>{' '}
                •{' '}
                <a href={`/api/export/artists.md`} target="_blank" rel="noreferrer">
                  Artists MD
                </a>{' '}
                •{' '}
                <a href={`/api/export/albums.json`} target="_blank" rel="noreferrer">
                  Albums JSON
                </a>{' '}
                •{' '}
                <a href={`/api/export/albums.csv`} target="_blank" rel="noreferrer">
                  Albums CSV
                </a>{' '}
                •{' '}
                <a href={`/api/export/albums.md`} target="_blank" rel="noreferrer">
                  Albums MD
                </a>
              </div>
            </section>

            {/* Notifications */}
            <section style={{ marginBottom: 24 }}>
              <h2>Notifications</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 1fr',
                  rowGap: 10,
                  columnGap: 12,
                }}
              >
                <label>Type</label>
                <div>
                  <select
                    value={(s.notifyType as any) || 'none'}
                    onChange={(e) => upd('notifyType', e.target.value as any)}
                  >
                    <option value="none">None</option>
                    <option value="telegram">Telegram</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Уведомления о завершении синка (успех/ошибка).
                  </div>
                </div>

                {s.notifyType === 'telegram' && (
                  <>
                    <label>Telegram Bot Token</label>
                    <input
                      type="password"
                      placeholder="e.g. 123456:ABCDEF..."
                      value={s.telegramBot || ''}
                      onChange={(e) => upd('telegramBot', e.target.value)}
                    />

                    <label>Telegram Chat ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 12345678"
                      value={s.telegramChatId || ''}
                      onChange={(e) => upd('telegramChatId', e.target.value)}
                    />
                    <div style={{ gridColumn: '1 / span 2', fontSize: 12, opacity: 0.7 }}>
                      Подсказка: отправьте сообщение своему боту и получите chat_id через
                      <code> getUpdates</code> у BotFather/через API.
                    </div>
                  </>
                )}

                {s.notifyType === 'webhook' && (
                  <>
                    <label>Webhook URL</label>
                    <input
                      type="text"
                      placeholder="https://example.com/webhook"
                      value={s.webhookUrl || ''}
                      onChange={(e) => upd('webhookUrl', e.target.value)}
                    />

                    <label>Webhook Secret (optional)</label>
                    <input
                      type="password"
                      placeholder="shared secret"
                      value={s.webhookSecret || ''}
                      onChange={(e) => upd('webhookSecret', e.target.value)}
                    />
                    <div style={{ gridColumn: '1 / span 2', fontSize: 12, opacity: 0.7 }}>
                      Мы отправляем JSON с итоговой статистикой синка. Если задан секрет — добавляем
                      заголовок <code>X-Signature</code> (HMAC-SHA256).
                    </div>
                  </>
                )}
              </div>
            </section>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save}>Save</button>
              <button onClick={load}>Reload</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
