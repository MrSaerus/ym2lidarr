import { startRun, endRun, patchRunStats, log as dblog } from './log';
import { notify } from './notify';
import { prisma } from './prisma';
import { ensureArtistInLidarr, ensureAlbumInLidarr } from './services/lidarr';
import { mbFindArtist, mbFindReleaseGroup } from './services/mb';
import { yandexPullLikes, setPyproxyUrl, getDriver } from './services/yandex';

function nkey(s: string) {
  return s.trim().toLowerCase();
}

const RECHECK_HOURS = parseInt(process.env.MB_RECHECK_HOURS || '168', 10); // 7 дней по умолчанию
function shouldRecheck(last?: Date | null, force = false) {
  if (force) return true;
  if (!last) return true;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs >= RECHECK_HOURS * 3600_000;
}

async function getRunWithRetry(id: number, tries = 3, ms = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await prisma.syncRun.findUnique({ where: { id } });
      if (r) return r;
    } catch {
      // ignore
    }
    await new Promise((res) => setTimeout(res, ms));
  }
  return prisma.syncRun.findUnique({ where: { id } });
}

/**
 * Синк Яндекс → БД (матчинг в MusicBrainz)
 * @param tokenOverride - опционально токен «на раз»
 * @param reuseRunId    - если задан, используем уже созданный run (например, создан маршрутом)
 * @param opts.force    - форсировать рематч без cool-down
 */
