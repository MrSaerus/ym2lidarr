// apps/api/src/routes/settings.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { prisma } from '../prisma';
import { reloadJobs, getCronStatuses } from '../scheduler';
import { yandexVerifyToken, setPyproxyUrl } from '../services/yandex';
import { getRootFolders, getQualityProfiles, getMetadataProfiles } from '../services/lidarr';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.settings' });

function stripTrailingSlashes(s?: string | null): string {
  const str = String(s ?? '');
  let i = str.length;
  while (i > 0 && str.charCodeAt(i - 1) === 47 /* '/' */) i--;
  return str.slice(0, i);
}

function withTrailingSlash(s: string): string {
  const base = stripTrailingSlashes(s);
  return base ? base + '/' : '/';
}

function joinUrl(base: string, path: string): string {
  // path ожидаем без ведущего слэша
  return new URL(path, withTrailingSlash(base)).toString();
}

// Rate limiter: limit /test/yandex to 5 requests per minute per IP
const testYandexLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,              // limit each IP to 5 requests per windowMs
  message: { ok: false, error: 'Too many requests, please try again later.' },
});

// Разрешённые поля настроек (только новые имена)
const ALLOWED_FIELDS = new Set([
  // yandex
  'yandexToken',
  'yandexDriver',
  'pyproxyUrl',

  // расписания и флаги
  'cronYandexPull',
  'enableCronYandexPull',
  'cronYandexMatch',
  'enableCronYandexMatch',
  'cronYandexPush',
  'enableCronYandexPush',
  'yandexMatchTarget',
  'yandexPushTarget',

  // lidarr
  'lidarrUrl',
  'lidarrApiKey',
  'pushTarget',
  'lidarrAllowNoMetadata',

  // lidarr pull
  'cronLidarrPull',
  'enableCronLidarrPull',
  'lidarrPullTarget',

  // custom
  'cronCustomMatch',
  'enableCronCustomMatch',
  'cronCustomPush',
  'enableCronCustomPush',

  // СТАРОЕ (совместимость)
  'cronYandex',
  'cronLidarr',
  'yandexCron',
  'lidarrCron',

  // lidarr defaults
  'rootFolderPath',
  'qualityProfileId',
  'metadataProfileId',
  'monitor',

  // behaviour
  'mode',
  'enableExport',
  'enablePush',
  'exportPath',

  // backup
  'backupEnabled',
  'backupCron',
  'backupRetention',
  'backupDir',

  // notifications
  'notifyType',
  'telegramBot',
  'telegramChatId',
  'webhookUrl',
  'webhookSecret',

  'allowRepush',
  'matchRetryDays',

  // qBittorrent
  'qbtUrl',
  'qbtUser',
  'qbtPass',
  'qbtDeleteFiles',
  'qbtWebhookSecret',

  // Navidrome
  'navidromeUrl',
  'navidromeUser',
  'navidromePass',
  'navidromeToken',
  'navidromeSalt',
  'navidromeSyncTarget',            // 'artists' | 'albums' | 'tracks' | 'all'
  'likesPolicySourcePriority',      // 'yandex' | 'navidrome'
  'cronNavidromePush',
  'enableCronNavidromePush',
]);

function trimToNull(v: unknown): string | null {
  if (typeof v !== 'string') return v == null ? null : String(v);
  const t = v.trim();
  return t.length ? t : null;
}

