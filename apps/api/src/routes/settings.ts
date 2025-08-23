// apps/api/src/routes/settings.ts
import { Router } from 'express';

import { prisma } from '../prisma';
import { reloadJobs, getCronStatuses } from '../scheduler';
import { yandexVerifyToken, setPyproxyUrl } from '../services/yandex';
import { getRootFolders, getQualityProfiles, getMetadataProfiles } from '../services/lidarr';

const r = Router();

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
]);



function pickSettings(input: any) {
  const out: any = {};
  if (!input || typeof input !== 'object') return out;

  for (const k of Object.keys(input)) {
    if (ALLOWED_FIELDS.has(k)) (out as any)[k] = (input as any)[k];
  }

  // нормализации
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
  ].forEach((k) => { if (k in out) out[k] = !!out[k]; });

  if ('backupRetention' in out && out.backupRetention != null) {
    const n = parseInt(String(out.backupRetention), 10);
    if (!Number.isFinite(n) || n < 1) delete out.backupRetention;
    else out.backupRetention = n;
  }
  if ('notifyType' in out) {
    const v = String(out.notifyType || '').toLowerCase();
    out.notifyType = ['telegram', 'webhook', 'none', 'disabled'].includes(v) ? (v === 'disabled' ? 'none' : v) : 'none';
  }
  if ('pyproxyUrl' in out && typeof out.pyproxyUrl === 'string') {
    out.pyproxyUrl = out.pyproxyUrl.replace(/\/+$/, '');
  }
  if ('lidarrUrl' in out && typeof out.lidarrUrl === 'string') {
    out.lidarrUrl = out.lidarrUrl.replace(/\/+$/, '');
  }
  if ('rootFolderPath' in out && typeof out.rootFolderPath === 'string') {
    out.rootFolderPath = out.rootFolderPath.replace(/\/+$/, '');
  }
  if ('qualityProfileId' in out && out.qualityProfileId != null) {
    const n = parseInt(String(out.qualityProfileId), 10);
    if (Number.isFinite(n)) out.qualityProfileId = n; else delete out.qualityProfileId;
  }
  if ('metadataProfileId' in out && out.metadataProfileId != null) {
    const n = parseInt(String(out.metadataProfileId), 10);
    if (Number.isFinite(n)) out.metadataProfileId = n; else delete out.metadataProfileId;
  }
  if ('monitor' in out) {
    const v = String(out.monitor || '').toLowerCase();
    out.monitor = ['all', 'future', 'none'].includes(v) ? v : 'all';
  }

  return out;
}

// ===== helpers =====

function sanitizePath(p?: string | null) {
  return String(p || '').replace(/\/+$/, '');
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
  const data = pickSettings(req.body);

  const saved = await prisma.setting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: { ...data },
  });

  setPyproxyUrl(saved.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
  await reloadJobs();

  res.json({ ok: true });
}

// GET /api/settings
r.get('/', async (_req, res) => {
  const s: any = await prisma.setting.findFirst({ where: { id: 1 } });
  res.json(s || {});
});

// GET /api/settings/scheduler
r.get('/scheduler', async (_req, res) => {
  try {
    const jobs = await getCronStatuses();
    res.json({ ok: true, jobs });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/settings/test/yandex  { token?: string }
r.post('/test/yandex', async (req, res) => {
  try {
    const body = req.body || {};
    let token: string | undefined =
        typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined;

    if (!token) {
      const s = await prisma.setting.findFirst({ where: { id: 1 } });
      token = s?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN || undefined;
    }
    if (!token) return res.status(400).json({ ok: false, error: 'No Yandex token' });

    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    setPyproxyUrl(s?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');

    const resp = await yandexVerifyToken(token);
    res.json(resp);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/settings/test/lidarr
// ТЕПЕРЬ: при успешном коннекте подбираем дефолтные root/profile и,
// если поля ещё пустые — сохраняем их в БД.
r.post('/test/lidarr', async (req, res) => {
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
      return res.status(400).json({ ok: false, error: 'No Lidarr URL or API key' });
    }

    const base = lidarrUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/system/status`;

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

      if (Object.keys(needUpdate).length > 0) {
        const saved = await prisma.setting.upsert({
          where: { id: 1 },
          create: { id: 1, lidarrUrl: base, lidarrApiKey, ...needUpdate },
          update: { lidarrUrl: base, lidarrApiKey, ...needUpdate },
        });
        applied = needUpdate;
        appliedCount = Object.keys(needUpdate).length;

        // Перезапускаем джобы (на случай, если monitor/profile влияют)
        await reloadJobs();
      }
    }

    res.json({ ok, status: r2.statusCode, data, defaults, applied, appliedCount });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/settings/lidarr/defaults  { overwrite?: boolean }
// Ручное подтягивание дефолтов и сохранение (по желанию — с перезаписью).
r.post('/lidarr/defaults', async (req, res) => {
  try {
    const body = req.body || {};
    const overwrite = !!body.overwrite;

    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const lidarrUrl = s?.lidarrUrl?.replace(/\/+$/, '');
    const lidarrApiKey = s?.lidarrApiKey || '';

    if (!lidarrUrl || !lidarrApiKey) {
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

    res.json({ ok: true, defaults: d, applied: update, appliedCount });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/settings — сохранить
r.post('/', saveSettingsHandler);

// PUT /api/settings — тоже сохранить
r.put('/', saveSettingsHandler);

export default r;
