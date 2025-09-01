// apps/api/src/routes/webhooks.lidarr.ts
import { Router } from 'express';
import { QbtClient } from '../services/qbittorrent';
import { prisma } from '../prisma';

const r = Router();

/**
 * Минимальные типы под Lidarr webhook.
 * Lidarr шлёт разные eventType, нас интересуют успешные импорты.
 * В payload обычно есть downloadId — это ID задачи у клиента (для qBittorrent это infohash).
 */
type LidarrEventCommon = {
  eventType: string;
  instanceName?: string;
};
type LidarrDownloadEvent = LidarrEventCommon & {
  // Для успешного импорта:
  // eventType может быть "DownloadFolderImported" (или "AlbumImported" в новых сборках),
  // downloadId?: string;
  downloadId?: string | null;
  isUpgrade?: boolean;
  artist?: { id?: number; name?: string };
  album?: { id?: number; title?: string; releaseDate?: string | null };
  // Иногда встречается: 'torrentInfoHash' или 'downloadClient' — оставим про запас
  torrentInfoHash?: string | null;
};

function isSuccessImport(ev: LidarrEventCommon) {
  // Покроем самые частые варианты названий событий:
  const et = (ev.eventType || '').toLowerCase();
  return (
    et === 'downloadfolderimported' ||
    et === 'albumimported' ||
    et === 'downloadcompleted' ||
    et === 'trackfileimported'
  );
}

function normalizeHash(s?: string | null): string | null {
  if (!s) return null;
  const hex = s.trim().toLowerCase();
  // ожидаем 40 hex-символов; иногда lidarr передаёт "BT_" префиксы — уберём всё лишнее
  const m = /([0-9a-f]{40})/.exec(hex);
  return m ? m[1] : null;
}

r.post('/lidarr', async (req, res) => {
  try {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const want = s?.qbtWebhookSecret;
    if (want) {
      const got = String(req.query.secret || '');
        if (got !== want) return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const payload = req.body as LidarrDownloadEvent;
    if (!payload?.eventType) {
      return res.status(400).json({ ok: false, error: 'no eventType' });
    }

    if (!isSuccessImport(payload)) {
      return res.json({ ok: true, skipped: true, reason: 'not a success-import event' });
    }

    // Пытаемся вытащить hash
    let hash =
      normalizeHash(payload.downloadId || null) ||
      normalizeHash(payload.torrentInfoHash || null);

    if (!hash) {
      // Если хеш не пришёл, ничего не ломаем — просто логируем и отвечаем.
      // (При желании тут можно сделать fallback-поиск по категории/пути.)
      return res.json({ ok: true, skipped: true, reason: 'no hash in payload' });
    }

    const { client, deleteFiles } = await QbtClient.fromDb();
    await client.deleteTorrents(hash, deleteFiles);

    return res.json({
      ok: true,
      deleted: hash,
      deleteFiles,
      eventType: payload.eventType,
      artist: payload.artist?.name || null,
      album: payload.album?.title || null,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default r;
