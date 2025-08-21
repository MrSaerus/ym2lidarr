// apps/api/src/routes/export.ts
import { Router } from 'express';
import { prisma } from '../prisma';

const r = Router();

// Excel-friendly BOM for CSV
const CSV_BOM = '\uFEFF';

/** ========== JSON ========== */

r.get('/artists.json', async (_req, res) => {
  const rows = await prisma.yandexArtist.findMany({
    where: { present: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
    select: { mbid: true }, // минимально нужное
  });
  const out = rows.map((r: { mbid: string | null }) => ({ MusicBrainzId: r.mbid! }));
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(out, null, 2));
});

r.get('/albums.json', async (_req, res) => {
  const rows = await prisma.yandexAlbum.findMany({
    where: { present: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    select: { rgMbid: true },
  });
  const out = rows.map((r: { rgMbid: string | null }) => ({ ReleaseGroupMBID: r.rgMbid! }));
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(out, null, 2));
});

/** ========== CSV ========== */

r.get('/artists.csv', async (_req, res) => {
  const rows = await prisma.yandexArtist.findMany({
    where: { present: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
    select: { name: true, mbid: true },
  });
  const head = 'Artist,MBID\n';
  const body = rows
      .map((r: { name: string; mbid: string | null }) => `"${(r.name || '').replace(/"/g, '""')}",${r.mbid}`)
      .join('\n');

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="artists.csv"');
  res.send(CSV_BOM + head + body + '\n');
});

r.get('/albums.csv', async (_req, res) => {
  const rows = await prisma.yandexAlbum.findMany({
    where: { present: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    select: { artist: true, title: true, year: true, rgMbid: true },
  });

  const head = 'Artist,Album,Year,ReleaseGroupMBID\n';
  const body = rows
      .map((r: { artist: string | null; title: string; year: number | null; rgMbid: string | null }) =>
          `"${(r.artist || '').replace(/"/g, '""')}","${(r.title || '').replace(/"/g, '""')}",${r.year ?? ''},${r.rgMbid}`
      )
      .join('\n');

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="albums.csv"');
  res.send(CSV_BOM + head + body + '\n');
});

/** ========== Markdown ========== */

r.get('/artists.md', async (_req, res) => {
  const rows = await prisma.yandexArtist.findMany({
    where: { present: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
    select: { name: true, mbid: true },
  });

  const head = `| # | Artist | MBID |\n|---:|---|---|\n`;
  const body = rows.map((r: { name: string; mbid: string | null }, i: number) => `| ${i + 1} | ${r.name} | \`${r.mbid}\` |`).join('\n');

  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.send(head + body + '\n');
});

r.get('/albums.md', async (_req, res) => {
  const rows = await prisma.yandexAlbum.findMany({
    where: { present: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    select: { artist: true, title: true, year: true, rgMbid: true },
  });

  const head = `| # | Artist | Album | Year | ReleaseGroupMBID |\n|---:|---|---|---:|---|\n`;
  const body = rows
      .map(
          (r: { artist: string | null; title: string; year: number | null; rgMbid: string | null }, i: number) =>
              `| ${i + 1} | ${r.artist ?? ''} | ${r.title} | ${r.year ?? ''} | \`${r.rgMbid}\` |`
      )
      .join('\n');

  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.send(head + body + '\n');
});

export default r;
