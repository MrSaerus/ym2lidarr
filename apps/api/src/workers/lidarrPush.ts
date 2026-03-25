// apps/api/src/workers/lidarrPush.ts
import {
  prisma, startRun, startRunWithKind, patchRunStats, endRun, dblog,
  evStart, evFinish, evError, now, elapsedMs, bailIfCancelled, getRunWithRetry,
} from './_common';
import { pushArtistWithConfirm, pushAlbumWithConfirm } from '../services/lidarr';

export async function runLidarrPush(
  overrideTarget?: 'artists' | 'albums',
  source?: 'yandex' | 'custom',
) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const target: 'artists' | 'albums' =
    overrideTarget ?? (setting?.pushTarget === 'albums' ? 'albums' : 'artists');
  const src: 'yandex' | 'custom' = source === 'custom' ? 'custom' : 'yandex';
  const allowRepush = !!setting?.allowRepush;

  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRun('lidarr', { phase: 'push', total: 0, done: 0, ok: 0, failed: 0, target, source: src });
  if (!run) return;

  const t0 = now();
  await evStart(run.id, { kind: 'lidarr.push', target, source: src, allowRepush });

  let done = 0, ok = 0, failed = 0;

  const heartbeatMs = 15_000;
  const hb = setInterval(() => {
    patchRunStats(run.id, { done, ok, failed, heartbeatAt: Date.now() } as any).catch(() => {});
  }, heartbeatMs);

  try {
    let items: any[] = [];

    if (target === 'albums') {
      const base = await prisma.yandexAlbum.findMany({
        where: { present: true, rgMbid: { not: null } },
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      });

      if (allowRepush) items = base;
      else {
        const already = await prisma.albumPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter(x => x.rgMbid && !pushed.has(x.rgMbid!));
      }
    } else {
      const base = src === 'custom'
        ? await prisma.customArtist.findMany({ where: { mbid: { not: null } }, orderBy: { name: 'asc' } })
        : await prisma.yandexArtist.findMany({ where: { present: true, mbid: { not: null } }, orderBy: { name: 'asc' } });

      if (allowRepush) items = base;
      else {
        const already = await prisma.artistPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter((x: any) => x.mbid && !pushed.has(x.mbid));
      }
    }

    await patchRunStats(run.id, { total: items.length });
    await dblog(run.id, 'info', `Pushing ${items.length} ${target} to Lidarr (source=${src})`);

    const effSetting = { ...(setting as any) };

    for (const it of items as any[]) {
      if (await bailIfCancelled(run.id, 'lidarr-push')) return;

      try {
        if (target === 'albums') {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) =>
            dblog(run.id, level, msg, extra);

          const result = await pushAlbumWithConfirm(
            effSetting,
            { artist: it.artist, title: it.title, rgMbid: it.rgMbid! },
            log,
            {
              maxAttempts: 5,
              initialDelayMs: 1500,
              shouldAbort: () => bailIfCancelled(run.id, 'lidarr-push'),
            }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const title    = confirmed?.title || it.title;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            if (it.rgMbid) {
              const existing = await prisma.albumPush.findFirst({ where: { mbid: it.rgMbid } });
              if (existing) {
                await prisma.albumPush.update({
                  where: { id: existing.id },
                  data: {
                    title,
                    path,
                    lidarrAlbumId: lidarrId ?? null,
                    status: action === 'exists' ? 'EXISTS' : 'CREATED',
                  },
                });
              } else {
                await prisma.albumPush.create({
                  data: {
                    mbid: it.rgMbid,
                    title,
                    path,
                    lidarrAlbumId: lidarrId ?? null,
                    status: action === 'exists' ? 'EXISTS' : 'CREATED',
                    source: 'push',
                  },
                });
              }
            }
            ok++;
          } else {
            if (result.reason === 'cancelled') {
              await dblog(run.id, 'warn', `Cancelled during album push: ${it.artist} — ${it.title}`, { target, rgMbid: it.rgMbid });
              return;
            }
            failed++;
            await dblog(run.id, 'warn', `✖ Album push failed: ${it.artist} — ${it.title}`, {
              target, rgMbid: it.rgMbid, reason: result.reason,
            });
          }
        } else {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) =>
            dblog(run.id, level, msg, extra);

          const result = await pushArtistWithConfirm(
            effSetting,
            { name: it.name, mbid: it.mbid! },
            log,
            {
              maxAttempts: 5,
              initialDelayMs: 1500,
              shouldAbort: () => bailIfCancelled(run.id, 'lidarr-push'),
            }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const name     = confirmed?.artistName || it.name;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            const existing = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
            if (existing) {
              await prisma.artistPush.update({
                where: { id: existing.id },
                data: {
                  name,
                  path,
                  lidarrArtistId: lidarrId ?? null,
                  status: action === 'exists' ? 'EXISTS' : 'CREATED',
                },
              });
            } else {
              await prisma.artistPush.create({
                data: {
                  mbid: it.mbid,
                  name,
                  path,
                  lidarrArtistId: lidarrId ?? null,
                  status: action === 'exists' ? 'EXISTS' : 'CREATED',
                  source: src === 'custom' ? 'custom-push' : 'push',
                },
              });
            }
            ok++;
          } else {
            if (result.reason === 'cancelled') {
              await dblog(run.id, 'warn', `Cancelled during artist push: ${it.name}`, { target, mbid: it.mbid });
              return;
            }
            failed++;
            await dblog(run.id, 'warn', `✖ Push failed: ${it.name}`, { target, mbid: it.mbid, reason: result.reason });
          }
        }
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `Push exception: ${String(e?.message || e)}`, { target });
      }

      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    await patchRunStats(run.id, { done, ok, failed, phase: 'done' });
    await endRun(run.id, 'ok');

    const finalRun = await getRunWithRetry(run.id);
    await evFinish(run.id, {
      kind: 'lidarr.push',
      target,
      source: src,
      allowRepush,
      totals: { done, ok, failed },
      elapsedMs: elapsedMs(t0),
    });

    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await (await import('../notify.js')).notify('lidarr', 'ok', stats);
    } catch {}
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));

    const finalRun = await getRunWithRetry(run.id);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await (await import('../notify.js')).notify('lidarr', 'error', stats);
    } catch {}

    await evError(run.id, {
      kind: 'lidarr.push',
      target,
      source: src,
      error: String(e?.message || e),
      elapsedMs: elapsedMs(t0),
    });
  } finally {
    clearInterval(hb);
  }
}

