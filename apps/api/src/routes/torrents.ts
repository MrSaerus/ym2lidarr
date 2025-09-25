// apps/api/src/routes/torrents.ts
import { Router } from 'express';
import { createLogger } from '../lib/logger';
import { prisma } from '../prisma';
import {
  createTask, listTasks, getTask,
  updateTaskStatus, upsertRelease, listReleases, setReleaseStatus
} from '../services/torrents';
import { isTaskKind, isCollisionPolicy, isReleaseStatus, isTaskStatus } from '../types/torrents';

const r = Router();
const log = createLogger({ scope: 'route.torrents' });

// POST /api/torrents/tasks
r.post('/tasks', async (req, res) => {
  try {
    const b = req.body || {};
    if (!isTaskKind(b.kind)) return res.status(400).json({ ok: false, error: 'kind must be artist|album' });
    const task = await createTask({
      kind: b.kind,
      artistName: b.artistName ?? null,
      albumTitle: b.albumTitle ?? null,
      year: Number.isFinite(+b.year) ? +b.year : null,
      query: b.query ?? null,
      ymArtistId: b.ymArtistId ?? null,
      ymAlbumId: b.ymAlbumId ?? null,
      source: ['manual','auto','yandex'].includes(b.source) ? b.source : 'manual',
      collisionPolicy: isCollisionPolicy(b.collisionPolicy) ? b.collisionPolicy : 'replace',
      minSeeders: Number.isFinite(+b.minSeeders) ? +b.minSeeders : null,
      limitReleases: Number.isFinite(+b.limitReleases) ? +b.limitReleases : null,
      indexerId: Number.isFinite(+b.indexerId) ? +b.indexerId : null,
      targetPath: b.targetPath ?? null,
      scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
    });
    res.json({ ok: true, task });
  } catch (e:any) {
    log.error('create task failed', 'torrents.task.create.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/torrents/tasks
r.get('/tasks', async (req, res) => {
  try {
    const status = String(req.query.status || 'any');
    const limit = Number.isFinite(+req.query.limit!) ? +req.query.limit! : 100;
    const rows = await listTasks({ status: (status === 'any' ? 'any' : status as any), limit });
    res.json(rows);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/torrents/tasks/:id
r.get('/tasks/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const task = await getTask(id);
  if (!task) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json(task);
});

// PATCH /api/torrents/tasks/:id/status
r.patch('/tasks/:id/status', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
    const status = String(req.body?.status || '');
    if (!isTaskStatus(status)) return res.status(400).json({ ok: false, error: 'Bad status' });
    const updated = await updateTaskStatus(id, status as any, {
      lastError: req.body?.lastError ?? null,
      startedAt: req.body?.startedAt ? new Date(req.body.startedAt) : undefined,
      finishedAt: req.body?.finishedAt ? new Date(req.body.finishedAt) : undefined,
      lastTriedAt: new Date(),
    });
    res.json({ ok: true, task: updated });
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/tasks/:id/releases  (bulk upsert из torznab)
r.post('/tasks/:id/releases', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const saved = [];

    for (const it of items) {
      const row = await upsertRelease(id, {
        indexerId: Number.isFinite(+it.indexerId) ? +it.indexerId : null,
        title: String(it.title || '').trim() || '(no title)',
        guid: it.guid ? String(it.guid) : null,
        infoHash: it.infoHash ? String(it.infoHash) : null,
        magnetUri: it.magnetUri ?? null,
        link: it.link ?? null,
        sizeBytes: it.sizeBytes != null ? BigInt(it.sizeBytes) : null,
        seeders: Number.isFinite(+it.seeders) ? +it.seeders : null,
        leechers: Number.isFinite(+it.leechers) ? +it.leechers : null,
        publishDate: it.publishDate ? new Date(it.publishDate) : null,
        category: it.category ?? null,
        quality: it.quality ?? null,
        score: Number.isFinite(+it.score) ? +it.score : null,
      });
      saved.push(row);
    }

    res.json({ ok: true, count: saved.length });
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/torrents/tasks/:id/releases
r.get('/tasks/:id/releases', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const rows = await listReleases(id);
  res.json(rows);
});

// PATCH /api/torrents/releases/:id/status
r.patch('/releases/:id/status', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const status = String(req.body?.status || '');
  if (!isReleaseStatus(status)) return res.status(400).json({ ok: false, error: 'Bad status' });
  const updated = await setReleaseStatus(id, status as any, {
    qbtTorrentId: req.body?.qbtTorrentId ?? undefined,
    rejectionReason: req.body?.rejectionReason ?? undefined,
  });
  res.json({ ok: true, release: updated });
});

export default r;
