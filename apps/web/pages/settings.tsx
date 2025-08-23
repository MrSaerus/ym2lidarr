import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import FormRow from '../components/FormRow';

type Settings = {
  // Yandex Music
  yandexDriver: 'pyproxy' | 'native';
  yandexToken?: string | null;
  pyproxyUrl?: string | null;

  // Расписания + таргеты (НОВОЕ)
  cronYandexPull?: string | null;
  cronYandexMatch?: string | null;
  cronYandexPush?: string | null;
  yandexMatchTarget?: 'both'|'artists'|'albums';
  yandexPushTarget?: 'both'|'artists'|'albums';

  // Lidarr
  lidarrUrl?: string | null;
  lidarrApiKey?: string | null;
  lidarrAllowNoMetadata?: boolean | null;

  // Lidarr pull (НОВОЕ)
  cronLidarrPull?: string | null;
  lidarrPullTarget?: 'both'|'artists'|'albums';

  // Параметр для ручного Push (оставляем)
  pushTarget: 'artists' | 'albums';

  // Lidarr defaults
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null;

  // Custom (НОВОЕ)
  cronCustomMatch?: string | null;
  cronCustomPush?: string | null;

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
    // Yandex
    yandexDriver: (s.yandexDriver as any) || 'pyproxy',
    yandexToken: s.yandexToken ?? '',
    pyproxyUrl: s.pyproxyUrl ?? 'http://pyproxy:8080',
    cronYandexPull:  s.cronYandexPull  ?? '0 */6 * * *',
    cronYandexMatch: s.cronYandexMatch ?? '10 */6 * * *',
    cronYandexPush:  s.cronYandexPush  ?? '45 */6 * * *',
    yandexMatchTarget: (s.yandexMatchTarget as any) || 'both',
    yandexPushTarget:  (s.yandexPushTarget  as any) || 'both',

    // Lidarr
    lidarrUrl: s.lidarrUrl ?? 'http://localhost:8686',
    lidarrApiKey: s.lidarrApiKey ?? '',
    lidarrAllowNoMetadata: !!s.lidarrAllowNoMetadata,

    // Lidarr pull
    cronLidarrPull:  s.cronLidarrPull ?? '35 */6 * * *',
    lidarrPullTarget: (s.lidarrPullTarget as any) || 'both',

    // Ручной push по кнопке
    pushTarget: (s.pushTarget as any) || 'artists',

    // Дефолты добавления
    rootFolderPath: s.rootFolderPath ?? '/music',
    qualityProfileId: s.qualityProfileId ?? 1,
    metadataProfileId: s.metadataProfileId ?? 1,
    monitor: s.monitor ?? 'all',

    // Custom
    cronCustomMatch: s.cronCustomMatch ?? '0 0 * * *',
    cronCustomPush:  s.cronCustomPush  ?? '0 12 * * *',

    // Backup
    backupEnabled: !!s.backupEnabled,
    backupCron: s.backupCron ?? '0 3 * * *',
    backupDir: s.backupDir ?? '/app/data/backups',
    backupRetention: s.backupRetention ?? 14,

    // Уведомления
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
      await api('/api/settings', { method: 'PUT', body: settings });
      setMsg('Saved');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  async function testYandex() {
    setMsg('Testing Yandex…');
    try {
      const r = await api<any>('/api/settings/test/yandex', { method: 'POST', body: { token: settings.yandexToken || '' } });
      setMsg(r?.ok ? `Yandex OK${r.uid ? ` (uid: ${r.uid})` : ''}` : `Yandex failed: ${r?.error || 'unknown error'}`);
    } catch (e: any) { setMsg(e?.message || String(e)); }
  }

  async function testLidarr() {
    setMsg('Testing Lidarr…');
    try {
      const r = await api<any>('/api/settings/test/lidarr', {
        method: 'POST',
        body: { lidarrUrl: settings.lidarrUrl || '', lidarrApiKey: settings.lidarrApiKey || '' },
      });
      setMsg(r?.ok ? 'Lidarr OK' : `Lidarr failed: ${r?.error || 'unknown error'}`);
    } catch (e: any) { setMsg(e?.message || String(e)); }
  }

  async function listBackups() {
    try {
      const r = await api('/api/backup/list');
      setMsg(typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e: any) { setMsg(e?.message || String(e)); }
  }

  async function runBackupNow() {
    setMsg('Running backup…');
    try {
      const r = await api<any>('/api/backup/run', { method: 'POST' });
      setMsg(r?.ok ? 'Backup completed' : `Backup error: ${r?.error || 'unknown'}`);
    } catch (e: any) { setMsg(e?.message || String(e)); }
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
            <FormRow label="Driver" help="Как получать лайки ЯМузыки.">
              <select
                  className="select"
                  value={settings.yandexDriver}
                  onChange={(e) => setSettings({ ...settings, yandexDriver: e.target.value as Settings['yandexDriver'] })}
              >
                <option value="pyproxy">pyproxy</option>
                <option value="native">native</option>
              </select>
            </FormRow>
            <FormRow label="Yandex token" help="Используется только в режиме 'native'.">
              <input className="input" value={settings.yandexToken || ''} onChange={(e) => setSettings({ ...settings, yandexToken: e.target.value })} placeholder="y0_AgAAA…" />
            </FormRow>
            <FormRow label="pyProxy URL" help="Используется только в режиме 'pyproxy'.">
              <input className="input" value={settings.pyproxyUrl || ''} onChange={(e) => setSettings({ ...settings, pyproxyUrl: e.target.value })} placeholder="http://pyproxy:8080" />
            </FormRow>

            <FormRow label="Yandex pull cron" help={<><code>0 */6 * * *</code> — каждые 6 часов</>}>
              <input className="input" value={settings.cronYandexPull || ''} onChange={(e) => setSettings({ ...settings, cronYandexPull: e.target.value })} placeholder="0 */6 * * *" />
            </FormRow>

            <FormRow label="Yandex match cron" help={<><code>10 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input" value={settings.cronYandexMatch || ''} onChange={(e) => setSettings({ ...settings, cronYandexMatch: e.target.value })} placeholder="10 */6 * * *" />
                <select className="select" value={settings.yandexMatchTarget || 'both'} onChange={(e) => setSettings({ ...settings, yandexMatchTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
              </div>
            </FormRow>

            <FormRow label="Yandex push cron" help={<><code>45 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input" value={settings.cronYandexPush || ''} onChange={(e) => setSettings({ ...settings, cronYandexPush: e.target.value })} placeholder="45 */6 * * *" />
                <select className="select" value={settings.yandexPushTarget || 'both'} onChange={(e) => setSettings({ ...settings, yandexPushTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
              </div>
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testYandex}>Test Yandex</button>
            </div>
          </section>

          {/* Lidarr */}
          <section className="panel p-4 space-y-3">
            <div className="section-title">Lidarr</div>

            <FormRow label="URL" help="Базовый URL Lidarr (например http://lidarr:8686).">
              <input className="input" value={settings.lidarrUrl || ''} onChange={(e) => setSettings({ ...settings, lidarrUrl: e.target.value })} placeholder="http://localhost:8686" />
            </FormRow>
            <FormRow label="API Key" help="Настройки → General → Security → API Key в Lidarr.">
              <input className="input" value={settings.lidarrApiKey || ''} onChange={(e) => setSettings({ ...settings, lidarrApiKey: e.target.value })} placeholder="xxxxxxxxxxxxxxxx" />
            </FormRow>
            <FormRow label="Allow fallback without metadata" help="Разрешить создавать артистов без lookup при недоступном SkyHook.">
              <div className="control flex items-center gap-2">
                <input type="checkbox" checked={!!settings.lidarrAllowNoMetadata} onChange={(e) => setSettings({ ...settings, lidarrAllowNoMetadata: e.target.checked })} />
                <span className="text-sm text-gray-500">Create artists without metadata</span>
              </div>
            </FormRow>

            <FormRow label="Lidarr pull cron" help={<><code>35 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input" value={settings.cronLidarrPull || ''} onChange={(e) => setSettings({ ...settings, cronLidarrPull: e.target.value })} placeholder="35 */6 * * *" />
                <select className="select" value={settings.lidarrPullTarget || 'both'} onChange={(e) => setSettings({ ...settings, lidarrPullTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
              </div>
            </FormRow>

            {/* Параметры для ручного Push (кнопки на главной) */}
            <FormRow label="Manual push target" help="Кого отправлять в Lidarr при ручном пуше (кнопкой).">
              <select className="select" value={settings.pushTarget} onChange={(e) => setSettings({ ...settings, pushTarget: e.target.value as any })}>
                <option value="artists">Artists (default)</option>
                <option value="albums">Albums</option>
              </select>
            </FormRow>

            {/* Дефолты для добавления в Lidarr */}
            <div className="mt-4 border-t border-gray-200 pt-4 space-y-3">
              <div className="text-sm font-medium text-gray-400">Defaults for new items</div>

              <FormRow label="Root folder path" help="Корень библиотеки в Lidarr, например /music.">
                <input
                    className="input"
                    value={settings.rootFolderPath || ''}
                    onChange={(e) => setSettings({ ...settings, rootFolderPath: e.target.value })}
                    placeholder="/music"
                />
              </FormRow>

              <FormRow label="Quality profile ID" help="ID профиля качества из Lidarr.">
                <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.qualityProfileId ?? 1}
                    onChange={(e) => setSettings({ ...settings, qualityProfileId: Number(e.target.value || 1) })}
                    placeholder="1"
                />
              </FormRow>

              <FormRow label="Metadata profile ID" help="ID метадата-профиля из Lidarr.">
                <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.metadataProfileId ?? 1}
                    onChange={(e) => setSettings({ ...settings, metadataProfileId: Number(e.target.value || 1) })}
                    placeholder="1"
                />
              </FormRow>

              <FormRow label="Monitor policy" help="Что мониторить у артиста при добавлении. Обычно 'all'.">
                <select
                    className="select"
                    value={settings.monitor || 'all'}
                    onChange={(e) => setSettings({ ...settings, monitor: e.target.value })}
                >
                  <option value="all">all</option>
                  <option value="none">none</option>
                </select>
              </FormRow>
            </div>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testLidarr}>Test Lidarr</button>
            </div>
          </section>

          {/* Custom */}
          <section className="panel p-4 space-y-3">
            <div className="section-title">Custom</div>
            <FormRow label="Custom match cron"  help={<><code>0 0 * * *</code> — Раз в день в 00:00 </>}>
              <input className="input" value={settings.cronCustomMatch || ''} onChange={(e) => setSettings({ ...settings, cronCustomMatch: e.target.value })} placeholder="0 0 * * *" />
            </FormRow>
            <FormRow label="Custom push cron"  help={<><code>0 12 * * *</code> — Раз в день в 12:00 </>}>
              <input className="input" value={settings.cronCustomPush || ''} onChange={(e) => setSettings({ ...settings, cronCustomPush: e.target.value })} placeholder="0 12 * * *" />
            </FormRow>
          </section>

          {/* Backup */}
          <section className="panel p-4 space-y-3">
            <div className="text-sm font-medium text-gray-400">Backup</div>
            <FormRow label="Enable">
              <div className="control flex items-center gap-2">
                <input type="checkbox" checked={!!settings.backupEnabled} onChange={(e) => setSettings({ ...settings, backupEnabled: e.target.checked })} />
                <span className="text-sm text-gray-500">Enable scheduled backups</span>
              </div>
            </FormRow>
            <FormRow label="Cron" help={<><code>0 3 * * *</code> — Раз в день в 03:00 </>} ><input className="input" value={settings.backupCron || ''} onChange={(e) => setSettings({ ...settings, backupCron: e.target.value })} placeholder="0 3 * * *" /></FormRow>
            <FormRow label="Directory"><input className="input" value={settings.backupDir || ''} onChange={(e) => setSettings({ ...settings, backupDir: e.target.value })} placeholder="/app/data/backups" /></FormRow>
            <FormRow label="Retention"><input className="input" type="number" min={0} value={settings.backupRetention ?? 0} onChange={(e) => setSettings({ ...settings, backupRetention: Number(e.target.value || 0) })} placeholder="14" /></FormRow>
            <div className="toolbar">
              <button className="btn btn-outline" onClick={listBackups}>List backups</button>
              <button className="btn btn-primary" onClick={runBackupNow}>Run backup now</button>
            </div>
          </section>

          <div className="toolbar">
            <button className="btn btn-primary" onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save settings'}</button>
          </div>
        </main>
      </>
  );
}
