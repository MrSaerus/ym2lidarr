// apps/web/pages/settings.tsx
import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import FormRow from '../components/FormRow';
import { toastOk, toastWarn, toastErr } from '../lib/toast';

type Settings = {
  // Yandex Music
  yandexDriver: 'pyproxy' | 'native';
  yandexToken?: string | null;
  pyproxyUrl?: string | null;

  // Расписания + таргеты + enable
  cronYandexPull?: string | null;
  enableCronYandexPull?: boolean | null;

  cronYandexMatch?: string | null;
  enableCronYandexMatch?: boolean | null;
  yandexMatchTarget?: 'both'|'artists'|'albums';

  cronYandexPush?: string | null;
  enableCronYandexPush?: boolean | null;
  yandexPushTarget?: 'both'|'artists'|'albums';

  // Lidarr
  lidarrUrl?: string | null;
  lidarrApiKey?: string | null;
  lidarrAllowNoMetadata?: boolean | null;

  // Lidarr pull + enable
  cronLidarrPull?: string | null;
  enableCronLidarrPull?: boolean | null;
  lidarrPullTarget?: 'both'|'artists'|'albums';

  // Manual push
  pushTarget: 'artists' | 'albums';

  // Defaults
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null;

  // Custom + enable
  cronCustomMatch?: string | null;
  enableCronCustomMatch?: boolean | null;

  cronCustomPush?: string | null;
  enableCronCustomPush?: boolean | null;

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

  // qBittorrent
  qbtUrl?: string | null;
  qbtUser?: string | null;
  qbtPass?: string | null;
  qbtDeleteFiles?: boolean | null;
  qbtWebhookSecret?: string | null;
};


