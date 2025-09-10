// apps/api/src/routes/export.ts
import { Router } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.export' });

// Excel-friendly BOM for CSV
const CSV_BOM = '\uFEFF';

/** ========== JSON ========== */

r.get('/artists.json', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export artists.json requested', 'export.artists.json.start');

  try {
    const rows = await prisma.yandexArtist.findMany({
      where: { present: true, mbid: { not: null } },
      orderBy: { name: 'asc' },
      select: { mbid: true },
    });
    lg.debug('fetched artists for json', 'export.artists.json.db', { count: rows.length });

    const out = rows.map((r: { mbid: string | null }) => ({ MusicBrainzId: r.mbid! }));
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(out, null, 2));

    lg.info('export artists.json completed', 'export.artists.json.done', { count: out.length });
  } catch (e: any) {
    lg.error('export artists.json failed', 'export.artists.json.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export artists.json' });
  }
});

r.get('/albums.json', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export albums.json requested', 'export.albums.json.start');

  try {
    const rows = await prisma.yandexAlbum.findMany({
      where: { present: true, rgMbid: { not: null } },
      orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      select: { rgMbid: true },
    });
    lg.debug('fetched albums for json', 'export.albums.json.db', { count: rows.length });

    const out = rows.map((r: { rgMbid: string | null }) => ({ ReleaseGroupMBID: r.rgMbid! }));
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(out, null, 2));

    lg.info('export albums.json completed', 'export.albums.json.done', { count: out.length });
  } catch (e: any) {
    lg.error('export albums.json failed', 'export.albums.json.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export albums.json' });
  }
});

/** ========== CSV ========== */

r.get('/artists.csv', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export artists.csv requested', 'export.artists.csv.start');

  try {
    const rows = await prisma.yandexArtist.findMany({
      where: { present: true, mbid: { not: null } },
      orderBy: { name: 'asc' },
      select: { name: true, mbid: true },
    });
    lg.debug('fetched artists for csv', 'export.artists.csv.db', { count: rows.length });

    const head = 'Artist,MBID\n';
    const body = rows
      .map((r: { name: string; mbid: string | null }) => `"${(r.name || '').replace(/"/g, '""')}",${r.mbid}`)
      .join('\n');

    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="artists.csv"');
    res.send(CSV_BOM + head + body + '\n');

    lg.info('export artists.csv completed', 'export.artists.csv.done', { count: rows.length });
  } catch (e: any) {
    lg.error('export artists.csv failed', 'export.artists.csv.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export artists.csv' });
  }
});

r.get('/albums.csv', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export albums.csv requested', 'export.albums.csv.start');

  try {
    const rows = await prisma.yandexAlbum.findMany({
      where: { present: true, rgMbid: { not: null } },
      orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      select: { artist: true, title: true, year: true, rgMbid: true },
    });
    lg.debug('fetched albums for csv', 'export.albums.csv.db', { count: rows.length });

    const head = 'Artist,Album,Year,ReleaseGroupMBID\n';
    const body = rows
      .map((r: { artist: string | null; title: string; year: number | null; rgMbid: string | null }) =>
        `"${(r.artist || '').replace(/"/g, '""')}","${(r.title || '').replace(/"/g, '""')}",${r.year ?? ''},${r.rgMbid}`
      )
      .join('\n');

    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="albums.csv"');
    res.send(CSV_BOM + head + body + '\n');

    lg.info('export albums.csv completed', 'export.albums.csv.done', { count: rows.length });
  } catch (e: any) {
    lg.error('export albums.csv failed', 'export.albums.csv.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export albums.csv' });
  }
});

/** ========== Markdown ========== */

r.get('/artists.md', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export artists.md requested', 'export.artists.md.start');

  try {
    const rows = await prisma.yandexArtist.findMany({
      where: { present: true, mbid: { not: null } },
      orderBy: { name: 'asc' },
      select: { name: true, mbid: true },
    });
    lg.debug('fetched artists for md', 'export.artists.md.db', { count: rows.length });

    const head = `| # | Artist | MBID |\n|---:|---|---|\n`;
    const body = rows.map((r: { name: string; mbid: string | null }, i: number) => `| ${i + 1} | ${r.name} | \`${r.mbid}\` |`).join('\n');

    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.send(head + body + '\n');

    lg.info('export artists.md completed', 'export.artists.md.done', { count: rows.length });
  } catch (e: any) {
    lg.error('export artists.md failed', 'export.artists.md.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export artists.md' });
  }
});

r.get('/albums.md', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('export albums.md requested', 'export.albums.md.start');

  try {
    const rows = await prisma.yandexAlbum.findMany({
      where: { present: true, rgMbid: { not: null } },
      orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      select: { artist: true, title: true, year: true, rgMbid: true },
    });
    lg.debug('fetched albums for md', 'export.albums.md.db', { count: rows.length });

    const head = `| # | Artist | Album | Year | ReleaseGroupMBID |\n|---:|---|---|---:|---|\n`;
    const body = rows
      .map(
        (r: { artist: string | null; title: string; year: number | null; rgMbid: string | null }, i: number) =>
          `| ${i + 1} | ${r.artist ?? ''} | ${r.title} | ${r.year ?? ''} | \`${r.rgMbid}\` |`
      )
      .join('\n');

    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.send(head + body + '\n');

    lg.info('export albums.md completed', 'export.albums.md.done', { count: rows.length });
  } catch (e: any) {
    lg.error('export albums.md failed', 'export.albums.md.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: 'Failed to export albums.md' });
  }
});

export default r;
