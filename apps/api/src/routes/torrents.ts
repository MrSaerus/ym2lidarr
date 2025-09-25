// apps/api/src/routes/torrents.ts
import { Router } from 'express';
import { createLogger } from '../lib/logger';
import {
  createTask, listTasks, getTask,
  updateTaskStatus, upsertRelease, listReleases,
  pickBestRelease, addTaskToQbt, refreshTaskQbtStatus,
  refreshActiveTasks, mapQbtToTaskStatus,
  moveTaskToFinalPath, autoRelocateDownloaded, copyDownloadedTask, autoCopyDownloaded, autoPollQbt,
} from '../services/torrents';
import { isTaskKind, isCollisionPolicy } from '../types/torrents';
import { TorrentStatus } from '@prisma/client';
import { searchTaskWithJackett } from '../services/torznab';
import { prisma } from '../prisma';
const r = Router();
const log = createLogger({ scope: 'route.torrents' });

const isPrismaTorrentStatus = (s: string): s is TorrentStatus =>
  (Object.values(TorrentStatus) as string[]).includes(s);

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

    const existed = (task as any)._existed === true;
    if (existed) delete (task as any)._existed;

    res.json({ ok: true, existed, task });
  } catch (e:any) {
    log.error('create task failed', 'torrents.task.create.fail', { err: e?.message });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/torrents/tasks
r.get('/tasks', async (req, res) => {
  try {
    const status = String(req.query.status || 'any');

    const pageRaw = req.query.page as string | undefined;
    const pageSizeRaw = req.query.pageSize as string | undefined;
    const qRaw = req.query.q;

    const page = pageRaw ? parseInt(pageRaw, 10) : 1;
    const pageSize = pageSizeRaw ? parseInt(pageSizeRaw, 10) : 50;
    const q = typeof qRaw === 'string' ? qRaw : undefined;

    const sortField =
      typeof req.query.sortField === 'string' ? req.query.sortField : undefined;
    const sortDir =
      req.query.sortDir === 'asc' || req.query.sortDir === 'desc'
        ? (req.query.sortDir as 'asc' | 'desc')
        : undefined;

    const result = await listTasks({
      status: status === 'any' ? 'any' : (status as TorrentStatus),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50,
      q,
      sortField,
      sortDir,
    });

    res.json(result);
  } catch (e: any) {
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
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Bad id' });
    }

    const status = String(req.body?.status || '');
    if (!isPrismaTorrentStatus(status)) {
      return res.status(400).json({ ok: false, error: 'Bad status' });
    }

    const patch: any = {
      lastError: req.body?.lastError ?? null,
      startedAt: req.body?.startedAt ? new Date(req.body.startedAt) : undefined,
      finishedAt: req.body?.finishedAt ? new Date(req.body.finishedAt) : undefined,
      lastTriedAt: new Date(),
    };

    // позволяем вручную задать/исправить хеш
    if (typeof req.body?.qbitHash === 'string' && req.body.qbitHash.trim()) {
      patch.qbitHash = req.body.qbitHash.trim().toUpperCase();
    }

    const updated = await updateTaskStatus(id, status as TorrentStatus, patch);
    res.json({ ok: true, task: updated });
  } catch (e: any) {
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
        magnetUri: it.magnet || it.magnetUri || null,
        link: it.link ?? null,
        sizeBytes: it.size != null ? BigInt(it.size) : null,
        seeders: Number.isFinite(+it.seeders) ? +it.seeders : null,
        leechers: Number.isFinite(+it.leechers) ? +it.leechers : null,
        publishDate: it.pubDate ? new Date(it.pubDate) : null,
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

// POST /api/torrents/tasks/:id/search  { limitPerIndexer? }
r.post('/tasks/:id/search', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
    const limitPerIndexer = Number.isFinite(+req.body?.limitPerIndexer) ? +req.body.limitPerIndexer : undefined;
    const out = await searchTaskWithJackett(id, { limitPerIndexer });
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/tasks/:id/pick  { commit?: boolean }
r.post('/tasks/:id/pick', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });

    const commit = !!req.body?.commit;
    const { chosen, reason } = await pickBestRelease(id, { commit });

    if (!chosen) return res.json({ ok: false, reason });
    res.json({ ok: true, reason, release: chosen });
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/tasks/:id/add  { releaseId?, savePath?, autoStart?, tags? }
r.post('/tasks/:id/add', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });

    const { releaseId, savePath, autoStart, tags } = req.body || {};
    const result = await addTaskToQbt(id, {
      releaseId: Number.isFinite(+releaseId) ? +releaseId : undefined,
      savePath: typeof savePath === 'string' ? savePath : undefined,
      autoStart: typeof autoStart === 'boolean' ? autoStart : undefined,
      tags: typeof tags === 'string' ? tags : undefined,
    });

    res.json(result);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/tasks/:id/move  { } — триггер единичного relocate
r.post('/tasks/:id/move', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
    const out = await moveTaskToFinalPath(id);
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/tasks/:id/copy
r.post('/tasks/:id/copy', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
    const out = await copyDownloadedTask(id);
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/torrents/tasks/:id/qbt — обновить и вернуть статус из qBittorrent
r.get('/tasks/:id/qbt', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
    const rStat = await refreshTaskQbtStatus(id);
    res.json(rStat);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/qbt/webhook?secret=XYZ
r.post('/qbt/webhook', async (req, res) => {
  try {
    const secret = String(req.query.secret || req.headers['x-qbt-secret'] || '');
    const settings = await prisma.setting.findFirst({ where: { id: 1 } });
    if (!settings?.qbtWebhookSecret || secret !== settings.qbtWebhookSecret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }

    const { hash, state, progress } = req.body || {};
    const h = typeof hash === 'string' ? hash.toUpperCase() : '';
    if (!/^[A-F0-9]{40}$/.test(h)) return res.status(400).json({ ok: false, error: 'bad hash' });

    const task = await prisma.torrentTask.findFirst({ where: { qbitHash: h } });
    if (!task) return res.json({ ok: true, skipped: 'no-task' });

    const next = mapQbtToTaskStatus({ state, progress });
    if (next !== task.status) {
      const patch: any = { status: next, updatedAt: new Date() };
      if (typeof req.body?.name === 'string' && !task.title) patch.title = req.body.name;
      await prisma.torrentTask.update({ where: { id: task.id }, data: patch });
    } else {
      await prisma.torrentTask.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    }
    if (next === TorrentStatus.downloaded && task.status !== TorrentStatus.moved) {
      // асинхронно, но можно и await — решай: если webhook должен отвечать быстро, не блокируем
      // здесь лучше "fire-and-forget" без падений ответа
      copyDownloadedTask(task.id).catch(err => {
        // просто записываем ошибку, ответ вебхуку — ok
        console.warn('copyDownloadedTask failed', err?.message);
      });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/qbt/relocate  { batchSize?: number }
r.post('/qbt/relocate', async (req, res) => {
  try {
    const batchSize = Number.isFinite(+req.body?.batchSize) ? +req.body.batchSize : undefined;
    const out = await autoRelocateDownloaded({ batchSize });
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/qbt/copy-downloaded
r.post('/qbt/copy-downloaded', async (req, res) => {
  try {
    const batchSize = Number.isFinite(+req.body?.batchSize) ? +req.body.batchSize : undefined;
    const out = await autoCopyDownloaded({ batchSize });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /api/torrents/qbt/poll
r.post('/qbt/poll', async (req, res) => {
  try {
    const batchSize = Number.isFinite(+req.body?.batchSize) ? +req.body.batchSize : undefined;
    const out = await autoPollQbt({ batchSize });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default r;