function withDefaults(x: Partial<Settings> | null | undefined): Settings {
  const s = x || {};
  return {
    yandexDriver: (s.yandexDriver as any) || 'pyproxy',
    yandexToken: s.yandexToken ?? '',
    pyproxyUrl: s.pyproxyUrl ?? 'http://pyproxy:8080',

    cronYandexPull:  s.cronYandexPull  ?? '0 */6 * * *',
    enableCronYandexPull: s.enableCronYandexPull ?? true,

    cronYandexMatch: s.cronYandexMatch ?? '10 */6 * * *',
    enableCronYandexMatch: s.enableCronYandexMatch ?? false,
    yandexMatchTarget: (s.yandexMatchTarget as any) || 'both',

    cronYandexPush:  s.cronYandexPush  ?? '45 */6 * * *',
    enableCronYandexPush: s.enableCronYandexPush ?? false,
    yandexPushTarget:  (s.yandexPushTarget  as any) || 'both',

    lidarrUrl: s.lidarrUrl ?? 'http://localhost:8686',
    lidarrApiKey: s.lidarrApiKey ?? '',
    lidarrAllowNoMetadata: !!s.lidarrAllowNoMetadata,

    cronLidarrPull:  s.cronLidarrPull ?? '35 */6 * * *',
    enableCronLidarrPull: s.enableCronLidarrPull ?? true,
    lidarrPullTarget: (s.lidarrPullTarget as any) || 'both',

    pushTarget: (s.pushTarget as any) || 'artists',

    rootFolderPath: s.rootFolderPath ?? '/music',
    qualityProfileId: s.qualityProfileId ?? 1,
    metadataProfileId: s.metadataProfileId ?? 1,
    monitor: s.monitor ?? 'all',

    cronCustomMatch: s.cronCustomMatch ?? '0 0 * * *',
    enableCronCustomMatch: s.enableCronCustomMatch ?? false,

    cronCustomPush:  s.cronCustomPush  ?? '0 12 * * *',
    enableCronCustomPush: s.enableCronCustomPush ?? false,

    backupEnabled: !!s.backupEnabled,
    backupCron: s.backupCron ?? '0 3 * * *',
    backupDir: s.backupDir ?? '/app/data/backups',
    backupRetention: s.backupRetention ?? 14,

    notifyType: (s.notifyType as any) || 'disabled',
    telegramBot: s.telegramBot ?? '',
    telegramChatId: s.telegramChatId ?? '',
    webhookUrl: s.webhookUrl ?? '',

    qbtUrl: s.qbtUrl ?? 'http://qbittorrent:8080',
    qbtUser: s.qbtUser ?? 'admin',
    qbtPass: s.qbtPass ?? '',
    qbtDeleteFiles: s.qbtDeleteFiles ?? true,
    qbtWebhookSecret: s.qbtWebhookSecret ?? '',
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(withDefaults(undefined));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);

  type StartRunRes = { started?: boolean; runId?: number; ok?: boolean; error?: string };

  useEffect(() => {
    if (!msg || !msg.trim()) return;
    // простой маппинг тона: ошибки → красный, "процессы" → жёлтый, остальное → зелёный
    if (/(error|failed|ошибка)/i.test(msg))      toastErr(msg);
    else if (/(saving|testing|running|запускаю)/i.test(msg)) toastWarn(msg, 2500);
    else                                          toastOk(msg);
  }, [msg]);

  async function forceSearchAllArtists() {
    setMsg('Запускаю массовый поиск в Lidarr…');
    setRunning(true);
    try {
      // если твой api-клиент сам префиксит /api — оставь как '/lidarr/search-artists'
      // иначе используй '/api/lidarr/search-artists'
      const r = await api<StartRunRes>('/api/lidarr/search-artists', {
        method: 'POST',
        body: { delayMs: 150 },
      });

      const started = r?.started ?? r?.ok ?? false;
      const runId = r?.runId ?? null;

      if (started) {
        setLastRun(runId);
        setMsg(runId
          ? `Стартовал ArtistSearch для всех артистов (runId=${runId}).`
          : 'Стартовал ArtistSearch для всех артистов.');
      } else {
        setMsg(`Не удалось стартовать: ${r?.error || 'неизвестная ошибка'}`);
      }
    } catch (e: any) {
      const m = String(e?.message || e);
      // часто при занятой системе сервер отдаёт 409 → приведём к понятному тексту
      setMsg(/409|Busy/i.test(m) ? 'Сейчас занято: уже идёт другой запуск.' : `Ошибка: ${m}`);
    } finally {
      setRunning(false);
    }
  }

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
      toastOk('Settings saved');           // адресный зелёный тост
    } catch (e: any) {
      const m = e?.message || String(e);
      setMsg(m);
      toastErr(`Save failed: ${m}`);       // адресный красный тост
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
      const ok = !!r?.ok;
      setMsg(ok ? 'Lidarr OK' : `Lidarr failed: ${r?.error || 'unknown error'}`);
      ok ? toastOk('Lidarr OK') : toastErr(`Lidarr failed: ${r?.error || 'unknown error'}`);
    } catch (e: any) {
      const m = e?.message || String(e);
      setMsg(m);
      toastErr(`Lidarr error: ${m}`);
    }
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

  async function testQbt() {
    setMsg('Testing qBittorrent…');
    try {
      const r = await api<any>('/api/settings/test/qbt', { method: 'POST' });
      setMsg(r?.ok ? `qBittorrent OK (webApi: ${r.webApi || 'unknown'})` : `qBittorrent failed: ${r?.error || 'unknown'}`);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  }

  return (
      <>
        <Nav />
        <main className="mx-auto max-w-4xl px-4 py-4 space-y-6">
          <h1 className="h1">Settings</h1>

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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-2" value={settings.cronYandexPull || ''} onChange={(e) => setSettings({ ...settings, cronYandexPull: e.target.value })} placeholder="0 */6 * * *" />
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronYandexPull} onChange={(e) => setSettings({ ...settings, enableCronYandexPull: e.target.checked })}/>
                  Enabled
                </label>
              </div>
            </FormRow>

            <FormRow label="Yandex match cron" help={<><code>10 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-1" value={settings.cronYandexMatch || ''} onChange={(e) => setSettings({ ...settings, cronYandexMatch: e.target.value })} placeholder="10 */6 * * *" />
                <select className="select md:col-span-1" value={settings.yandexMatchTarget || 'both'} onChange={(e) => setSettings({ ...settings, yandexMatchTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronYandexMatch} onChange={(e) => setSettings({ ...settings, enableCronYandexMatch: e.target.checked })}/>
                  Enabled
                </label>
              </div>
            </FormRow>

            <FormRow label="Yandex push cron" help={<><code>45 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-1" value={settings.cronYandexPush || ''} onChange={(e) => setSettings({ ...settings, cronYandexPush: e.target.value })} placeholder="45 */6 * * *" />
                <select className="select md:col-span-1" value={settings.yandexPushTarget || 'both'} onChange={(e) => setSettings({ ...settings, yandexPushTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronYandexPush} onChange={(e) => setSettings({ ...settings, enableCronYandexPush: e.target.checked })}/>
                  Enabled
                </label>
              </div>
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testYandex}>Test Yandex</button>
            </div>
          </section>

          {/* Lidarr */}
          <section className="panel p-4 space-y-3">
            <div className="section-title">Lidarr</div>
            <button
              className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
              onClick={forceSearchAllArtists}
              disabled={running}
              title="Запустить ArtistSearch для всех артистов в Lidarr"
            >
              {running ? 'Запускаю…' : 'Искать по торрентам — все артисты'}
            </button>

            <div className="mt-3 text-sm text-gray-700">
              {msg}
              {lastRun ? (
                <div className="mt-1">
                  runId: <span className="font-mono">{lastRun}</span>
                </div>
              ) : null}
            </div>
            <FormRow label="URL" help="Базовый URL Lidarr (например http://lidarr:8686).">
              <input className="input" value={settings.lidarrUrl || ''}
                     onChange={(e) => setSettings({ ...settings, lidarrUrl: e.target.value })}
                     placeholder="http://localhost:8686" />
            </FormRow>
            <FormRow label="API Key" help="Настройки → General → Security → API Key в Lidarr.">
              <input className="input" value={settings.lidarrApiKey || ''}
                     onChange={(e) => setSettings({ ...settings, lidarrApiKey: e.target.value })}
                     placeholder="xxxxxxxxxxxxxxxx" />
            </FormRow>
            <FormRow label="Allow fallback without metadata"
                     help="Разрешить создавать артистов без lookup при недоступном SkyHook.">
              <div className="control flex items-center gap-2">
                <input type="checkbox" checked={!!settings.lidarrAllowNoMetadata}
                       onChange={(e) => setSettings({ ...settings, lidarrAllowNoMetadata: e.target.checked })} />
                <span className="text-sm text-gray-500">Create artists without metadata</span>
              </div>
            </FormRow>

            <FormRow label="Lidarr pull cron" help={<><code>35 */6 * * *</code> — каждые 6 часов</>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-1" value={settings.cronLidarrPull || ''}
                       onChange={(e) => setSettings({ ...settings, cronLidarrPull: e.target.value })}
                       placeholder="35 */6 * * *" />
                <select className="select md:col-span-1" value={settings.lidarrPullTarget || 'both'}
                        onChange={(e) => setSettings({ ...settings, lidarrPullTarget: e.target.value as any })}>
                  <option value="both">both</option>
                  <option value="artists">artists</option>
                  <option value="albums">albums</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronLidarrPull}
                         onChange={(e) => setSettings({ ...settings, enableCronLidarrPull: e.target.checked })} />
                  Enabled
                </label>
              </div>
            </FormRow>

            {/* Параметры для ручного Push (кнопки на главной) */}
            <FormRow label="Manual push target" help="Кого отправлять в Lidarr при ручном пуше (кнопкой).">
              <select className="select" value={settings.pushTarget}
                      onChange={(e) => setSettings({ ...settings, pushTarget: e.target.value as any })}>
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
            <FormRow label="Custom match cron" help={<><code>0 0 * * *</code> — Раз в день в 00:00 </>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-2" value={settings.cronCustomMatch || ''}
                       onChange={(e) => setSettings({ ...settings, cronCustomMatch: e.target.value })}
                       placeholder="0 0 * * *" />
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronCustomMatch} onChange={(e) => setSettings({ ...settings, enableCronCustomMatch: e.target.checked })}/>
                  Enabled
                </label>
              </div>
            </FormRow>
            <FormRow label="Custom push cron"  help={<><code>0 12 * * *</code> — Раз в день в 12:00 </>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="input md:col-span-2" value={settings.cronCustomPush || ''} onChange={(e) => setSettings({ ...settings, cronCustomPush: e.target.value })} placeholder="0 12 * * *" />
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={!!settings.enableCronCustomPush} onChange={(e) => setSettings({ ...settings, enableCronCustomPush: e.target.checked })}/>
                  Enabled
                </label>
              </div>
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

          {/* qBittorrent */}
          <section className="panel p-4 space-y-3">
            <div className="section-title">qBittorrent</div>

            <FormRow label="URL" help="Базовый URL qBittorrent WebUI (без хвостового /).">
              <input className="input" value={settings.qbtUrl || ''} onChange={(e) => setSettings({ ...settings, qbtUrl: e.target.value })} placeholder="http://qbittorrent:8080" />
            </FormRow>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <FormRow label="Username">
                <input className="input" value={settings.qbtUser || ''} onChange={(e) => setSettings({ ...settings, qbtUser: e.target.value })} placeholder="admin" />
              </FormRow>
              <FormRow label="Password">
                <input className="input" type="password" value={settings.qbtPass || ''} onChange={(e) => setSettings({ ...settings, qbtPass: e.target.value })} placeholder="••••••••" />
              </FormRow>
            </div>

            <FormRow label="Delete mode" help="Удалять только торрент или также файлы после импорта.">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={!!settings.qbtDeleteFiles} onChange={(e) => setSettings({ ...settings, qbtDeleteFiles: e.target.checked })} />
                <span>Delete data files too</span>
              </label>
            </FormRow>

            <FormRow label="Webhook secret" help={<>Секрет для <code>{settings.qbtUrl}/api/webhooks/lidarr?secret=…</code></>}>
              <div className="flex gap-2">
                <input className="input flex-1" value={settings.qbtWebhookSecret || ''} onChange={(e) => setSettings({ ...settings, qbtWebhookSecret: e.target.value })} placeholder="(optional)" />
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => {
                    const arr = new Uint8Array(16);
                    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(arr);
                    else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
                    const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
                    setSettings({ ...settings, qbtWebhookSecret: hex });
                  }}
                >
                  Generate
                </button>
              </div>
            </FormRow>

            <div className="toolbar">
              <button className="btn btn-outline" onClick={testQbt}>Test qBittorrent</button>
            </div>
          </section>

          <div className="toolbar">
            <button className="btn btn-primary" onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save settings'}</button>
          </div>
        </main>
      </>
  );
}