function pickSettings(input: any) {
  const out: any = {};
  if (!input || typeof input !== 'object') return out;

  for (const k of Object.keys(input)) {
    if (ALLOWED_FIELDS.has(k)) (out as any)[k] = (input as any)[k];
  }

  if ('yandexMatchTarget' in out) {
    const v = String(out.yandexMatchTarget || '').toLowerCase();
    out.yandexMatchTarget = ['artists','albums','both'].includes(v) ? v : 'both';
  }
  if ('yandexPushTarget' in out) {
    const v = String(out.yandexPushTarget || '').toLowerCase();
    out.yandexPushTarget = ['artists','albums','both'].includes(v) ? v : 'both';
  }
  if ('lidarrPullTarget' in out) {
    const v = String(out.lidarrPullTarget || '').toLowerCase();
    out.lidarrPullTarget = ['artists','albums','both'].includes(v) ? v : 'both';
  }
  if ('yandexDriver' in out) {
    const v = String(out.yandexDriver || '').toLowerCase();
    out.yandexDriver = v === 'native' ? 'native' : 'pyproxy';
  }
  if ('pushTarget' in out) {
    const v = String(out.pushTarget || '').toLowerCase();
    out.pushTarget = v === 'albums' ? 'albums' : 'artists';
  }
  if ('mode' in out) {
    const v = String(out.mode || '').toLowerCase();
    out.mode = v === 'albums' ? 'albums' : 'artists';
  }

  // bools
  [
    'lidarrAllowNoMetadata',
    'backupEnabled',
    'enableCronYandexPull',
    'enableCronYandexMatch',
    'enableCronYandexPush',
    'enableCronCustomMatch',
    'enableCronCustomPush',
    'enableCronLidarrPull',
    'allowRepush',
    'qbtDeleteFiles',
  ].forEach((k) => { if (k in out) out[k] = !!out[k]; });

  // URL/пути
  if ('qbtUrl' in out && typeof out.qbtUrl === 'string') {
    out.qbtUrl = stripTrailingSlashes(out.qbtUrl);
  }
  if ('pyproxyUrl' in out && typeof out.pyproxyUrl === 'string') {
    out.pyproxyUrl = stripTrailingSlashes(out.pyproxyUrl);
  }
  if ('lidarrUrl' in out && typeof out.lidarrUrl === 'string') {
    out.lidarrUrl = stripTrailingSlashes(out.lidarrUrl);
  }
  if ('rootFolderPath' in out && typeof out.rootFolderPath === 'string') {
    out.rootFolderPath = stripTrailingSlashes(out.rootFolderPath);
  }

  // числовые
  if ('backupRetention' in out && out.backupRetention != null) {
    const n = parseInt(String(out.backupRetention), 10);
    if (!Number.isFinite(n) || n < 1) delete out.backupRetention;
    else out.backupRetention = n;
  }
  if ('qualityProfileId' in out && out.qualityProfileId != null) {
    const n = parseInt(String(out.qualityProfileId), 10);
    if (Number.isFinite(n)) out.qualityProfileId = n; else delete out.qualityProfileId;
  }
  if ('metadataProfileId' in out && out.metadataProfileId != null) {
    const n = parseInt(String(out.metadataProfileId), 10);
    if (Number.isFinite(n)) out.metadataProfileId = n; else delete out.metadataProfileId;
  }

  // enum
  if ('notifyType' in out) {
    const v = String(out.notifyType || '').toLowerCase();
    out.notifyType = ['telegram', 'webhook', 'none', 'disabled'].includes(v) ? (v === 'disabled' ? 'none' : v) : 'none';
  }
  if ('monitor' in out) {
    const v = String(out.monitor || '').toLowerCase();
    out.monitor = ['all', 'future', 'none'].includes(v) ? v : 'all';
  }

  // ===== Navidrome normalization =====
  if ('navidromeUrl' in out && typeof out.navidromeUrl === 'string') {
    const t = stripTrailingSlashes(out.navidromeUrl.trim());
    out.navidromeUrl = t || null;
  }
  if ('navidromeSyncTarget' in out) {
    const v0 = String(out.navidromeSyncTarget || '').toLowerCase();
    const v = (v0 === 'both') ? 'all' : v0;
    out.navidromeSyncTarget = ['artists','albums','tracks','all'].includes(v) ? v : null;
  }
  if ('likesPolicySourcePriority' in out && typeof out.likesPolicySourcePriority === 'string') {
    const v = out.likesPolicySourcePriority.trim().toLowerCase();
    out.likesPolicySourcePriority = ['yandex','navidrome'].includes(v) ? v : 'yandex';
  }
  if ('navidromeUser' in out)  out.navidromeUser  = trimToNull(out.navidromeUser);
  if ('navidromePass' in out)  out.navidromePass  = trimToNull(out.navidromePass);          // пустая строка -> null
  if ('navidromeToken' in out) out.navidromeToken = trimToNull(out.navidromeToken);
  if ('navidromeSalt' in out)  out.navidromeSalt  = trimToNull(out.navidromeSalt);

  return out;
}

// ===== helpers =====

function sanitizePath(p?: string | null) {
  return stripTrailingSlashes(p);
}

function toNum(x: any): number | null {
  const n = parseInt(String(x), 10);
  return Number.isFinite(n) ? n : null;
}

async function computeLidarrDefaults(s: { lidarrUrl: string; lidarrApiKey: string }) {
  const [roots, qps, mps] = await Promise.all([
    getRootFolders(s as any),
    getQualityProfiles(s as any),
    getMetadataProfiles(s as any),
  ]);

  // Выбираем root:
  // 1) если один — его
  // 2) иначе — с дефолтными профилями
  // 3) иначе — первый
  let chosenRoot: any = null;
  if (Array.isArray(roots) && roots.length) {
    if (roots.length === 1) chosenRoot = roots[0];
    else chosenRoot = roots.find((r: any) => r?.defaultQualityProfileId || r?.defaultMetadataProfileId) || roots[0];
  }

  const rootFolderPath = chosenRoot?.path ? sanitizePath(chosenRoot.path) : null;

  // Выбираем профили:
  const qpFromRoot = toNum(chosenRoot?.defaultQualityProfileId);
  const mpFromRoot = toNum(chosenRoot?.defaultMetadataProfileId);

  const qpFirst = Array.isArray(qps) && qps.length ? toNum(qps[0]?.id) : null;
  const mpFirst = Array.isArray(mps) && mps.length ? toNum(mps[0]?.id) : null;

  const qualityProfileId = qpFromRoot ?? qpFirst ?? null;
  const metadataProfileId = mpFromRoot ?? mpFirst ?? null;

  // Мониторинг по умолчанию пусть будет 'all'
  const monitor: 'all' | 'future' | 'none' = 'all';

  return { rootFolderPath, qualityProfileId, metadataProfileId, monitor };
}

