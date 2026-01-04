// apps/api/src/services/torrents/qbt/jackettRewrite.ts
import { prisma } from '../../../prisma';

export async function rewriteJackettUrlForQbt(urlStr: string): Promise<string> {
  if (!/^https?:\/\//i.test(urlStr)) return urlStr;

  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const base = s?.torrentJackettQbtBaseUrl?.trim();
  if (!base) return urlStr;

  try {
    const orig = new URL(urlStr);
    const override = new URL(base);

    orig.protocol = override.protocol;
    orig.host = override.host;

    if (override.pathname && override.pathname !== '/') {
      const origPath = orig.pathname || '';
      const basePath = override.pathname.replace(/\/+$/,'');
      orig.pathname = basePath + (origPath.startsWith('/') ? origPath : `/${origPath}`);
    }

    return orig.toString();
  } catch {
    return urlStr;
  }
}
