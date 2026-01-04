// apps/api/src/services/torznab.ts
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { upsertRelease, updateTaskStatus, calcNextErrorScheduledAt } from './torrents';
import { TorrentStatus } from '@prisma/client';
import { fetch } from 'undici';

const log = createLogger({ scope: 'service.torznab' });
const INDEXER_ERROR_THRESHOLD_COOLDOWN = 10;
const INDEXER_ERROR_THRESHOLD_DISABLE  = 20;
const INDEXER_COOLDOWN_MINUTES         = 60;

type ParsedItem = {
  title: string;
  guid?: string | null;
  link?: string | null;
  magnetUri?: string | null;
  sizeBytes?: number | null;
  seeders?: number | null;
  leechers?: number | null;
  pubDate?: Date | null;
  quality?: string | null;
  category?: string | null;
  infoHash?: string | null;
};

function textBetween(s: string, open: string | RegExp, close: string | RegExp): string | null {
  let start = -1;
  if (typeof open === 'string') {
    start = s.indexOf(open);
    if (start < 0) return null;
    start += open.length;
  } else {
    const m = open.exec(s);
    if (!m) return null;
    start = (m.index ?? 0) + m[0].length;
  }
  let end = -1;
  if (typeof close === 'string') {
    end = s.indexOf(close, start);
    if (end < 0) return null;
  } else {
    const rest = s.slice(start);
    const m = close.exec(rest);
    if (!m) return null;
    end = start + (m.index ?? 0);
  }
  return s.slice(start, end);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function applyIndexerErrorStats(
  perIndexer: Array<{ id: number; name: string; ok: boolean; error?: string }>
) {
  const now = new Date();

  for (const pi of perIndexer) {
    if (pi.ok) {
      await prisma.jackettIndexer.update({
        where: { id: pi.id },
        data: {
          errorCount: 0,
          tempDisabledUntil: null,
        },
      });
      continue;
    }

    const updated = await prisma.jackettIndexer.update({
      where: { id: pi.id },
      data: {
        errorCount: { increment: 1 },
      },
    });

    if (updated.errorCount === INDEXER_ERROR_THRESHOLD_COOLDOWN) {
      const until = new Date(now.getTime() + INDEXER_COOLDOWN_MINUTES * 60_000);

      await prisma.jackettIndexer.update({
        where: { id: pi.id },
        data: { tempDisabledUntil: until },
      });

      log.warn('jackett indexer moved to cooldown', 'jackett.indexer.cooldown', {
        id: pi.id,
        name: pi.name,
        until: until.toISOString(),
        lastError: pi.error ?? null,
        errorCount: updated.errorCount,
      });

      continue;
    }

    if (updated.errorCount >= INDEXER_ERROR_THRESHOLD_DISABLE && updated.enabled) {
      await prisma.jackettIndexer.update({
        where: { id: pi.id },
        data: { enabled: false },
      });

      log.error('jackett indexer disabled after repeated errors', 'jackett.indexer.disabled', {
        id: pi.id,
        name: pi.name,
        lastError: pi.error ?? null,
        errorCount: updated.errorCount,
      });
    }
  }
}

function parseTorznabXml(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const reItem = /<item\b[\s\S]*?<\/item>/gi;
  const itms = xml.match(reItem) || [];
  for (const raw of itms) {
    const safe = (x?: string | null) => (x ?? '').trim() || undefined;

    const title = safe(textBetween(raw, /<title>/i, /<\/title>/i)) || '(no title)';
    const guid = safe(textBetween(raw, /<guid[^>]*>/i, /<\/guid>/i));

    const rawLink =
      safe(textBetween(raw, /<link>/i, /<\/link>/i)) ||
      safe(textBetween(raw, /<enclosure\b[^>]*url="/i, /"/i));
    const link = rawLink ? decodeHtmlEntities(rawLink) : undefined;

    let magnet = undefined as string | undefined;
    const lowerRaw = raw.toLowerCase();
    if (lowerRaw.includes('magnet:?')) {
      const mMag = /magnet:\?[^"<\s]+/i.exec(raw);
      if (mMag) {
        magnet = decodeHtmlEntities(mMag[0]);
      }
    }
    const pubDateStr = safe(textBetween(raw, /<pubDate>/i, /<\/pubDate>/i));
    const pubDate = pubDateStr ? new Date(pubDateStr) : undefined;

    const attrs = Array.from(raw.matchAll(/<torznab:attr[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi));
    const attrMap = new Map<string, string>();
    for (const m of attrs) {
      attrMap.set((m[1] || '').toLowerCase(), m[2] || '');
    }

    const seeders = attrMap.get('seeders') ? Number(attrMap.get('seeders')) : undefined;
    const leechers = attrMap.get('peers')
      ? Number(attrMap.get('peers')) - (Number(attrMap.get('seeders')) || 0)
      : (attrMap.get('leechers') ? Number(attrMap.get('leechers')) : undefined);
    const size =
      attrMap.get('size')
        ? Number(attrMap.get('size'))
        : (safe(textBetween(raw, /<size>/i, /<\/size>/i)) ? Number(safe(textBetween(raw, /<size>/i, /<\/size>/i))) : undefined);

    const quality = attrMap.get('quality') || undefined;
    const category = attrMap.get('category') || undefined;
    const infoHash = attrMap.get('infohash') || undefined;

    items.push({
      title,
      guid,
      link,
      magnetUri: magnet || undefined,
      sizeBytes: Number.isFinite(size as any) ? (size as number) : undefined,
      seeders: Number.isFinite(seeders as any) ? (seeders as number) : undefined,
      leechers: Number.isFinite(leechers as any) ? (leechers as number) : undefined,
      pubDate: pubDate || undefined,
      quality,
      category,
      infoHash,
    });
  }
  return items;
}

export async function searchTaskWithJackett(
  taskId: number,
  opts?: { limitPerIndexer?: number },
) {
  const task = await prisma.torrentTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  const query = (task.query || '').trim();
  if (!query) throw new Error('Task has no query');

  const prevScheduledAt = task.scheduledAt ?? null;
  const prevLastTriedAt = task.lastTriedAt ?? null;
  const now = new Date();

  await updateTaskStatus(taskId, TorrentStatus.searching, { lastTriedAt: now });

  const indexers = await prisma.jackettIndexer.findMany({
    where: {
      enabled: true,
      OR: [
        { tempDisabledUntil: null },
        { tempDisabledUntil: { lt: now } },
      ],
    },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });

  if (!indexers.length) {
    const nextAt = calcNextErrorScheduledAt(
      { scheduledAt: prevScheduledAt, lastTriedAt: prevLastTriedAt },
      now,
    );

    await updateTaskStatus(taskId, TorrentStatus.failed, {
      lastError: 'No enabled indexers',
      scheduledAt: nextAt,
    });

    return {
      ok: false as const,
      reason: 'no-indexers' as const,
      count: 0,
      perIndexer: [] as any[],
    };
  }

  const perIndexer: Array<{
    id: number;
    name: string;
    ok: boolean;
    error?: string;
    found: number;
  }> = [];

  let totalSaved = 0;

  for (const idx of indexers) {
    const base = idx.baseUrl.replace(/\/+$/, '');
    const apikey = idx.apiKey;
    const cats = Array.isArray(idx.categories)
      ? (idx.categories as any[]).map(String).join(',')
      : undefined;

    const url = new URL(base + '/api');
    url.searchParams.set('t', 'search');
    url.searchParams.set('apikey', apikey);
    url.searchParams.set('q', query);
    if (cats) url.searchParams.set('cat', cats);
    if (opts?.limitPerIndexer && Number.isFinite(opts.limitPerIndexer)) {
      url.searchParams.set('limit', String(opts.limitPerIndexer));
    }

    try {
      log.info('jackett search start', 'torznab.search.indexer.start', {
        taskId,
        indexerId: idx.id,
        name: idx.name,
        url: url.toString(),
      });

      const resp = await fetch(url.toString(), { method: 'GET' });
      const text = await resp.text();

      if (!resp.ok) {
        const msg = `HTTP ${resp.status} ${resp.statusText}`;
        log.warn('jackett http error', 'torznab.search.indexer.http', {
          taskId,
          indexerId: idx.id,
          name: idx.name,
          status: resp.status,
          statusText: resp.statusText,
          preview: text.slice(0, 200),
        });

        perIndexer.push({
          id: idx.id,
          name: idx.name,
          ok: false,
          error: msg,
          found: 0,
        });
        continue;
      }

      const items = parseTorznabXml(text);
      let saved = 0;

      for (const it of items) {
        await upsertRelease(taskId, {
          indexerId: idx.id,
          title: it.title || '(no title)',
          magnetUri: it.magnetUri ?? null,
          link: it.link ?? null,
          sizeBytes: it.sizeBytes ?? null,
          seeders: it.seeders ?? null,
          leechers: it.leechers ?? null,
          publishDate: it.pubDate ?? null,
          quality: it.quality ?? null,
        });
        saved += 1;
      }

      log.info('jackett search ok', 'torznab.search.indexer.ok', {
        taskId,
        indexerId: idx.id,
        name: idx.name,
        found: saved,
      });

      perIndexer.push({
        id: idx.id,
        name: idx.name,
        ok: true,
        found: saved,
      });
      totalSaved += saved;
    } catch (e: any) {
      const msg = e?.message || String(e);
      log.error('jackett indexer error', 'torznab.search.indexer.error', {
        taskId,
        indexerId: idx.id,
        name: idx.name,
        err: msg,
      });

      perIndexer.push({
        id: idx.id,
        name: idx.name,
        ok: false,
        error: msg,
        found: 0,
      });
    }
  }

  await applyIndexerErrorStats(
    perIndexer.map(({ id, name, ok, error }) => ({ id, name, ok, error })),
  );

  const allFailed =
    perIndexer.length > 0 && perIndexer.every((x) => !x.ok);

  if (totalSaved > 0) {
    await updateTaskStatus(taskId, TorrentStatus.found, {
      lastError: null,
      scheduledAt: null,
    });

    return {
      ok: true as const,
      reason: 'ok' as const,
      count: totalSaved,
      perIndexer,
    };
  }

  if (allFailed) {
    const msg = perIndexer[0]?.error || 'Jackett error';
    const nextAt = calcNextErrorScheduledAt(
      { scheduledAt: prevScheduledAt, lastTriedAt: prevLastTriedAt },
      now,
    );

    await updateTaskStatus(taskId, TorrentStatus.failed, {
      lastError: `Jackett: ${msg}`,
      scheduledAt: nextAt,
    });

    return {
      ok: false as const,
      reason: 'indexer-error' as const,
      count: 0,
      perIndexer,
    };
  }

  const NOT_FOUND_RETRY_MINUTES = 30;
  const nextAt = new Date(now.getTime() + NOT_FOUND_RETRY_MINUTES * 60_000);

  await updateTaskStatus(taskId, TorrentStatus.queued, {
    lastError: 'No releases found',
    scheduledAt: nextAt,
  });

  return {
    ok: true as const,
    reason: 'empty' as const,
    count: 0,
    perIndexer,
  };
}