// helper, чтобы не дублировать POST/PUT
async function saveSettingsHandler(req: any, res: any) {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  try {
    const data = pickSettings(req.body);

    // не затираем пароль Навидрома пустой строкой
    if ('navidromePass' in data && data.navidromePass === '') delete data.navidromePass;

    lg.info('save settings requested', 'settings.save.start', { keys: Object.keys(data) });

    const saved = await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: { ...data },
    });

    setPyproxyUrl(saved.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
    await reloadJobs();
    lg.info('settings saved and jobs reloaded', 'settings.save.done');

    res.json({ ok: true });
  } catch (e: any) {
    lg.error('save settings failed', 'settings.save.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
}

// GET /api/settings
r.get('/', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('get settings requested', 'settings.get.start');

  try {
    const s: any = await prisma.setting.findFirst({ where: { id: 1 } });
    if (!s) {
      lg.debug('no settings found', 'settings.get.empty');
      return res.json({});
    }
    const safe = { ...s };
    safe.qbtPass = '';
    safe.navidromePass = ''; // маскируем пароль Навидрома
    lg.debug('settings loaded', 'settings.get.done', { hasSettings: true });
    return res.json(safe);
  } catch (e: any) {
    lg.error('get settings failed', 'settings.get.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/scheduler
r.get('/scheduler', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('get scheduler statuses requested', 'settings.scheduler.start');

  try {
    const jobs = await getCronStatuses();
    lg.debug('scheduler statuses fetched', 'settings.scheduler.done', { count: Array.isArray(jobs) ? jobs.length : undefined });
    res.json({ ok: true, jobs });
  } catch (e: any) {
    lg.error('get scheduler statuses failed', 'settings.scheduler.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/settings/test/yandex  { token?: string }
r.post('/test/yandex', testYandexLimiter, async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('test yandex requested', 'settings.test.yandex.start');

  try {
    const body = req.body || {};
    let token: string | undefined =
      typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined;

    if (!token) {
      const s = await prisma.setting.findFirst({ where: { id: 1 } });
      token = s?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN || undefined;
    }
    if (!token) {
      lg.warn('no yandex token provided', 'settings.test.yandex.notoken');
      return res.status(400).json({ ok: false, error: 'No Yandex token' });
    }

    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    setPyproxyUrl(s?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');

    const resp = await yandexVerifyToken(token);
    lg.info('test yandex completed', 'settings.test.yandex.done', { ok: (resp as any)?.ok ?? true });
    res.json(resp);
  } catch (e: any) {
    lg.error('test yandex failed', 'settings.test.yandex.fail', { err: e?.message });
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/settings/test/lidarr
// ТЕПЕРЬ: при успешном коннекте подбираем дефолтные root/profile и,
// если поля ещё пустые — сохраняем их в БД.
r.post('/test/lidarr', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('test lidarr requested', 'settings.test.lidarr.start');

  try {
    const body = req.body || {};
    let lidarrUrl = (typeof body.lidarrUrl === 'string' && body.lidarrUrl) || undefined;
    let lidarrApiKey = (typeof body.lidarrApiKey === 'string' && body.lidarrApiKey) || undefined;

    const s0 = await prisma.setting.findFirst({ where: { id: 1 } });
    if (!lidarrUrl || !lidarrApiKey) {
      lidarrUrl = lidarrUrl || s0?.lidarrUrl || undefined;
      lidarrApiKey = lidarrApiKey || s0?.lidarrApiKey || undefined;
    }
    if (!lidarrUrl || !lidarrApiKey) {
      lg.warn('no lidarr url or api key', 'settings.test.lidarr.nocreds');
      return res.status(400).json({ ok: false, error: 'No Lidarr URL or API key' });
    }

    const base = stripTrailingSlashes(lidarrUrl);
    const url = joinUrl(base, 'api/v1/system/status');

    const { request } = await import('undici');
    const r2 = await request(url, { method: 'GET', headers: { 'X-Api-Key': lidarrApiKey } });
    const text = await r2.body.text();

    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }

    const ok = r2.statusCode >= 200 && r2.statusCode < 300;

    // Если всё ок — подтянем дефолты из Lidarr
    let defaults: any = null;
    let applied: Record<string, any> = {};
    let appliedCount = 0;

    if (ok) {
      const d = await computeLidarrDefaults({ lidarrUrl: base, lidarrApiKey });
      defaults = d;

      // Применяем, если в БД пусто
      const needUpdate: any = {};
      if (!s0?.rootFolderPath && d.rootFolderPath) needUpdate.rootFolderPath = d.rootFolderPath;
      if (!s0?.qualityProfileId && d.qualityProfileId != null) needUpdate.qualityProfileId = d.qualityProfileId;
      if (!s0?.metadataProfileId && d.metadataProfileId != null) needUpdate.metadataProfileId = d.metadataProfileId;
      if (!s0?.monitor && d.monitor) needUpdate.monitor = d.monitor;

      const raw = pickSettings(req.body);
      const data = { ...raw };
      if (raw.qbtPass === '') delete (data as any).qbtPass;

      if (Object.keys(needUpdate).length > 0) {
        await prisma.setting.upsert({
          where: { id: 1 },
          create: { id: 1, ...data },
          update: { ...data },
        });
        applied = needUpdate;
        appliedCount = Object.keys(needUpdate).length;

        // Перезапускаем джобы (на случай, если monitor/profile влияют)
        await reloadJobs();
      }
    }

    lg.info('test lidarr completed', 'settings.test.lidarr.done', { ok, status: r2.statusCode, appliedCount });
    res.json({ ok, status: r2.statusCode, data, defaults, applied, appliedCount });
  } catch (e: any) {
    log.error('test lidarr failed', 'settings.test.lidarr.fail', { err: e?.message });
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/settings/lidarr/defaults  { overwrite?: boolean }
r.post('/lidarr/defaults', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('pull lidarr defaults requested', 'settings.lidarr.defaults.start', { overwrite: !!req.body?.overwrite });

  try {
    const body = req.body || {};
    const overwrite = !!body.overwrite;

    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const lidarrUrl = s?.lidarrUrl ? stripTrailingSlashes(s.lidarrUrl) : '';
    const lidarrApiKey = s?.lidarrApiKey || '';

    if (!lidarrUrl || !lidarrApiKey) {
      lg.warn('no lidarr creds in settings', 'settings.lidarr.defaults.nocreds');
      return res.status(400).json({ ok: false, error: 'No Lidarr URL or API key in settings' });
    }

    const d = await computeLidarrDefaults({ lidarrUrl, lidarrApiKey });

    const update: any = {};
    if (overwrite || !s?.rootFolderPath)     update.rootFolderPath    = d.rootFolderPath ?? s?.rootFolderPath ?? null;
    if (overwrite || !s?.qualityProfileId)   update.qualityProfileId  = d.qualityProfileId ?? s?.qualityProfileId ?? null;
    if (overwrite || !s?.metadataProfileId)  update.metadataProfileId = d.metadataProfileId ?? s?.metadataProfileId ?? null;
    if (overwrite || !s?.monitor)            update.monitor           = d.monitor ?? s?.monitor ?? 'all';

    let appliedCount = 0;
    if (Object.keys(update).length > 0) {
      await prisma.setting.upsert({
        where: { id: 1 },
        create: { id: 1, lidarrUrl, lidarrApiKey, ...update },
        update: { ...update },
      });
      appliedCount = Object.keys(update).length;
      await reloadJobs();
    }

    lg.info('lidarr defaults applied', 'settings.lidarr.defaults.done', { appliedCount });
    res.json({ ok: true, defaults: d, applied: update, appliedCount });
  } catch (e: any) {
    lg.error('pull lidarr defaults failed', 'settings.lidarr.defaults.fail', { err: e?.message });
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

r.post('/test/qbt', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('test qbt requested', 'settings.test.qbt.start');

  try {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const base = (s?.qbtUrl || '').replace(/\/+$/, '');
    const user = s?.qbtUser || '';
    const pass = s?.qbtPass || '';

    if (!base) {
      lg.warn('qbt url is not set', 'settings.test.qbt.nourl');
      return res.status(400).json({ ok: false, error: 'qbtUrl is not set' });
    }

    // webapiVersion (без auth)
    const r1 = await fetch(`${base}/api/v2/app/webapiVersion`);
    const webApi = await r1.text();

    // login (auth)
    const r2 = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user, password: pass }),
    });
    const okLogin = r2.ok;

    lg.info('test qbt completed', 'settings.test.qbt.done', { ok: r1.ok && okLogin, webApi, loginOk: okLogin });
    res.json({ ok: r1.ok && okLogin, webApi, login: okLogin });
  } catch (e: any) {
    lg.error('test qbt failed', 'settings.test.qbt.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/settings — сохранить
r.post('/', saveSettingsHandler);

// PUT /api/settings — тоже сохранить
r.put('/', saveSettingsHandler);

export default r;
