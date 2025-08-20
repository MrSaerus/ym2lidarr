// apps/api/src/utils/lidarr-creds.ts
import { prisma } from '../prisma';

export type LidarrCreds = {
    lidarrUrl: string;
    lidarrApiKey: string;
};

/**
 * Получить URL и API-ключ Lidarr из БД (settings.id=1) с фолбэком на ENV.
 * Хвостовые слэши у URL убираются.
 */
export async function getLidarrCreds(): Promise<LidarrCreds> {
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
        throw new Error('Lidarr URL or API key is not configured');
    }

    return { lidarrUrl, lidarrApiKey };
}
