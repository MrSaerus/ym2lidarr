import { startRun, endRun, patchRunStats, log as dblog } from './log';
import { notify } from './notify';
import { prisma } from './prisma';
import {
  ensureArtistInLidarr,
  ensureAlbumInLidarr,
  getRootFolders,
  getQualityProfiles,
  getMetadataProfiles,
} from './services/lidarr';
import { mbFindArtist, mbFindReleaseGroup } from './services/mb';
import { yandexPullLikes, setPyproxyUrl, getDriver } from './services/yandex';

function nkey(s: string) {
  return s.trim().toLowerCase();
}

const RECHECK_HOURS = parseInt(process.env.MB_RECHECK_HOURS || '168', 10); // 7 дней
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
    } catch {}
    await new Promise((res) => setTimeout(res, ms));
  }
  return prisma.syncRun.findUnique({ where: { id } });
}

/** ===== Yandex sync ===== */
export async function runYandexSync(
    tokenOverride?: string,
    reuseRunId?: number,
    opts?: { force?: boolean },
) {
  const force = !!opts?.force;
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });

  setPyproxyUrl(setting?.pyproxyUrl || process.env.YA_PYPROXY_URL || '');
  const driver = getDriver(setting?.yandexDriver);

  const token =
      tokenOverride || setting?.yandexToken || process.env.YANDEX_MUSIC_TOKEN || process.env.YM_TOKEN;

  if (!token) {
    await prisma.syncRun.create({
      data: { kind: 'yandex', status: 'error', message: 'No Yandex token (db/env)' },
    });
    return;
  }

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

    await dblog(runId, 'info', 'Fetch likes from Yandex', {
      event: 'start',
      artists: artists.length,
      albums: albums.length,
      driver,
    });

    await patchRunStats(runId, { a_total: artists.length, al_total: albums.length, phase: 'match' });
    await dblog(runId, 'info', `Got ${artists.length} artists, ${albums.length} albums`);

    // Artists
    let a_done = 0, a_matched = 0, a_skipped = 0;
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
          await dblog(runId, 'debug', 'Artist skip (cool-down)', { name, last: a.mbCheckedAt, hours: RECHECK_HOURS });
        } else {
          const r = await mbFindArtist(name);
          await prisma.cacheEntry.upsert({
            where: { key: `artist:${key}` },
            create: { scope: 'artist', key: `artist:${key}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });
          await prisma.artistCandidate.deleteMany({ where: { artistId: a.id } });
          if (Array.isArray(r.candidates) && r.candidates.length) {
            await prisma.artistCandidate.createMany({
              data: r.candidates.map((c: any) => ({
                artistId: a.id, mbid: c.id, name: c.name || '', score: c.score ?? null, type: c.type || null,
                country: c.country || null, url: c.url || null, highlight: !!c.highlight,
              })),
            });
          }
          if (r.mbid) {
            a = await prisma.artist.update({
              where: { id: a.id },
              data: { mbid: r.mbid, matched: true, mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            a_matched++;
            await dblog(runId, 'info', 'Artist matched', { event: 'artist:found', name, mbid: r.mbid });
          } else {
            a = await prisma.artist.update({
              where: { id: a.id },
              data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            await dblog(runId, 'info', 'Artist not matched', { event: 'artist:not_found', name });
          }
        }
      } else {
        a_matched++;
      }

      a_done++;
      if (a_done % 5 === 0) await patchRunStats(runId, { a_done, a_matched, a_skipped });
    }
    await patchRunStats(runId, { a_done, a_matched, a_skipped });

    // Albums
    let al_done = 0, al_matched = 0, al_skipped = 0;
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
            artist: al.artist, title: al.title, last: rec.mbCheckedAt, hours: RECHECK_HOURS,
          });
        } else {
          const r = await mbFindReleaseGroup(al.artist, al.title);
          await prisma.cacheEntry.upsert({
            where: { key: `album:${key}` },
            create: { scope: 'album', key: `album:${key}`, payload: JSON.stringify(r.raw ?? r) },
            update: { payload: JSON.stringify(r.raw ?? r) },
          });
          await prisma.albumCandidate.deleteMany({ where: { albumId: rec.id } });
          if (Array.isArray(r.candidates) && r.candidates.length) {
            await prisma.albumCandidate.createMany({
              data: r.candidates.map((c: any) => ({
                albumId: rec.id, rgMbid: c.id, title: c.title || '', primaryType: c.primaryType || null,
                firstReleaseDate: c.firstReleaseDate || null, primaryArtist: c.primaryArtist || null,
                score: c.score ?? null, url: c.url || null, highlight: !!c.highlight,
              })),
            });
          }
          if (r.mbid) {
            rec = await prisma.album.update({
              where: { id: rec.id },
              data: { rgMbid: r.mbid, matched: true, mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            al_matched++;
            await dblog(runId, 'info', 'Album matched', {
              event: 'album:found', artist: al.artist, title: al.title, mbid: r.mbid,
            });
          } else {
            rec = await prisma.album.update({
              where: { id: rec.id },
              data: { mbCheckedAt: new Date(), mbAttempts: { increment: 1 } },
            });
            await dblog(runId, 'info', 'Album not matched', {
              event: 'album:not_found', artist: al.artist, title: al.title,
            });
          }
        }
      } else {
        al_matched++;
      }

      al_done++;
      if (al_done % 5 === 0) await patchRunStats(runId, { al_done, al_matched, al_skipped });
    }
    await patchRunStats(runId, { al_done, al_matched, al_skipped, phase: 'done' });

    await dblog(runId, 'info', 'Matching finished', {
      event: 'finish',
      artists: { total: artists.length, matched: a_matched, skipped: a_skipped },
      albums: { total: albums.length, matched: al_matched, skipped: al_skipped },
    });

    await endRun(runId, 'ok');

    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('yandex', 'ok', stats);
    } catch {}
  } catch (e: any) {
    await dblog(runId, 'error', 'Yandex sync failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(runId);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('yandex', 'error', stats);
    } catch {}
  }
}

/** ===== Lidarr push ===== */
export async function runLidarrPush() {
  const setting = await prisma.setting.findFirst({ where: { id: 1 } });
  if (!setting?.lidarrUrl || !setting?.lidarrApiKey) {
    await prisma.syncRun.create({
      data: { kind: 'lidarr', status: 'error', message: 'No Lidarr URL or API key' },
    });
    return;
  }

  const run = await startRun('lidarr', {
    phase: 'push', total: 0, done: 0, ok: 0, failed: 0, target: setting.pushTarget || 'artists',
  });
  if (!run) return;

  try {
    const target = setting.pushTarget === 'albums' ? 'albums' : 'artists';

    let effective = {
      rootFolderPath: String(setting.rootFolderPath || '').replace(/\/+$/, ''),
      qualityProfileId: Number.isFinite(Number(setting.qualityProfileId))
          ? Number(setting.qualityProfileId) : undefined as number | undefined,
      metadataProfileId: Number.isFinite(Number(setting.metadataProfileId))
          ? Number(setting.metadataProfileId) : undefined as number | undefined,
    };

    try {
      const [roots, qps, mps] = await Promise.all([
        getRootFolders(setting as any),
        getQualityProfiles(setting as any),
        getMetadataProfiles(setting as any),
      ]);

      let matchedRoot = Array.isArray(roots)
          ? roots.find((r: any) => String(r?.path || '').replace(/\/+$/, '') === effective.rootFolderPath)
          : undefined;

      if (!matchedRoot && Array.isArray(roots) && roots.length === 1) {
        matchedRoot = roots[0];
        effective.rootFolderPath = String(matchedRoot?.path || '').replace(/\/+$/, '');
        await dblog(run.id, 'warn', 'Root path mismatch; using the only available rootfolder', {
          wanted: setting.rootFolderPath, used: effective.rootFolderPath,
        });
      }

      if (!matchedRoot) {
        await dblog(run.id, 'error', 'Invalid Lidarr rootFolderPath', {
          wanted: { rootFolderPath: effective.rootFolderPath || setting.rootFolderPath },
          found: { roots },
        });
        await endRun(run.id, 'error', 'Invalid Lidarr rootFolderPath');
        return;
      }

      const qpIds = new Set<number>(
          (Array.isArray(qps) ? qps : []).map((q: any) => Number(q?.id)).filter(Number.isFinite),
      );

      const mpIdsFromApi = Array.isArray(mps)
          ? mps.map((m: any) => Number(m?.id)).filter(Number.isFinite) : [];
      const mpIdsFromRoots = Array.isArray(roots)
          ? roots.map((r: any) => Number(r?.defaultMetadataProfileId)).filter(Number.isFinite) : [];
      const mpIds = new Set<number>([...mpIdsFromApi, ...mpIdsFromRoots]);

      if (!effective.qualityProfileId && matchedRoot?.defaultQualityProfileId) {
        effective.qualityProfileId = Number(matchedRoot.defaultQualityProfileId);
      }
      if (!effective.metadataProfileId && matchedRoot?.defaultMetadataProfileId) {
        effective.metadataProfileId = Number(matchedRoot.defaultMetadataProfileId);
      }

      const qpOk = !!effective.qualityProfileId && qpIds.has(effective.qualityProfileId);
      const mpOk = !!effective.metadataProfileId && (mpIds.size === 0 ? true : mpIds.has(effective.metadataProfileId));

      if (!qpOk || !mpOk) {
        await dblog(run.id, 'warn', 'Lidarr profiles mismatch, using effective defaults', {
          wanted: { qualityProfileId: setting.qualityProfileId, metadataProfileId: setting.metadataProfileId },
          effective,
          found: { qualityProfiles: qps, metadataProfiles: mps, fallbackMetaIdsFromRoots: Array.from(new Set(mpIdsFromRoots)) },
        });
      }
    } catch (e: any) {
      await dblog(run.id, 'warn', `Lidarr precheck failed (soft): ${String(e?.message || e)}`);
    }
    // --- /пречек ---

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

    let done = 0, ok = 0, failed = 0;

    const effSetting = {
      ...(setting as any),
      rootFolderPath: effective.rootFolderPath,
      qualityProfileId: effective.qualityProfileId,
      metadataProfileId: effective.metadataProfileId,
    };

    for (const it of items) {
      try {
        if (target === 'albums') {
          const cachedAlbum = await prisma.albumPush.findUnique({
            where: { mbid: (it as any).mbid },
          });

          if (cachedAlbum && (cachedAlbum.status === 'CREATED' || cachedAlbum.status === 'EXISTS')) {
            await dblog(
                run.id,
                'info',
                // `Skip push: album already in Lidarr (status=${cachedAlbum.status}) title="${cachedAlbum.title}" mbid=${cachedAlbum.mbid} lidarrId=${cachedAlbum.lidarrAlbumId ?? 'n/a'}`,
                `Skip push: album ${cachedAlbum.title} already in Lidarr.`,
                {
                  target,
                  item: (it as any).id,
                  action: 'skip',
                  lidarrId: cachedAlbum.lidarrAlbumId,
                  path: cachedAlbum.path,
                  title: cachedAlbum.title,
                  mbid: cachedAlbum.mbid,
                  from: 'cache',
                },
            );
            continue;
          }
          const res = await ensureAlbumInLidarr(effSetting as any, {
            artist: (it as any).artist,
            title: (it as any).title,
            rgMbid: (it as any).rgMbid!,
          });

          const title = res?.title || (it as any).title;
          const lidarrId = res?.id;
          const path = res?.path;
          const action = res?.__action || 'created';
          const from = res?.__from;

          await dblog(
              run.id,
              'info',
              // `Pushed album: id=${lidarrId ?? 'n/a'} action=${action} title="${title}" rgMbid=${(it as any).rgMbid} path="${path ?? 'n/a'}" from=${from ?? 'lookup'}`,
              `Pushed album ${title}, action=${action}`,
              {
                target,
                item: it.id,
                action,
                lidarrId,
                path,
                title,
                rgMbid: (it as any).rgMbid,
                from,
                payload: res?.__request,
                response: res?.__response,
              },
          );
          await prisma.albumPush.upsert({
            where: { mbid: (it as any).mbid },
            create: {
              mbid: (it as any).mbid,
              title,
              path: path ?? null,
              lidarrAlbumId: lidarrId ?? null,
              status: action === 'exists' ? 'EXISTS' : 'CREATED',
              source: 'push',
            },
            update: {
              title,
              path: path ?? null,
              lidarrAlbumId: lidarrId ?? null,
              status: action === 'exists' ? 'EXISTS' : 'CREATED',
            },
          });
        } else {
          const cached = await prisma.artistPush.findUnique({
            where: { mbid: (it as any).mbid },
          });

          if (cached && (cached.status === 'CREATED' || cached.status === 'EXISTS')) {
            await dblog(
                run.id,
                'info',
                //`Skip push: artist already in Lidarr (status=${cached.status}) name="${cached.name}" mbid=${cached.mbid} lidarrId=${cached.lidarrArtistId ?? 'n/a'}`,
                `Skip push: "${cached.name}" already in Lidarr`,
                {
                  target,
                  item: it.id,
                  action: 'skip',
                  lidarrId: cached.lidarrArtistId,
                  path: cached.path,
                  name: cached.name,
                  mbid: cached.mbid,
                  from: 'cache',
                },
            );
            continue;
          }

          const res = await ensureArtistInLidarr(effSetting as any, {
            name: (it as any).name,
            mbid: (it as any).mbid!,
          });

          const name = res?.artistName || (it as any).name;
          const lidarrId = res?.id;
          const path = res?.path;
          const action = res?.__action || 'created';
          const from = res?.__from;

          await dblog(
              run.id,
              'info',
              // `Pushed artist: id=${lidarrId ?? 'n/a'} action=${action} name="${name}" mbid=${(it as any).mbid} path="${path ?? 'n/a'}" from=${from ?? 'lookup'}`,
              `Pushed artist ${name}, action=${action}`,
              {
                target,
                item: it.id,
                action,
                lidarrId,
                path,
                name,
                mbid: (it as any).mbid,
                from,
                payload: res?.__request,
                response: res?.__response,
              },
          );

          await prisma.artistPush.upsert({
            where: { mbid: (it as any).mbid },
            create: {
              mbid: (it as any).mbid,
              name,
              path: path ?? null,
              lidarrArtistId: lidarrId ?? null,
              status: action === 'exists' ? 'EXISTS' : 'CREATED',
              source: 'push',
            },
            update: {
              name,
              path: path ?? null,
              lidarrArtistId: lidarrId ?? null,
              status: action === 'exists' ? 'EXISTS' : 'CREATED',
            },
          });
        }
        ok++;
      } catch (e: any) {
        failed++;
        await dblog(run.id, 'warn', `Push failed: ${String(e?.message || e)}`, {
          target,
          item: it.id,
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
    } catch {}
  } catch (e: any) {
    await dblog(run.id, 'error', 'Lidarr push failed', { error: String(e?.message || e) });
    await endRun(run.id, 'error', String(e?.message || e));
    const finalRun = await getRunWithRetry(run.id);
    try {
      const stats = finalRun?.stats ? JSON.parse(finalRun.stats) : {};
      await notify('lidarr', 'error', stats);
    } catch {}
  }
}
