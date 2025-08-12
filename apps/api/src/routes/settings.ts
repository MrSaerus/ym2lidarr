import { Router } from 'express';
import { request } from 'undici';

import { prisma } from '../prisma';
import { reloadJobs } from '../scheduler';
import { yandexVerifyToken, setPyproxyUrl } from '../services/yandex';

const r = Router();

// список полей, которые мы принимаем/сохраняем в Setting
const ALLOWED_FIELDS = new Set([
  // yandex
  'yandexToken',
  'yandexDriver', // 'pyproxy' | 'native'
  'pyproxyUrl',
  'yandexCron',

  // lidarr
  'lidarrUrl',
  'lidarrApiKey',
  'pushTarget', // 'artists' | 'albums'
  'lidarrCron',

  // backup
  'backupEnabled',
  'backupCron',
  'backupRetention',
  'backupDir',

  // notifications
  'notifyType', // 'none' | 'telegram' | 'webhook'
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

  // нормализация отдельных полей
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
    const v = String(out.notifyType || '').toLowerCase();
    out.notifyType = ['telegram', 'webhook'].includes(v) ? v : 'none';
  }
  if ('pyproxyUrl' in out && typeof out.pyproxyUrl === 'string') {
    out.pyproxyUrl = out.pyproxyUrl.replace(/\/+$/, '');
  }
  if ('lidarrUrl' in out && typeof out.lidarrUrl === 'string') {
    out.lidarrUrl = out.lidarrUrl.replace(/\/+$/, '');
  }

  return out;
}

// GET /api/settings — получить текущие настройки
r.get('/', async (_req, res) => {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  res.json(s || {});
});

// POST /api/settings — сохранить настройки
r.post('/', async (req, res) => {
  const data = pickSettings(req.body);

  // гарантируем единственную запись id=1
  const saved = await prisma.setting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: { ...data },
  });

  // сразу обновим pyproxy URL в сервисе и пересоздадим cron-задачи
  setPyproxyUrl(saved.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
  await reloadJobs();

  res.json({ ok: true });
});

// POST /api/settings/test/yandex  { token?: string }
// если token не передан — берём из БД/ENV; проверяем через pyproxy (если задан) или нативно
r.post('/test/yandex', async (req, res) => {
  try {
    const body = req.body || {};
    let token: string | undefined =
      typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined;

    if (!token) {
      const s = await prisma.setting.findFirst({ where: { id: 1 } });
      token = s?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN || undefined;
    }
    if (!token) {
      res.status(400).json({ ok: false, error: 'No Yandex token' });
      return;
    }

    // убедимся, что драйвер/pyproxyUrl актуальны
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    setPyproxyUrl(s?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
    // сам тест
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
      res.status(400).json({ ok: false, error: 'No Lidarr URL or API key' });
      return;
    }

    const base = lidarrUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/system/status`;
    const r2 = await request(url, {
      method: 'GET',
      headers: { 'X-Api-Key': lidarrApiKey },
    });

    const text = await r2.body.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    const ok = r2.statusCode >= 200 && r2.statusCode < 300;
    res.json({ ok, status: r2.statusCode, data });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;
