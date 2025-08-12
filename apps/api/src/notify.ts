import { request } from 'undici';

import { prisma } from './prisma';

export async function notify(
  kind: 'yandex' | 'lidarr' | 'export',
  status: 'ok' | 'error',
  stats: any,
) {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const type = (s?.notifyType || 'none').toLowerCase();
  if (type === 'none') return;

  const text = [
    `Sync ${kind}: *${status.toUpperCase()}*`,
    stats ? '```\n' + JSON.stringify(stats, null, 2) + '\n```' : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    if (type === 'telegram' && s?.telegramBot && s?.telegramChatId) {
      const url = `https://api.telegram.org/bot${s.telegramBot}/sendMessage`;
      const body = { chat_id: s.telegramChatId, text, parse_mode: 'Markdown' };
      await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      console.log('[notify] telegram ok');
    } else if (type === 'webhook' && s?.webhookUrl) {
      await request(s.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(s.webhookSecret ? { 'X-Webhook-Secret': s.webhookSecret } : {}),
        },
        body: JSON.stringify({ kind, status, stats, ts: new Date().toISOString() }),
      });
      console.log('[notify] webhook ok');
    }
  } catch (e: any) {
    console.warn('[notify] failed:', e?.message || e);
  }
}
