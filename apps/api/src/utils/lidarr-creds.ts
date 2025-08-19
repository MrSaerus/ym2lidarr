import { prisma } from '../prisma';

export async function getLidarrCreds() {
    const s = await prisma.setting.findFirst();
    const lidarrUrl = s?.lidarrUrl || process.env.LIDARR_URL;
    const lidarrApiKey = s?.lidarrApiKey || process.env.LIDARR_API_KEY;
    if (!lidarrUrl || !lidarrApiKey) throw new Error('Lidarr URL or API key is not configured');
    return { lidarrUrl: lidarrUrl.replace(/\/+$/,''), lidarrApiKey };
}