type PushExOpts = {
  target?: 'artists'|'albums';
  source?: 'yandex'|'custom';
  reuseRunId?: number;
  noFinalize?: boolean;
  kindOverride?: string;
  allowRepushOverride?: boolean;
};

export async function runLidarrPushEx(opts: PushExOpts = {}) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  const target: 'artists'|'albums' = opts.target ?? 'artists';
  const source: 'yandex'|'custom' = opts.source ?? 'yandex';
  const allowRepush = opts.allowRepushOverride ?? !!setting?.allowRepush;

  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({ data: { kind: opts.kindOverride || 'lidarr.push', status: 'error', message: 'No Lidarr URL or API key' } });
    return;
  }

  const run = await startRunWithKind(
    opts.kindOverride || (source === 'custom' ? `custom.push.${target}` : `yandex.push.${target}`),
    { phase: 'push', total: 0, done: 0, ok: 0, failed: 0, target, source },
    opts.reuseRunId
  );
  if (!run) return;

  await dblog(run.id, 'info', `Push start`, { target, source });
  const t0 = now();
  await evStart(run.id, { kind: 'lidarr.push.ex', target, source, allowRepush });

  let done = 0, ok = 0, failed = 0;

  const heartbeatMs = 15_000;
  const hb = setInterval(() => {
    patchRunStats(run.id, { done, ok, failed, heartbeatAt: Date.now() } as any).catch(() => {});
  }, heartbeatMs);

  try {
    let items: any[] = [];

    if (target === 'albums') {
      const base = await prisma.yandexAlbum.findMany({
        where: { present: true, rgMbid: { not: null } },
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      });

      if (allowRepush) items = base;
      else {
        const already = await prisma.albumPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter(x => x.rgMbid && !pushed.has(x.rgMbid!));
      }
    } else {
      const base = source === 'custom'
        ? await prisma.customArtist.findMany({ where: { mbid: { not: null } }, orderBy: { name: 'asc' } })
        : await prisma.yandexArtist.findMany({ where: { present: true, mbid: { not: null } }, orderBy: { name: 'asc' } });

      if (allowRepush) items = base;
      else {
        const already = await prisma.artistPush.findMany({ select: { mbid: true }, where: { mbid: { not: null } } });
        const pushed = new Set(already.map(x => x.mbid!).filter(Boolean));
        items = base.filter((x: any) => x.mbid && !pushed.has(x.mbid));
      }
    }

    const total = items.length;
    await patchRunStats(run.id, { total });

    const effSetting = { ...(setting as any) };

    for (const it of items as any[]) {
      if (await bailIfCancelled(run.id, 'lidarr-push')) return;

      try {
        if (target === 'albums') {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) =>
            dblog(run.id, level, msg, extra);

          const result = await pushAlbumWithConfirm(
            effSetting,
            { artist: it.artist, title: it.title, rgMbid: it.rgMbid! },
            log,
            {
              maxAttempts: 5,
              initialDelayMs: 1500,
              shouldAbort: () => bailIfCancelled(run.id, 'lidarr-push'),
            }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const title    = confirmed?.title || it.title;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            if (it.rgMbid) {
              const existing = await prisma.albumPush.findFirst({ where: { mbid: it.rgMbid } });
              if (existing) {
                await prisma.albumPush.update({
                  where: { id: existing.id },
                  data: { title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
                });
              } else {
                await prisma.albumPush.create({
                  data: { mbid: it.rgMbid, title, path, lidarrAlbumId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: 'push' },
                });
              }
            }
            ok++;
          } else {
            if (result.reason === 'cancelled') {
              await dblog(run.id, 'warn', `Cancelled during album push: ${it.artist} — ${it.title}`, { target, rgMbid: it.rgMbid });
              return;
            }
            failed++;
            await dblog(run.id, 'warn', `✖ Album push failed: ${it.artist} — ${it.title}`, { target, rgMbid: it.rgMbid, reason: result.reason });
          }
        } else {
          const log = (level: 'info'|'warn'|'error', msg: string, extra?: any) =>
            dblog(run.id, level, msg, extra);

          const result = await pushArtistWithConfirm(
            effSetting,
            { name: it.name, mbid: it.mbid! },
            log,
            {
              maxAttempts: 5,
              initialDelayMs: 1500,
              shouldAbort: () => bailIfCancelled(run.id, 'lidarr-push'),
            }
          );

          if (result.ok) {
            const confirmed = result.res;
            const action   = confirmed?.__action || 'created';
            const name     = confirmed?.artistName || it.name;
            const lidarrId = confirmed?.id ?? null;
            const path     = confirmed?.path ?? null;

            const existing = await prisma.artistPush.findFirst({ where: { mbid: it.mbid } });
            if (existing) {
              await prisma.artistPush.update({
                where: { id: existing.id },
                data: { name, path, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED' },
              });
            } else {
              await prisma.artistPush.create({
                data: { mbid: it.mbid, name, path, lidarrArtistId: lidarrId ?? null, status: action === 'exists' ? 'EXISTS' : 'CREATED', source: source === 'custom' ? 'custom-push' : 'push' },
              });
            }
            ok++;
          } else {
            if (result.reason === 'cancelled') {
              await dblog(run.id, 'warn', `Cancelled during artist push: ${it.name}`, { target, mbid: it.mbid });
              return;
            }
            failed++;
            await dblog(run.id, 'warn', `✖ Push failed: ${it.name}`, { target, mbid: it.mbid, reason: result.reason });
          }
        }
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `✖ Push exception: ${String(e?.message || e)}`, { target });
      }

      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    const skipped = Math.max(0, total - (ok + failed));
    await dblog(run.id, 'info', `Push finished: target ${target}, source ${source}, allowRepush ${allowRepush}, total ${total}, ok ${ok}, failed ${failed}, skipped ${skipped}`, {
      target, source, allowRepush, total, ok, failed, skipped,
    });

    await evFinish(run.id, { kind: 'lidarr.push.ex', target, source, allowRepush, totals: { done, ok, failed, skipped }, elapsedMs: elapsedMs(t0) });
    await patchRunStats(run.id, { done, ok, failed });

    if (!opts.noFinalize) {
      await patchRunStats(run.id, { phase: 'done' });
      await endRun(run.id, 'ok');

      const finalRun = await getRunWithRetry(run.id);
      try {
        const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
        await (await import('../notify.js')).notify('lidarr', 'ok', stats);
      } catch {}
    }
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });

    if (!opts.noFinalize) {
      await endRun(run.id, 'error', String(e?.message || e));
      await evError(run.id, { kind: 'lidarr.push.ex', target, source, error: String(e?.message || e), elapsedMs: elapsedMs(t0) });

      const finalRun = await getRunWithRetry(run.id);
      try {
        const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
        await (await import('../notify.js')).notify('lidarr', 'error', stats);
      } catch {}
    }
  } finally {
    clearInterval(hb);
  }
}
