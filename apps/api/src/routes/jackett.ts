import { Router } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { request } from 'undici';

const r = Router();
const log = createLogger({ scope: 'route.jackett.indexers' });

function stripTrailingSlashes(s?: string | null) {
  const str = String(s ?? '');
  let i = str.length;
  while (i > 0 && str.charCodeAt(i - 1) === 47) i--;
  return str.slice(0, i);
}
function parseCats(v: any): string[] | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const a = v.split(',').map((x) => x.trim()).filter(Boolean);
    return a.length ? a : null;
  }
  if (Array.isArray(v)) {
    const a = v.map((x) => String(x).trim()).filter(Boolean);
    return a.length ? a : null;
  }
  return null;
}

/* --------- CRUD --------- */

// GET /api/jackett/indexers
r.get('/', async (_req, res) => {
  const list = await prisma.jackettIndexer.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  res.json(list.map(({ apiKey, ...rest }) => ({ ...rest, apiKey: '' })));
});

// POST /api/jackett/indexers
r.post('/', async (req, res) => {
  const b = req.body || {};
  const data: any = {
    name: String(b.name || '').trim() || 'indexer',
    enabled: !!b.enabled,
    allowRss: !!b.allowRss,
    allowAuto: !!b.allowAuto,
    allowInteractive: !!b.allowInteractive,
    baseUrl: stripTrailingSlashes(String(b.baseUrl || '')),
    apiKey: String(b.apiKey || '').trim(),
    categories: parseCats(b.categories),
    tags: b.tags ? String(b.tags) : null,
    minSeeders: Number.isFinite(+b.minSeeders) ? +b.minSeeders : null,
    order: Number.isFinite(+b.order) ? +b.order : 100,
  };
  if (!data.baseUrl) return res.status(400).json({ ok: false, error: 'baseUrl required' });
  if (!data.apiKey) return res.status(400).json({ ok: false, error: 'apiKey required' });
  const saved = await prisma.jackettIndexer.create({ data });
  res.json({ ok: true, id: saved.id });
});

// PUT /api/jackett/indexers/:id
r.put('/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });

  const b = req.body || {};
  const data: any = {};
  if ('name' in b) data.name = String(b.name || '').trim() || 'indexer';
  if ('enabled' in b) data.enabled = !!b.enabled;
  if ('allowRss' in b) data.allowRss = !!b.allowRss;
  if ('allowAuto' in b) data.allowAuto = !!b.allowAuto;
  if ('allowInteractive' in b) data.allowInteractive = !!b.allowInteractive;
  if ('baseUrl' in b) data.baseUrl = stripTrailingSlashes(String(b.baseUrl || ''));
  if ('apiKey' in b && String(b.apiKey).trim()) data.apiKey = String(b.apiKey).trim(); // пустой не перезатираем
  if ('categories' in b) data.categories = parseCats(b.categories);
  if ('tags' in b) data.tags = b.tags ? String(b.tags) : null;
  if ('minSeeders' in b) data.minSeeders = Number.isFinite(+b.minSeeders) ? +b.minSeeders : null;
  if ('order' in b) data.order = Number.isFinite(+b.order) ? +b.order : 100;

  await prisma.jackettIndexer.update({ where: { id }, data });
  res.json({ ok: true });
});

// DELETE /api/jackett/indexers/:id
r.delete('/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  await prisma.jackettIndexer.delete({ where: { id } });
  res.json({ ok: true });
});

/* --------- Test --------- */

// POST /api/jackett/indexers/:id/test
r.post('/:id/test', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });

  const idx = await prisma.jackettIndexer.findUnique({ where: { id } });
  if (!idx) return res.status(404).json({ ok: false, error: 'not found' });

  const baseIn = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined;
  const keyIn = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined;

  const base = stripTrailingSlashes(baseIn || idx.baseUrl);
  const key = (keyIn || idx.apiKey).trim();
  if (!base) return res.status(400).json({ ok: false, error: 'baseUrl missing' });
  if (!key) return res.status(400).json({ ok: false, error: 'apiKey missing' });

  const url = new URL('/api/v2.0/indexers/all/results/torznab/api', base);
  url.searchParams.set('t', 'caps');
  url.searchParams.set('apikey', key);

  try {
    const resp = await request(url.toString(), { method: 'GET' });
    const text = await resp.body.text();
    const ok = resp.statusCode >= 200 && resp.statusCode < 300 && /<caps[\s>]/i.test(text);
    const ver = text.match(/<server[^>]*version="([^"]+)"/i)?.[1] || null;
    return res.json({ ok, status: resp.statusCode, version: ver });
  } catch (e: any) {
    log.error('jackett caps failed', 'jackett.indexer.test.fail', { id, err: e?.message });
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default r;
