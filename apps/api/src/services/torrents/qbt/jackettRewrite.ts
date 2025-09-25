// apps/api/src/services/torrents/qbt/jackettRewrite.ts
import { prisma } from '../../../prisma';

export async function rewriteJackettUrlForQbt(urlStr: string): Promise<string> {
  // нас интересуют только http/https ссылки, магниты не трогаем
  if (!/^https?:\/\//i.test(urlStr)) return urlStr;

  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const base = s?.torrentJackettQbtBaseUrl?.trim();
  if (!base) return urlStr; // ничего не настроено — оставляем как есть

  try {
    const orig = new URL(urlStr);
    const override = new URL(base);

    // меняем протокол и host:port
    orig.protocol = override.protocol;
    orig.host = override.host;

    // если в base есть префикс пути — учитываем его
    if (override.pathname && override.pathname !== '/') {
      const origPath = orig.pathname || '';
      const basePath = override.pathname.replace(/\/+$/,'');
      orig.pathname = basePath + (origPath.startsWith('/') ? origPath : `/${origPath}`);
    }

    return orig.toString();
  } catch {
    // на всякий случай, если что-то не так с URL — не ломаем пайплайн
    return urlStr;
  }
}
