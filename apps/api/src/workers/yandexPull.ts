// apps/api/src/workers/yandexPull.ts
import { setPyproxyUrl, yandexPullLikes } from '../services/yandex';
import { createLogger } from '../lib/logger';
import {
  prisma, startRun, endRun, patchRunStats, dblog,
  nkey, evStart, evFinish, evError, now, elapsedMs, bailIfCancelled, getRunWithRetry,
} from './_common';

const log = createLogger({ scope: 'worker.yandex.pull' });

export async function runYandexPull(tokenOverride?: string, reuseRunId?: number) {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');

  const watermark = new Date();
  const token =
    tokenOverride ||
    setting?.yandexToken ||
    process.env.YANDEX_MUSIC_TOKEN ||
    process.env.YM_TOKEN;

  if (!token) {
    await prisma.syncRun.create({ data: { kind: 'yandex', status: 'error', message: 'No Yandex token (db/env)' } });
    return;
  }

  const run = reuseRunId
    ? { id: reuseRunId }
    : await startRun('yandex', { phase: 'pull', a_total: 0, a_done: 0, al_total: 0, al_done: 0, t_total: 0, t_done: 0 });

  if (!run) return;
  const runId = run.id;
  const t0 = now();
  await evStart(runId, { kind: 'yandex.pull', driver: 'pyproxy' });

  try {
    await dblog(runId, 'info', 'Pulling likes from Yandex (pyproxy)…', { driver: 'pyproxy' });
    if (await bailIfCancelled(runId, 'pull-start')) return;

    const { artists, albums, tracks } = await yandexPullLikes(token);
    await patchRunStats(runId, {
      a_total: artists.length,
      al_total: albums.length,
      t_total: tracks.length,
    });
    await dblog(runId, 'info', `Got ${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);

    /* ========== ARTISTS ========== */
    let a_done = 0;
    for (const a of artists as Array<{ id?: number | string; name: string }>) {
      if (await bailIfCancelled(runId, 'pull-artists')) return;

      const name = String(a?.name || '').trim();
      if (!name) { a_done++; if (a_done % 50 === 0) await patchRunStats(runId, { a_done }); continue; }

      const ymIdStr = String(a?.id ?? '').trim();
      if (ymIdStr) {
        await prisma.yandexArtist.upsert({
          where: { ymId: ymIdStr },
          create: {
            ymId: ymIdStr, name, key: nkey(name),
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
          },
          update: {
            name, key: nkey(name),
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
          },
        });
      }
      a_done++;
      if (a_done % 50 === 0) await patchRunStats(runId, { a_done });
    }
    await patchRunStats(runId, { a_done });

    /* ========== ALBUMS ========== */
    let al_done = 0;
    for (const alb of albums as Array<{ id?: number | string; title: string; artistName: string; year?: number; artistId?: number | string }>) {
      if (await bailIfCancelled(runId, 'pull-albums')) return;

      const title = String(alb?.title || '').trim();
      const artistName = String(alb?.artistName || '').trim();
      if (!title) { al_done++; if (al_done % 50 === 0) await patchRunStats(runId, { al_done }); continue; }

      const ymAlbumIdStr  = String(alb?.id ?? '').trim();
      const ymArtistIdStr = String(alb?.artistId ?? '').trim();
      const year = Number.isFinite(Number(alb?.year)) ? Number(alb!.year) : null;

      if (ymAlbumIdStr) {
        await prisma.yandexAlbum.upsert({
          where: { ymId: ymAlbumIdStr },
          create: {
            ymId: ymAlbumIdStr, title, artist: artistName || null, year,
            key: nkey(`${artistName}|||${title}`),
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
            yandexArtistId: ymArtistIdStr || null,
          },
          update: {
            title, artist: artistName || null, year,
            key: nkey(`${artistName}|||${title}`),
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
            yandexArtistId: ymArtistIdStr || null,
          },
        });
      }

      al_done++;
      if (al_done % 50 === 0) await patchRunStats(runId, { al_done });
    }
    await patchRunStats(runId, { al_done });

    /* ========== TRACKS ========== */
    let t_done = 0;
    let skipNoTitle = 0;
    let skipNoArtistName = 0;
    let skipEmptyId = 0;
    let conflictKeyUpdates = 0;
    let otherWriteErrors = 0;

    for (const tr of tracks as Array<{
      id?: number | string; title: string; artistName: string; albumTitle?: string; durationSec?: number; albumId?: number | string; artistId?: number | string;
    }>) {
      if (await bailIfCancelled(runId, 'pull-tracks')) return;

      const title = String(tr?.title || '').trim();
      const artistName = String(tr?.artistName || '').trim();
      if (!title) { skipNoTitle++; t_done++; if (t_done % 100 === 0) await patchRunStats(runId, { t_done }); continue; }
      if (!artistName) { skipNoArtistName++; t_done++; if (t_done % 100 === 0) await patchRunStats(runId, { t_done }); continue; }

      // Разрешаем ЛЮБОЙ непустой строковый ID (раньше отбрасывали всё не-цифровое)
      const ymTrackIdStr = String(tr?.id ?? '').trim();
      if (!ymTrackIdStr) { skipEmptyId++; t_done++; if (t_done % 100 === 0) await patchRunStats(runId, { t_done }); continue; }

      const albumTitle = String(tr?.albumTitle || '').trim() || null;
      const durationSec = Number.isFinite(Number(tr?.durationSec)) ? Number(tr!.durationSec) : null;
      const ymAlbumIdStr  = String(tr?.albumId  ?? '').trim();
      const ymArtistIdStr = String(tr?.artistId ?? '').trim();

      const dur = Number.isFinite(durationSec as any) ? durationSec : 0;
      const key = nkey(`${artistName}|||${title}|||${dur}`);

      try {
        await prisma.yandexTrack.upsert({
          where: { ymId: ymTrackIdStr }, // upsert по первичному ключу
          create: {
            ymId: ymTrackIdStr,
            title, artist: artistName, album: albumTitle,
            durationSec: durationSec ?? null,
            key,
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
            ymAlbumId:  ymAlbumIdStr || null,
            ymArtistId: ymArtistIdStr || null,
          },
          update: {
            title, artist: artistName, album: albumTitle,
            durationSec: durationSec ?? null,
            key,
            present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
            ymAlbumId:  ymAlbumIdStr || null,
            ymArtistId: ymArtistIdStr || null,
          },
        });
      } catch (e: any) {
        // Конфликт по уникальному ключу "key" (P2002) — обновим существующую запись по key
        const code = e?.code || e?.meta?.code || '';
        const isUnique = code === 'P2002' || /Unique constraint failed/i.test(String(e?.message || e));
        const mentionsKey = /`?key`?/i.test(String(e?.message || e)) || (Array.isArray(e?.meta?.target) && e.meta.target.includes('key'));

        if (isUnique && mentionsKey) {
          try {
            await prisma.yandexTrack.update({
              where: { key }, // обновляем по уникальному key
              data: {
                // ВАЖНО: ymId — первичный ключ, его НЕ трогаем.
                title, artist: artistName, album: albumTitle,
                durationSec: durationSec ?? null,
                present: true, lastSeenAt: watermark, yGone: false, yGoneAt: null,
                ymAlbumId:  ymAlbumIdStr || null,
                ymArtistId: ymArtistIdStr || null,
              },
            });
            conflictKeyUpdates++;
          } catch (e2: any) {
            otherWriteErrors++;
            await dblog(runId, 'warn', 'Track write failed after key-conflict', {
              err: String(e2?.message || e2),
              key, ymId: ymTrackIdStr,
            });
          }
        } else {
          otherWriteErrors++;
          await dblog(runId, 'warn', 'Track write failed', {
            err: String(e?.message || e),
            key, ymId: ymTrackIdStr,
          });
        }
      }

      t_done++;
      if (t_done % 100 === 0) await patchRunStats(runId, { t_done });
    }
    await patchRunStats(runId, { t_done });

    // Диагностика причин пропуска/конфликтов
    await dblog(runId, 'info', 'Yandex pull track stats', {
      skipNoTitle, skipNoArtistName, skipEmptyId, conflictKeyUpdates, otherWriteErrors,
    });

    /* ========== MARK GONE ========== */
    await prisma.$transaction([
      prisma.yandexArtist.updateMany({
        where: { OR: [{ lastSeenAt: { lt: watermark } }, { lastSeenAt: null }] },
        data: { yGone: true, yGoneAt: new Date() },
      }),
      prisma.yandexAlbum.updateMany({
        where: { OR: [{ lastSeenAt: { lt: watermark } }, { lastSeenAt: null }] },
        data: { yGone: true, yGoneAt: new Date() },
      }),
      prisma.yandexTrack.updateMany({
        where: { OR: [{ lastSeenAt: { lt: watermark } }, { lastSeenAt: null }] },
        data: { yGone: true, yGoneAt: new Date() },
      }),
    ]);

    await patchRunStats(runId, { phase: 'done' });
    await evFinish(runId, {
      kind: 'yandex.pull',
      a_total: (await prisma.yandexArtist.count()),
      al_total: (await prisma.yandexAlbum.count()),
      elapsedMs: elapsedMs(t0),
    });
    await endRun(runId, 'ok');

    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await (await import('../notify.js')).notify('yandex', 'ok', stats);
    } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Yandex Pull failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await (await import('../notify.js')).notify('yandex', 'error', stats);
    } catch {}
    await evError(runId, { kind: 'yandex.pull', error: String(e?.message || e), elapsedMs: elapsedMs(t0) });
  }
}
