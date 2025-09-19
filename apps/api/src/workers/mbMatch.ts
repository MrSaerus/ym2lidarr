// apps/api/src/workers/mbMatch.ts
import { mbFindArtist, mbFindReleaseGroup } from '../services/mb';
import {
  prisma, startRunWithKind, patchRunStats, endRun, dblog,
  evStart, evFinish, evError, now, elapsedMs, bailIfCancelled, getRunWithRetry,
} from './_common';

export async function runMbMatch(reuseRunId?: number, opts?: { force?: boolean; target?: 'artists'|'albums'|'both' }) {
  const force = !!(opts?.force);
  const target = opts?.target || 'both';
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const retryDays = Math.max(1, Number(setting?.matchRetryDays ?? 3));
  const retryBefore = new Date(Date.now() - retryDays * 24 * 60 * 60 * 1000);

  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRunWithKind('match', { phase: 'match', a_total: 0, a_done: 0, a_matched: 0, al_total: 0, al_done: 0, al_matched: 0 });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'mb.match', target, force });

  try {
    if (target === 'artists' || target === 'both') {
      const base = await prisma.yandexArtist.findMany({
        where: force ? { present: true } : { present: true, mbid: null },
        orderBy: { id: 'asc' },
        select: { id: true, ymId: true, name: true, mbid: true },
      });

      let candidates = base;
      if (!force) {
        const syncItems = await prisma.mbSyncItem.findMany({
          where: { kind: 'yandex-artist', targetId: { in: base.map(x => x.id) } },
          select: { targetId: true, lastCheckedAt: true },
        });
        const lastById = new Map(syncItems.map(s => [s.targetId, s.lastCheckedAt]));
        candidates = base.filter(x => {
          if (x.mbid) return false;
          const last = lastById.get(x.id);
          return !last || last < retryBefore;
        });
      }

      await patchRunStats(runId, { a_total: candidates.length });
      await dblog(runId, 'info', 'MB Match (artists) started', {
        target, force,
        totalArtists:  await prisma.yandexArtist.count({ where: { present: true } }),
        matchedArtists: await prisma.yandexArtist.count({ where: { present: true, mbid: { not: null } } }),
      });

      let a_done = 0, a_matched = 0;
      for (const y of candidates) {
        if (await bailIfCancelled(runId, 'match-artists')) return;
        try {
          const r = await mbFindArtist(y.name);
          await prisma.cacheEntry.upsert({
            where: { key: `ya:artist:${y.ymId}` },
            create: { scope: 'ya:artist', key: `ya:artist:${y.ymId}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          if (r.externalId) {
            await prisma.$transaction([
              prisma.yandexArtist.update({ where: { id: y.id }, data: { mbid: r.externalId } }),
              prisma.mbSyncItem.upsert({
                where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
                create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
                update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
              }),
            ]);
            a_matched++;
            await dblog(runId, 'info', `✔ Artist matched: ${y.name}`, { yaId: y.ymId, name: y.name, mbid: r.externalId });
          } else {
            await prisma.mbSyncItem.upsert({
              where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
              create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastError: 'not-found' },
              update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: 'not-found' },
            });
            await dblog(runId, 'info', `✖ Artist not matched: ${y.name}`, { yaId: y.ymId, name: y.name });
          }
        } catch (e: any) {
          await prisma.mbSyncItem.upsert({
            where: { kind_targetId: { kind: 'yandex-artist', targetId: y.id } },
            create: { kind: 'yandex-artist', targetId: y.id, attempts: 1, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
            update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
          });
          await dblog(runId, 'warn', 'MB lookup failed', { id: y.id, name: y.name, error: String(e?.message || e) });
        }

        a_done++;
        if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched });
      }
      await patchRunStats(runId, { a_done, a_matched });
    }

    if (target === 'albums' || target === 'both') {
      const base = await prisma.yandexAlbum.findMany({
        where: force ? { present: true } : { present: true, rgMbid: null },
        orderBy: { id: 'asc' },
        select: { id: true, ymId: true, title: true, artist: true, rgMbid: true },
      });

      let candidates = base;
      if (!force) {
        const syncItems = await prisma.mbSyncItem.findMany({
          where: { kind: 'yandex-album', targetId: { in: base.map(x => x.id) } },
          select: { targetId: true, lastCheckedAt: true },
        });
        const lastById = new Map(syncItems.map(s => [s.targetId, s.lastCheckedAt]));
        candidates = base.filter(x => {
          if (x.rgMbid) return false;
          const last = lastById.get(x.id);
          return !last || last < retryBefore;
        });
      }

      await patchRunStats(runId, { al_total: candidates.length });
      await dblog(runId, 'info', 'MB Match (albums) started', {
        target, force,
        totalAlbums:  await prisma.yandexAlbum.count({ where: { present: true } }),
        matchedAlbums: await prisma.yandexAlbum.count({ where: { present: true, rgMbid: { not: null } } }),
      });

      let al_done = 0, al_matched = 0;
      for (const rec of candidates) {
        if (await bailIfCancelled(runId, 'match-albums')) return;

        try {
          const r = await mbFindReleaseGroup(rec.artist || '', rec.title);
          await prisma.cacheEntry.upsert({
            where: { key: `ya:album:${rec.ymId}` },
            create: { scope: 'ya:album', key: `ya:album:${rec.ymId}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          if (r.externalId) {
            await prisma.$transaction([
              prisma.yandexAlbum.update({ where: { id: rec.id }, data: { rgMbid: r.externalId } }),
              prisma.mbSyncItem.upsert({
                where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
                create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
                update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
              }),
            ]);
            al_matched++;
            await dblog(runId, 'info', `✔ Album matched: ${rec.artist} - ${rec.title}`, { yaId: rec.ymId, artist: rec.artist, title: rec.title, rgMbid: r.externalId });
          } else {
            await prisma.mbSyncItem.upsert({
              where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
              create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastError: 'not-found' },
              update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: 'not-found' },
            });
            await dblog(runId, 'info', `✖ Album not matched: ${rec.artist} - ${rec.title}`, { yaId: rec.ymId, artist: rec.artist, title: rec.title });
          }
        } catch (e: any) {
          await prisma.mbSyncItem.upsert({
            where: { kind_targetId: { kind: 'yandex-album', targetId: rec.id } },
            create: { kind: 'yandex-album', targetId: rec.id, attempts: 1, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
            update: { attempts: { increment: 1 }, lastCheckedAt: new Date(), lastError: String(e?.message || e) },
          });
          await dblog(runId, 'warn', 'MB lookup failed', { id: rec.id, title: rec.title, error: String(e?.message || e) });
        }

        al_done++;
        if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched });
      }
      await patchRunStats(runId, { al_done, al_matched });
    }

    await patchRunStats(runId, { phase: 'done' });
    await evFinish(runId, { kind: 'mb.match', target, force, elapsedMs: elapsedMs(t0) });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('match', 'ok', stats); } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'MB Match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('match', 'error', stats); } catch {}
    await evError(runId, { kind: 'mb.match', target, force, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}

export async function runCustomArtistsMatch(reuseRunId?: number, opts?: { onlyId?: number; force?: boolean }) {
  const force = !!opts?.force;
  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRunWithKind('custom', { phase: 'match', c_total: 0, c_done: 0, c_matched: 0 });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'custom.match', onlyId: opts?.onlyId ?? null, force });
  try {
    let items: { id: number; name: string; mbid: string | null }[] = [];

    if (opts?.onlyId) {
      const one = await prisma.customArtist.findUnique({ where: { id: opts.onlyId }, select: { id: true, name: true, mbid: true } });
      items = one ? [one] : [];
    } else {
      items = await prisma.customArtist.findMany({ select: { id: true, name: true, mbid: true }, orderBy: { id: 'asc' } });
    }

    await patchRunStats(runId, { c_total: items.length });
    await dblog(runId, 'info', `Custom match started`, { total: items.length, onlyId: opts?.onlyId ?? null, force });

    let c_done = 0;
    let c_matched = 0;

    for (const it of items) {
      if (await bailIfCancelled(runId, 'custom-match')) return;

      if (it.mbid && !force) {
        c_done++;
        if (c_done % 5 === 0) await patchRunStats(runId, { c_done, c_matched });
        continue;
      }

      try {
        const r = await mbFindArtist(it.name);

        await prisma.cacheEntry.upsert({
          where: { key: `custom:artist:${it.id}` },
          create: { scope: 'custom:artist', key: `custom:artist:${it.id}`, payload: JSON.stringify(r.raw ?? r) },
          update: { payload: JSON.stringify(r.raw ?? r) },
        });

        if (r.externalId) {
          await prisma.customArtist.update({ where: { id: it.id }, data: { mbid: r.externalId, matchedAt: new Date() } });
          c_matched++;
          await dblog(runId, 'info', `✔ Custom artist matched: ${it.name}`, { id: it.id, name: it.name, mbid: r.externalId });
        } else {
          await dblog(runId, 'info', `✖ Custom artist not matched: ${it.name}`, { id: it.id, name: it.name });
        }
      } catch (e: any) {
        await dblog(runId, 'warn', 'MB lookup failed', { id: it.id, name: it.name, error: String(e?.message || e) });
      }

      c_done++;
      if (c_done % 5 === 0) await patchRunStats(runId, { c_done, c_matched });
    }

    await patchRunStats(runId, { c_done, c_matched, phase: 'done' });
    await endRun(runId, 'ok');
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('match', 'ok', stats);} catch {}
    await evFinish(runId, { kind: 'custom.match', force, onlyId: opts?.onlyId ?? null, elapsedMs: elapsedMs(t0) });
  } catch (e: any) {
    await dblog(runId, 'error', 'Custom match failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try { const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {}; await (await import('../notify.js')).notify('match', 'error', stats); } catch {}
    await evError(runId, { kind: 'custom.match', force, onlyId: opts?.onlyId ?? null, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}