export async function runYandexSync(
    tokenOverride?: string,
    reuseRunId?: number,
    opts?: { force?: boolean },
) {
  const force = !!opts?.force;

  const setting = await prisma.setting.findFirst({ where: { id: 1 } });

  // pyproxy URL и драйвер из настроек
  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
  const driver = getDriver(setting?.yandexDriver);

  // токен
  const token =
      tokenOverride || setting?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN;

  if (!token) {
    await prisma.syncRun.create({
      data: { kind: 'yandex', status: 'error', message: 'No Yandex token (db/env)' },
    });
    return;
  }

  // создаём/подготавливаем run
  let runId: number;
  if (reuseRunId) {
    runId = reuseRunId;
    await patchRunStats(runId, {
      phase: 'pull',
      a_total: 0,
      a_done: 0,
      a_matched: 0,
      al_total: 0,
      al_done: 0,
      al_matched: 0,
    });
  } else {
    const run = await startRun('yandex', {
      phase: 'pull',
      a_total: 0,
      a_done: 0,
      a_matched: 0,
      al_total: 0,
      al_done: 0,
      al_matched: 0,
    });
    if (!run) return;
    runId = run.id;
  }

  try {
    await dblog(runId, 'info', 'Pulling likes from Yandex…', { driver });

    const { artists, albums } = await yandexPullLikes(token, { driver });

    // событие старта — для компактного отображения в логах
    await dblog(runId, 'info', 'Fetch likes from Yandex', {
      event: 'start',
      artists: artists.length,
      albums: albums.length,
      driver,
    });

    await patchRunStats(runId, {
      a_total: artists.length,
      al_total: albums.length,
      phase: 'match',
    });
    await dblog(runId, 'info', `Got ${artists.length} artists, ${albums.length} albums`);

    // ===== Artists matching =====
    let a_done = 0,
        a_matched = 0,
        a_skipped = 0;

    for (const name of artists) {
      const key = nkey(name);

      let a = await prisma.artist.upsert({
        where: { key },
        create: { key, name },
        update: { name },
      });

      if (!a.mbid) {
        if (!shouldRecheck(a.mbCheckedAt, force)) {
          a_skipped++;
          await dblog(runId, 'debug', 'Artist skip (cool-down)', {
            name,
            last: a.mbCheckedAt,
            hours: RECHECK_HOURS,
          });
        } else {
          const r = await mbFindArtist(name);

          // кэш
          await prisma.cacheEntry.upsert({
            where: { key: `artist:${key}` },
            create: {
              scope: 'artist',
              key: `artist:${key}`,
              payload: JSON.stringify(r.raw ?? r),
            },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          // кандидаты
          await prisma.artistCandidate.deleteMany({ where: { artistId: a.id } });
          if (Array.isArray(r.candidates) && r.candidates.length) {
            await prisma.artistCandidate.createMany({
              data: r.candidates.map((c: any) => ({
                artistId: a.id,
                mbid: c.id,
                name: c.name || '',
                score: c.score ?? null,
                type: c.type || null,
                country: c.country || null,
                url: c.url || null,
                highlight: !!c.highlight,
              })),
            });
          }

          if (r.mbid) {
            a = await prisma.artist.update({
              where: { id: a.id },
              data: {
                mbid: r.mbid,
                matched: true,
                mbCheckedAt: new Date(),
                mbAttempts: { increment: 1 },
              },
            });
            a_matched++;
            // компактная строка в логах
            await dblog(runId, 'info', 'Artist matched', {
              event: 'artist:found',
              name,
              mbid: r.mbid,
            });
          } else {
            a = await prisma.artist.update({
              where: { id: a.id },
              data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            await dblog(runId, 'info', 'Artist not matched', {
              event: 'artist:not_found',
              name,
            });
          }
        }
      } else {
        a_matched++;
      }

      a_done++;
      if (a_done % 5 === 0) {
        await patchRunStats(runId, { a_done, a_matched, a_skipped });
      }
    }
    await patchRunStats(runId, { a_done, a_matched, a_skipped });

    // ===== Albums matching =====
    let al_done = 0,
        al_matched = 0,
        al_skipped = 0;

    for (const al of albums) {
      const key = nkey(`${al.artist}|||${al.title}`);

      let rec = await prisma.album.upsert({
        where: { key },
        create: { key, artist: al.artist, title: al.title, year: al.year || null },
        update: { artist: al.artist, title: al.title, year: al.year || null },
      });

      if (!rec.rgMbid) {
        if (!shouldRecheck(rec.mbCheckedAt, force)) {
          al_skipped++;
          await dblog(runId, 'debug', 'Album skip (cool-down)', {
            artist: al.artist,
            title: al.title,
            last: rec.mbCheckedAt,
            hours: RECHECK_HOURS,
          });
        } else {
          const r = await mbFindReleaseGroup(al.artist, al.title);

          // кэш
          await prisma.cacheEntry.upsert({
            where: { key: `album:${key}` },
            create: {
              scope: 'album',
              key: `album:${key}`,
              payload: JSON.stringify(r.raw ?? r),
            },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });

          // кандидаты
          await prisma.albumCandidate.deleteMany({ where: { albumId: rec.id } });
          if (Array.isArray(r.candidates) && r.candidates.length) {
            await prisma.albumCandidate.createMany({
              data: r.candidates.map((c: any) => ({
                albumId: rec.id,
                rgMbid: c.id,
                title: c.title || '',
                primaryType: c.primaryType || null,
                firstReleaseDate: c.firstReleaseDate || null,
                primaryArtist: c.primaryArtist || null,
                score: c.score ?? null,
                url: c.url || null,
                highlight: !!c.highlight,
              })),
            });
          }

          if (r.mbid) {
            rec = await prisma.album.update({
              where: { id: rec.id },
              data: {
                rgMbid: r.mbid,
                matched: true,
                mbCheckedAt: new Date(),
                mbAttempts: { increment: 1 },
              },
            });
            al_matched++;
            await dblog(runId, 'info', 'Album matched', {
              event: 'album:found',
              artist: al.artist,
              title: al.title,
              mbid: r.mbid,
            });
          } else {
            rec = await prisma.album.update({
              where: { id: rec.id },
              data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            await dblog(runId, 'info', 'Album not matched', {
              event: 'album:not_found',
              artist: al.artist,
              title: al.title,
            });
          }
        }
      } else {
        al_matched++;
      }

      al_done++;
      if (al_done % 5 === 0) {
        await patchRunStats(runId, { al_done, al_matched, al_skipped });
      }
    }
    await patchRunStats(runId, { al_done, al_matched, al_skipped, phase: 'done' });

    // финальная сводка для компактного отображения
    await dblog(runId, 'info', 'Matching finished', {
      event: 'finish',
      artists: { total: artists.length, matched: a_matched, skipped: a_skipped },
      albums: { total: albums.length, matched: al_matched, skipped: al_skipped },
    });

    await endRun(runId, 'ok');

    // уведомление
    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('yandex', 'ok', stats);
    } catch {
      /* noop */
    }
  } catch (e: any) {
    await dblog(runId, 'error', 'Yandex sync failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));

    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('yandex', 'error', stats);
    } catch {
      /* noop */
    }
  }
}

/**
 * Пуш результатов в Lidarr (артисты по умолчанию, либо альбомы — из настроек)
 */
export async function runLidarrPush() {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({
      data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' },
    });
    return;
  }

  const run = await startRun('lidarr', {
    phase: 'push',
    total: 0,
    done: 0,
    ok: 0,
    failed: 0,
    target: setting.pushTarget || 'artists',
  });
  if (!run) return;

  try {
    const target = setting.pushTarget === 'albums' ? 'albums' : 'artists';

    const items =
        target === 'albums'
            ? await prisma.album.findMany({
              where: { matched: true, rgMbid: { not: null } },
              orderBy: [{ artist: 'asc' }, { title: 'asc' }],
            })
            : await prisma.artist.findMany({
              where: { matched: true, mbid: { not: null } },
              orderBy: { name: 'asc' },
            });

    await patchRunStats(run.id, { total: items.length });
    await dblog(run.id, 'info', `Pushing ${items.length} ${target} to Lidarr`);

    let done = 0,
        ok = 0,
        failed = 0;

    for (const it of items) {
      try {
        if (target === 'albums') {
          await ensureAlbumInLidarr(setting as any, {
            artist: (it as any).artist,
            title: (it as any).title,
            rgMbid: (it as any).rgMbid!,
          });
        } else {
          await ensureArtistInLidarr(setting as any, {
            name: (it as any).name,
            mbid: (it as any).mbid!,
          });
        }
        ok++;
        await dblog(run.id, 'info', 'Pushed', { target, item: it.id });
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', 'Push failed', {
          target,
          item: it.id,
          error: String(e?.message || e),
        });
      }

      done++;
      if (done % 5 === 0) await patchRunStats(run.id, { done, ok, failed });
    }

    await patchRunStats(run.id, { done, ok, failed, phase: 'done' });
    await endRun(run.id, 'ok');

    const finalRun = await getRunWithRetry(run.id);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('lidarr', 'ok', stats);
    } catch {
      /* noop */
    }
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));

    const finalRun = await getRunWithRetry(run.id);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('lidarr', 'error', stats);
    } catch {
      /* noop */
    }
  }
}
