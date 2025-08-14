import { Router } from 'express';

import { prisma } from '../prisma';
import { reloadJobs } from '../scheduler';
import { yandexVerifyToken, setPyproxyUrl } from '../services/yandex';

const r = Router();

// ← Оставляем ALLOWED_FIELDS, но поправим комментарий:
const ALLOWED_FIELDS = new Set([
  // yandex
  'yandexToken',
  'yandexDriver',
  'pyproxyUrl',
  'yandexCron',

  // lidarr
  'lidarrUrl',
  'lidarrApiKey',
  'pushTarget',
  'lidarrCron',

  // backup
  'backupEnabled',
  'backupCron',
  'backupRetention',
  'backupDir',

  // notifications
  'notifyType', // 'disabled' | 'telegram' | 'webhook'
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
  if ('yandexDriver' in out) {
    const v = String(out.yandexDriver || '').toLowerCase();
    out.yandexDriver = v === 'native' ? 'native' : 'pyproxy';
  }
  if ('pushTarget' in out) {
    const v = String(out.pushTarget || '').toLowerCase();
    out.pushTarget = v === 'albums' ? 'albums' : 'artists';
  }
  if ('backupEnabled' in out) {
    out.backupEnabled = !!out.backupEnabled;
  }
  if ('backupRetention' in out && out.backupRetention != null) {
    const n = parseInt(String(out.backupRetention), 10);
    if (!Number.isFinite(n) || n < 1) delete out.backupRetention;
    else out.backupRetention = n;
  }
  if ('notifyType' in out) {
    // приводим к тем же значениям, что ждёт фронт
    const v = String(out.notifyType || '').toLowerCase();
    out.notifyType = ['telegram', 'webhook', 'disabled'].includes(v) ? v : 'disabled';
  }
  if ('pyproxyUrl' in out && typeof out.pyproxyUrl === 'string') {
    out.pyproxyUrl = out.pyproxyUrl.replace(/\/+$/, '');
  }
  if ('lidarrUrl' in out && typeof out.lidarrUrl === 'string') {
    out.lidarrUrl = out.lidarrUrl.replace(/\/+$/, '');
  }

  return out;
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

  // бэк-компат: если в БД лежит 'none', отдадим 'disabled'
  if (s && s.notifyType === 'none') s.notifyType = 'disabled';

  res.json(s || {});
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

// POST /api/settings/test/lidarr  { lidarrUrl?: string, lidarrApiKey?: string }
r.post('/test/lidarr', async (req, res) => {
  try {
    const body = req.body || {};
    let lidarrUrl = (typeof body.lidarrUrl === 'string' && body.lidarrUrl) || undefined;
    let lidarrApiKey = (typeof body.lidarrApiKey === 'string' && body.lidarrApiKey) || undefined;

    if (!lidarrUrl || !lidarrApiKey) {
      const s = await prisma.setting.findFirst({ where: { id: 1 } });
      lidarrUrl = lidarrUrl || s?.lidarrUrl || undefined;
      lidarrApiKey = lidarrApiKey || s?.lidarrApiKey || undefined;
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
    res.json({ ok, status: r2.statusCode, data });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

r.post('/', saveSettingsHandler);
r.put('/', saveSettingsHandler);

// остальное (test/yandex, test/lidarr) — без изменений
export default r;
