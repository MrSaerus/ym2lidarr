import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import FormRow from '../components/FormRow';

type Settings = {
  // Yandex Music
  yandexDriver: 'pyproxy' | 'native';
  yandexToken?: string | null;
  pyproxyUrl?: string | null;
  yandexCron?: string | null;

  // Lidarr
  lidarrUrl?: string | null;
  lidarrApiKey?: string | null;
  pushTarget: 'artists' | 'albums';
  lidarrCron?: string | null;

  // Backup
  backupEnabled: boolean;
  backupCron?: string | null;
  backupDir?: string | null;
  backupRetention?: number | null;

  // Notifications
  notifyType: 'disabled' | 'telegram' | 'webhook';
  telegramBot?: string | null;
  telegramChatId?: string | null;
  webhookUrl?: string | null;
};

function withDefaults(x: Partial<Settings> | null | undefined): Settings {
  const s = x || {};
  return {
    yandexDriver: (s.yandexDriver as any) || 'pyproxy',
    yandexToken: s.yandexToken ?? '',
    pyproxyUrl: s.pyproxyUrl ?? 'http://pyproxy:8080',
    yandexCron: s.yandexCron ?? '0 */6 * * *', // каждые 6 часов

    lidarrUrl: s.lidarrUrl ?? 'http://localhost:8686',
    lidarrApiKey: s.lidarrApiKey ?? '',
    pushTarget: (s.pushTarget as any) || 'artists',
    lidarrCron: s.lidarrCron ?? '0 */12 * * *', // каждые 12 часов

    backupEnabled: !!s.backupEnabled,
    backupCron: s.backupCron ?? '0 3 * * *', // ежедневно в 03:00
    backupDir: s.backupDir ?? '/app/data/backups',
    backupRetention: s.backupRetention ?? 14,

    notifyType: (s.notifyType as any) || 'disabled',
    telegramBot: s.telegramBot ?? '',
    telegramChatId: s.telegramChatId ?? '',
    webhookUrl: s.webhookUrl ?? '',
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(withDefaults(undefined));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<any>('/api/settings');
      const raw = (r && 'settings' in r) ? (r as any).settings : r;
      setSettings(withDefaults(raw));
      setMsg('');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setMsg('Saving…');
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setMsg('Saved');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  async function testYandex() {
    setMsg('Testing Yandex…');
    try {
      const r = await api<any>('/api/settings/test/yandex', { method: 'POST' });
      setMsg(r?.ok ? `Yandex OK${r.uid ? ` (uid: ${r.uid})` : ''}` : `Yandex failed: ${r?.error || 'unknown error'}`);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  async function testLidarr() {
    setMsg('Testing Lidarr…');
    try {
      const r = await api<any>('/api/settings/test/lidarr', { method: 'POST' });
      setMsg(r?.ok ? 'Lidarr OK' : `Lidarr failed: ${r?.error || 'unknown error'}`);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  async function listBackups() {
    try {
      const r = await api('/api/backup/list');
      setMsg(typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  async function runBackupNow() {
    setMsg('Running backup…');
    try {
      const r = await api<any>('/api/backup/run', { method: 'POST' });
      setMsg(r?.ok ? 'Backup completed' : `Backup error: ${r?.error || 'unknown'}`);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  return (
      <>
        <Nav />
        <main className="mx-auto max-w-4xl px-4 py-4 space-y-6">
          <h1 className="h1">Settings</h1>
          {msg ? <div className="badge">{msg}</div> : null}

          {/* Yandex Music */}
          <section className="panel p-4 space-y-3">
            <div className="section-title">Yandex Music</div>

            <FormRow label="Driver"
                     help="Как получать лайки ЯМузыки: через Python proxy (рекомендуется) или нативно через токен.">
              <select
                  className="select"
                  value={settings.yandexDriver}
                  onChange={(e) => setSettings({ ...settings, yandexDriver: e.target.value as Settings['yandexDriver'] })}
              >
                <option value="pyproxy">pyproxy</option>
                <option value="native">native</option>
              </select>
            </FormRow>

            <FormRow label="Yandex token" help="Используется только в режиме 'native'. Токен Паспорта/Музыки.">
              <input
                  className="input"
                  value={settings.yandexToken || ''}
                  onChange={(e) => setSettings({ ...settings, yandexToken: e.target.value })}
                  placeholder="y0_AgAAA…"
              />
            </FormRow>

            <FormRow label="pyProxy URL" help="Используется только в режиме 'pyproxy'. Адрес FastAPI-прокси для ЯМузыки.">
              <input
                  className="input"
                  value={settings.pyproxyUrl || ''}
                  onChange={(e) => setSettings({ ...settings, pyproxyUrl: e.target.value })}
                  placeholder="http://pyproxy:8080"
              />
            </FormRow>

            <FormRow
                label="Yandex sync cron"
                help={<>CRON-расписание (UTC) для синхронизации лайков из Яндекс.Музыки. Примеры: <code>0 */6 * * *</code> — каждые 6 часов; <code>0 3 * * *</code> — ежедневно в 03:00.</>}
            >
              <input
                  className="input"
                  value={settings.yandexCron || ''}
                  onChange={(e) => setSettings({ ...settings, yandexCron: e.target.value })}
                  placeholder="0 */6 * * *"
              />
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testYandex}>Test Yandex</button>
            </div>
          </section>

          {/* Lidarr */}
          <section className="panel p-4 space-y-3">
            <div className="text-sm font-medium text-gray-400">Lidarr</div>

            <FormRow label="URL" help="Базовый URL Lidarr (например http://lidarr:8686).">
              <input
                  className="input"
                  value={settings.lidarrUrl || ''}
                  onChange={(e) => setSettings({ ...settings, lidarrUrl: e.target.value })}
                  placeholder="http://localhost:8686"
              />
            </FormRow>

            <FormRow label="API Key" help="Настройки → General → Security → API Key в Lidarr.">
              <input
                  className="input"
                  value={settings.lidarrApiKey || ''}
                  onChange={(e) => setSettings({ ...settings, lidarrApiKey: e.target.value })}
                  placeholder="xxxxxxxxxxxxxxxx"
              />
            </FormRow>

            <FormRow label="Push target" help="Кого отправлять в Lidarr при пуше: артистов (по умолчанию) или release-groups альбомов.">
              <select
                  className="select"
                  value={settings.pushTarget}
                  onChange={(e) => setSettings({ ...settings, pushTarget: e.target.value as any })}
              >
                <option value="artists">Artists (default)</option>
                <option value="albums">Albums</option>
              </select>
            </FormRow>

            <FormRow
                label="Lidarr push cron"
                help={<>CRON-расписание (UTC) для периодического пуша в Lidarr. Примеры: <code>0 */12 * * *</code> — каждые 12 часов; <code>30 4 * * *</code> — ежедневно в 04:30.</>}
            >
              <input
                  className="input"
                  value={settings.lidarrCron || ''}
                  onChange={(e) => setSettings({ ...settings, lidarrCron: e.target.value })}
                  placeholder="0 */12 * * *"
              />
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testLidarr}>Test Lidarr</button>
            </div>
          </section>

          {/* Backup */}
          <section className="panel p-4 space-y-3">
            <div className="text-sm font-medium text-gray-400">Backup</div>

            <FormRow label="Enable">
              <div className="control flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={!!settings.backupEnabled}
                    onChange={(e) => setSettings({ ...settings, backupEnabled: e.target.checked })}
                />
                <span className="text-sm text-gray-500">Enable scheduled backups</span>
              </div>
            </FormRow>

            <FormRow
                label="Cron"
                help={<>CRON-расписание (UTC) для резервного копирования. Примеры: <code>0 3 * * *</code> — ежедневно в 03:00; <code>0 */6 * * *</code> — каждые 6 часов.</>}
            >
              <input
                  className="input"
                  value={settings.backupCron || ''}
                  onChange={(e) => setSettings({ ...settings, backupCron: e.target.value })}
                  placeholder="0 3 * * *"
              />
            </FormRow>

            <FormRow label="Directory" help="Каталог внутри контейнера/тома, куда складывать архивы БД.">
              <input
                  className="input"
                  value={settings.backupDir || ''}
                  onChange={(e) => setSettings({ ...settings, backupDir: e.target.value })}
                  placeholder="/app/data/backups"
              />
            </FormRow>

            <FormRow label="Retention" help="Сколько последних бэкапов хранить. 0 — хранить всё.">
              <input
                  className="input"
                  type="number"
                  min={0}
                  value={settings.backupRetention ?? 0}
                  onChange={(e) => setSettings({ ...settings, backupRetention: Number(e.target.value || 0) })}
                  placeholder="14"
              />
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={listBackups}>List backups</button>
              <button className="btn btn-primary" onClick={runBackupNow}>Run backup now</button>
            </div>
          </section>

          {/* Notifications */}
          <section className="panel p-4 space-y-3">
            <div className="text-sm font-medium text-gray-400">Notifications</div>

            <FormRow label="Type" help="Куда присылать уведомления о завершении синхронизаций.">
              <select
                  className="select"
                  value={settings.notifyType}
                  onChange={(e) => setSettings({ ...settings, notifyType: e.target.value as Settings['notifyType'] })}
              >
                <option value="disabled">Disabled</option>
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook</option>
              </select>
            </FormRow>

            {settings.notifyType === 'telegram' && (
                <>
                  <FormRow label="Telegram bot token" help="Токен @BotFather.">
                    <input
                        className="input"
                        value={settings.telegramBot || ''}
                        onChange={(e) => setSettings({ ...settings, telegramBot: e.target.value })}
                        placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    />
                  </FormRow>
                  <FormRow label="Telegram chat id" help="ID чата/пользователя, куда отправлять уведомления.">
                    <input
                        className="input"
                        value={settings.telegramChatId || ''}
                        onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                        placeholder="123456789"
                    />
                  </FormRow>
                </>
            )}

            {settings.notifyType === 'webhook' && (
                <FormRow label="Webhook URL" help="POST JSON webhook при завершении синка.">
                  <input
                      className="input"
                      value={settings.webhookUrl || ''}
                      onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
                      placeholder="https://example.com/hook"
                  />
                </FormRow>
            )}
          </section>

          <div className="toolbar">
            <button className="btn btn-primary" onClick={save} disabled={loading}>
              {loading ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </main>
      </>
  );
}
