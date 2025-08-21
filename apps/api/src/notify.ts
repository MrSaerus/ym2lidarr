// apps/api/src/notify.ts
import { request } from 'undici';
import { prisma } from './prisma';

type Kind = 'yandex' | 'lidarr' | 'export' | 'match';
type Status = 'ok' | 'error';

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function makeTelegramMessage(kind: Kind, status: Status, stats: any) {
  const header = `Sync ${kind}: <b>${status.toUpperCase()}</b>`;
  let payload = '';
  try {
    if (stats != null) {
      const s = typeof stats === 'string' ? stats : JSON.stringify(stats, null, 2);
      payload = `\n<pre>${escapeHtml(s)}</pre>`;
    }
  } catch {}
  return `${header}${payload}`;
}

export async function notify(kind: Kind, status: Status, stats: any) {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });

  // нормализуем тип: поддерживаем legacy 'none'
  const rawType = (s?.notifyType || 'disabled').toLowerCase();
  const type = rawType === 'none' ? 'disabled' : rawType;

  if (type === 'disabled') return;

  try {
    if (type === 'telegram' && s?.telegramBot && s?.telegramChatId) {
      const url = `https://api.telegram.org/bot${s.telegramBot}/sendMessage`;
      const body = {
        chat_id: s.telegramChatId,
        text: makeTelegramMessage(kind, status, stats),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      console.log('[notify] telegram ok');
      return;
    }

    if (type === 'webhook' && s?.webhookUrl) {
      const payload = {
        kind,
        status,
        stats,
        ts: new Date().toISOString(),
      };
      await request(s.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(s.webhookSecret ? { 'X-Webhook-Secret': s.webhookSecret } : {}),
        },
        body: JSON.stringify(payload),
      });
      console.log('[notify] webhook ok');
      return;
    }

    console.log('[notify] skipped: misconfigured settings for type:', type);
  } catch (e: any) {
    console.warn('[notify] failed:', e?.message || e);
  }
}
