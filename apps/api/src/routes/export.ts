import { Router } from 'express';

import { prisma } from '../prisma';

const r = Router();

r.get('/artists.json', async (_req, res) => {
  const rows = await prisma.artist.findMany({
    where: { matched: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
  });
  const out = rows.map((r) => ({ MusicBrainzId: r.mbid! }));
  res.setHeader('content-type', 'application/json');
  res.send(JSON.stringify(out, null, 2));
});

r.get('/albums.json', async (_req, res) => {
  const rows = await prisma.album.findMany({
    where: { matched: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
  });
  const out = rows.map((r) => ({ ReleaseGroupMBID: r.rgMbid! }));
  res.setHeader('content-type', 'application/json');
  res.send(JSON.stringify(out, null, 2));
});

r.get('/artists.csv', async (_req, res) => {
  const rows = await prisma.artist.findMany({
    where: { matched: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
  });
  const head = 'Artist,MBID\n';
  const body = rows.map((r) => `"${r.name.replace(/"/g, '""')}",${r.mbid}`).join('\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="artists.csv"');
  res.send(head + body + '\n');
});

r.get('/albums.csv', async (_req, res) => {
  const rows = await prisma.album.findMany({
    where: { matched: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
  });
  const head = 'Artist,Album,Year,ReleaseGroupMBID\n';
  const body = rows
    .map(
      (r) =>
        `"${(r.artist || '').replace(/"/g, '""')}","${(r.title || '').replace(/"/g, '""')}",${r.year ?? ''},${r.rgMbid}`,
    )
    .join('\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="albums.csv"');
  res.send(head + body + '\n');
});

r.get('/artists.md', async (_req, res) => {
  const rows = await prisma.artist.findMany({
    where: { matched: true, mbid: { not: null } },
    orderBy: { name: 'asc' },
  });
  const head = `| # | Artist | MBID |\n|---:|---|---|\n`;
  const body = rows.map((r, i) => `| ${i + 1} | ${r.name} | \`${r.mbid}\` |`).join('\n');
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.send(head + body + '\n');
});

r.get('/albums.md', async (_req, res) => {
  const rows = await prisma.album.findMany({
    where: { matched: true, rgMbid: { not: null } },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
  });
  const head = `| # | Artist | Album | Year | ReleaseGroupMBID |\n|---:|---|---|---:|---|\n`;
  const body = rows
    .map((r, i) => `| ${i + 1} | ${r.artist} | ${r.title} | ${r.year ?? ''} | \`${r.rgMbid}\` |`)
    .join('\n');
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.send(head + body + '\n');
});

export default r;
