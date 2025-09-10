// apps/api/src/notify.ts
import { request } from 'undici';
import { prisma } from './prisma';
import { createLogger } from './lib/logger';

type Kind = 'yandex' | 'lidarr' | 'export' | 'match';
type Status = 'ok' | 'error';

const log = createLogger({ scope: 'notify' });

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
  log.info('notify start', 'notify.start', { kind, status, hasStats: stats != null });

  let s: any;
  try {
    s = await prisma.setting.findFirst({ where: { id: 1 } });
  } catch (e: any) {
    log.error('failed to load settings', 'notify.settings.fail', { error: String(e?.message || e) });
    return;
  }

  // нормализуем тип: поддерживаем legacy 'none'
  const rawType = (s?.notifyType || 'disabled').toLowerCase();
  const type = rawType === 'none' ? 'disabled' : rawType;

  if (type === 'disabled') {
    log.info('notifications disabled', 'notify.disabled', {});
    return;
  }

  try {
    if (type === 'telegram') {
      const hasBot = !!s?.telegramBot;
      const hasChat = !!s?.telegramChatId;
      if (!hasBot || !hasChat) {
        log.warn('telegram misconfigured', 'notify.telegram.misconfig', { hasBot, hasChat });
        return;
      }

      const url = `https://api.telegram.org/bot${s.telegramBot}/sendMessage`;
      const body = {
        chat_id: s.telegramChatId,
        text: makeTelegramMessage(kind, status, stats),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };

      log.debug('telegram send attempt', 'notify.telegram.send', {
        msgLen: body.text?.length ?? 0,
        hasChat,
      });

      const r = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const ok = r.statusCode >= 200 && r.statusCode < 300;
      log[ok ? 'info' : 'warn'](
        ok ? 'telegram ok' : 'telegram failed',
        ok ? 'notify.telegram.ok' : 'notify.telegram.fail',
        { status: r.statusCode }
      );
      return;
    }

    if (type === 'webhook') {
      const url = s?.webhookUrl || '';
      if (!url) {
        log.warn('webhook misconfigured (no url)', 'notify.webhook.misconfig', {});
        return;
      }
      const host = (() => {
        try { return new URL(url).host; } catch { return undefined; }
      })();

      const payload = {
        kind,
        status,
        stats,
        ts: new Date().toISOString(),
      };

      log.debug('webhook send attempt', 'notify.webhook.send', {
        host,
        hasSecret: !!s?.webhookSecret,
        hasStats: stats != null,
      });

      const r = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(s.webhookSecret ? { 'X-Webhook-Secret': s.webhookSecret } : {}),
        },
        body: JSON.stringify(payload),
      });

      const ok = r.statusCode >= 200 && r.statusCode < 300;
      log[ok ? 'info' : 'warn'](
        ok ? 'webhook ok' : 'webhook failed',
        ok ? 'notify.webhook.ok' : 'notify.webhook.fail',
        { status: r.statusCode, host }
      );
      return;
    }

    // неизвестный тип
    log.warn('skipped: unknown notify type', 'notify.skipped.unknown', { type });
  } catch (e: any) {
    // финальная ловушка
    log.error('notify failed', 'notify.error', { type, error: String(e?.message || e) });
  }
}
