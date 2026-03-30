// apps/api/src/utils/lidarr-creds.ts
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';

export type LidarrCreds = {
    lidarrUrl: string;
    lidarrApiKey: string;
};

const log = createLogger({ scope: 'util.lidarrCreds' });

export async function getLidarrCreds(): Promise<LidarrCreds> {
    log.debug('loading lidarr creds', 'lidarr.creds.start');
    const s = await prisma.setting.findFirst({ where: { id: 1 } });

    const urlRaw =
      (typeof s?.lidarrUrl === 'string' && s.lidarrUrl) ||
      (typeof process.env.LIDARR_URL === 'string' && process.env.LIDARR_URL) ||
      '';

    const keyRaw =
      (typeof s?.lidarrApiKey === 'string' && s.lidarrApiKey) ||
      (typeof process.env.LIDARR_API_KEY === 'string' && process.env.LIDARR_API_KEY) ||
      '';

    const lidarrUrl = urlRaw.replace(/\/+$/, '');
    const lidarrApiKey = keyRaw.trim();

    if (!lidarrUrl || !lidarrApiKey) {
        log.error('lidarr creds missing', 'lidarr.creds.missing', {
            hasUrl: !!lidarrUrl,
            hasKey: !!lidarrApiKey,
        });
        throw new Error('Lidarr URL or API key is not configured');
    }

    log.debug('lidarr creds loaded', 'lidarr.creds.done', { hasUrl: !!lidarrUrl, hasKey: !!lidarrApiKey });
    return { lidarrUrl, lidarrApiKey };
}
