import { startRun, endRun, patchRunStats, log as dblog } from '../log';
import { prisma, TorrentStatus } from '../prisma';
import { NavidromeClient, type NdAuth } from '../services/navidrome';

type BackfillOpts = {
  reuseRunId?: number;
  dryRun?: boolean;
  limit?: number;
};

function stripTrailingSlashes(s?: string | null): string {
  return String(s || '').replace(/\/+$/, '');
}

function nkey(s: string): string {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normMbid(v: unknown): string {
  return String(v || '').replace(/^mbid:/i, '').trim().toLowerCase();
}

function chunked<T>(xs: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function pickAlbumId(song: any): string {
  return String(song?.albumId || song?.albumID || song?.albumid || '').trim();
}

function pickArtistId(songOrAlbum: any): string {
  return String(songOrAlbum?.artistId || songOrAlbum?.artistID || songOrAlbum?.artistid || '').trim();
}

function buildAuth(setting: any): { auth: NdAuth; authPass?: string } {
  const user = String(setting?.navidromeUser || '').trim();
  const pass = String(setting?.navidromePass || '').trim();
  const token = String(setting?.navidromeToken || '').trim();
  const salt = String(setting?.navidromeSalt || '').trim();

  if (!user) throw new Error('Navidrome user is empty');

  if (token && salt) {
    return { auth: { user, token, salt } as NdAuth, authPass: undefined };
  }

  if (pass) {
    return { auth: { user, pass } as NdAuth, authPass: pass };
  }

  throw new Error('Navidrome auth is empty: need pass OR token+salt');
}

export async function runNavidromeBackfill(opts: BackfillOpts = {}) {
  const dryRun = !!opts.dryRun;
  const limit = Math.max(1, Math.min(10000, Number(opts.limit || 1000)));

  let runId = opts.reuseRunId;

  if (!runId) {
    const run = await startRun('navidrome.backfill.links', {
      phase: 'start',
      total: 0,
      done: 0,
      dryRun,
      limit,
      checkedUniqueAlbums: 0,
      albumCandidates: 0,
      artistCandidates: 0,
      albumUpdated: 0,
      artistUpdated: 0,
      fallbackDownloadedAlbums: 0,
      fallbackResolvedAlbums: 0,
      errors: 0,
    });
    if (!run?.id) return { ok: false, error: 'failed to start run' };
    runId = run.id;
  }

  await dblog(runId, 'info', 'Navidrome entity links backfill start…', { dryRun, limit });

  try {
    const setting = await prisma.setting.findFirst({ where: { id: 1 } }) as any;
    const navUrl = stripTrailingSlashes(setting?.navidromeUrl);

    if (!navUrl) throw new Error('Navidrome URL is empty in settings');

    const { auth, authPass } = buildAuth(setting);
    const client = new NavidromeClient(navUrl, auth, authPass);

    await client.ensureAuthHealthy();

    let done = 0;
    let checkedUniqueAlbums = 0;
    let albumCandidates = 0;
    let artistCandidates = 0;
    let albumUpdated = 0;
    let artistUpdated = 0;
    let noAlbumId = 0;
    let noArtistId = 0;
    let fallbackDownloadedAlbums = 0;
    let fallbackResolvedAlbums = 0;
    let errors = 0;

    const seenAlbums = new Set<string>();
    const seenArtists = new Set<string>();

    async function saveAlbumNdId(ymAlbumId: string, ndAlbumId: string) {
      if (!ymAlbumId || !ndAlbumId) return 0;
      if (dryRun) return 0;

      const res = await prisma.yandexAlbum.updateMany({
        where: {
          ymId: ymAlbumId,
          present: true,
          OR: [{ ndId: null }, { ndId: '' }],
        },
        data: { ndId: ndAlbumId },
      });

      return res.count;
    }

    async function saveArtistNdId(ymArtistId: string | null | undefined, ndArtistId: string) {
      if (!ymArtistId || !ndArtistId) return 0;
      if (seenArtists.has(ymArtistId)) return 0;

      seenArtists.add(ymArtistId);
      artistCandidates++;

      if (dryRun) return 0;

      const res = await prisma.yandexArtist.updateMany({
        where: {
          ymId: ymArtistId,
          present: true,
          OR: [{ ndId: null }, { ndId: '' }],
        },
        data: { ndId: ndArtistId },
      });

      return res.count;
    }

    /*
     * Phase 1.
     * Existing high-confidence path:
     * YandexLikeSync track ndId -> Navidrome getSong -> albumId/artistId.
     */
    const synced = await prisma.yandexLikeSync.findMany({
      where: {
        kind: 'track',
        ndId: { not: null },
        OR: [{ status: 'synced' }, { starConfirmedAt: { not: null } }],
      },
      select: {
        ymId: true,
        ndId: true,
        trackRef: {
          select: {
            ymId: true,
            title: true,
            artist: true,
            album: true,
            ymAlbumId: true,
            ymArtistId: true,
            albumRef: {
              select: {
                ymId: true,
                title: true,
                artist: true,
                ndId: true,
              },
            },
          },
        },
      },
      take: limit,
      orderBy: { lastSeenAt: 'desc' },
    });

    await patchRunStats(runId, {
      phase: 'running',
      total: synced.length,
      done: 0,
      loadedSyncedTracks: synced.length,
    });

    for (const row of synced) {
      done++;

      const ndSongId = String(row.ndId || '').trim();
      const tr = row.trackRef;

      if (!ndSongId || !tr) {
        if (done % 25 === 0) await patchRunStats(runId, { done });
        continue;
      }

      const ymAlbumId = String(tr.ymAlbumId || '').trim();
      const ymArtistId = String(tr.ymArtistId || '').trim();

      const albumDedupeKey = ymAlbumId || `track:${tr.ymId}`;
      if (seenAlbums.has(albumDedupeKey)) {
        if (done % 25 === 0) await patchRunStats(runId, { done });
        continue;
      }

      seenAlbums.add(albumDedupeKey);
      checkedUniqueAlbums++;

      try {
        const song = await client.getSong(ndSongId);
        const ndAlbumId = pickAlbumId(song);
        const ndArtistId = pickArtistId(song);

        if (ymAlbumId && ndAlbumId) {
          albumCandidates++;
          albumUpdated += await saveAlbumNdId(ymAlbumId, ndAlbumId);

          if (albumCandidates <= 20) {
            await dblog(runId, 'debug', 'Album ndId candidate from synced track', {
              ymAlbumId,
              artist: tr.artist,
              album: tr.album,
              track: tr.title,
              ndSongId,
              ndAlbumId,
              dryRun,
            });
          }
        } else if (ymAlbumId) {
          noAlbumId++;
        }

        if (ymArtistId && ndArtistId) {
          artistUpdated += await saveArtistNdId(ymArtistId, ndArtistId);
        } else if (ymArtistId) {
          noArtistId++;
        }
      } catch (e: any) {
        errors++;
        await dblog(runId, 'warn', 'Navidrome getSong failed during backfill', {
          ymTrackId: tr.ymId,
          ndSongId,
          error: e?.message || String(e),
        });
      }

      if (done % 25 === 0) {
        await patchRunStats(runId, {
          done,
          checkedUniqueAlbums,
          albumCandidates,
          artistCandidates,
          albumUpdated,
          artistUpdated,
          noAlbumId,
          noArtistId,
          errors,
        });
      }
    }

    /*
     * Phase 2.
     * New fallback:
     * downloaded Yandex albums with empty ndId -> Navidrome search by artist/title.
     *
     * This covers cases like:
     * Yandex track downloaded by Lidarr/YM2LIDARR,
     * album exists in Navidrome,
     * but no YandexLikeSync track link exists.
     */
    await dblog(runId, 'info', 'Resolving downloaded albums missing Navidrome links…', { limit });

    const missingAlbums = await prisma.yandexAlbum.findMany({
      where: {
        present: true,
        OR: [{ ndId: null }, { ndId: '' }],
      },
      select: {
        ymId: true,
        title: true,
        artist: true,
        key: true,
        rgMbid: true,
        yandexArtistId: true,
      } as any,
    });

    const serviceAlbumTasks = await prisma.torrentTask.findMany({
      where: {
        status: {
          in: [
            TorrentStatus.downloaded,
            TorrentStatus.moving,
            TorrentStatus.moved,
          ],
        },
        scope: 'album' as any,
        ymAlbumId: { not: null },
      },
      select: { ymAlbumId: true },
    });

    const serviceDownloadedAlbumIds = new Set<string>();
    for (const t of serviceAlbumTasks) {
      const ymAlbumId = String(t.ymAlbumId || '').trim();
      if (ymAlbumId) serviceDownloadedAlbumIds.add(ymAlbumId);
    }

    const candidateRgMbids = Array.from(new Set(
      missingAlbums.map((a: any) => normMbid(a.rgMbid)).filter(Boolean),
    ));

    const lidarrDownloadedMbids = new Set<string>();
    for (const mbidsChunk of chunked(candidateRgMbids, 500)) {
      const lidarrAlbums = await prisma.lidarrAlbum.findMany({
        where: {
          removed: false,
          mbid: { in: mbidsChunk },
          sizeOnDisk: { gt: 0 },
        },
        select: { mbid: true },
      });

      for (const a of lidarrAlbums) {
        const mbid = normMbid(a.mbid);
        if (mbid) lidarrDownloadedMbids.add(mbid);
      }
    }

    const downloadedMissingAlbums = missingAlbums
      .filter((a: any) => {
        const ymAlbumId = String(a.ymId || '').trim();
        if (!ymAlbumId || seenAlbums.has(ymAlbumId)) return false;

        const byService = serviceDownloadedAlbumIds.has(ymAlbumId);
        const byLidarr = lidarrDownloadedMbids.has(normMbid(a.rgMbid));

        return byService || byLidarr;
      })
      .slice(0, limit);

    fallbackDownloadedAlbums = downloadedMissingAlbums.length;

    const albumsByKey = new Map<string, any[]>();
    for (const a of downloadedMissingAlbums as any[]) {
      const key = String(a.key || nkey(`${a.artist || ''}|||${a.title || ''}`)).trim();
      if (!key) continue;
      const xs = albumsByKey.get(key) || [];
      xs.push(a);
      albumsByKey.set(key, xs);
    }

    const albumKeys = Array.from(albumsByKey.keys());
    const resolvedAlbumIds = albumKeys.length
      ? await client.resolveAlbumIdsByKeys(albumKeys)
      : new Map<string, string>();

    const albumMetaByNdId = new Map<string, any>();

    for (const [key, ndAlbumId] of resolvedAlbumIds.entries()) {
      if (!ndAlbumId) continue;

      const albums = albumsByKey.get(key) || [];
      if (!albums.length) continue;

      fallbackResolvedAlbums++;

      let albumMeta: any = undefined;
      try {
        albumMeta = albumMetaByNdId.get(ndAlbumId);
        if (!albumMeta) {
          albumMeta = await client.getAlbum(ndAlbumId);
          albumMetaByNdId.set(ndAlbumId, albumMeta);
        }
      } catch (e: any) {
        errors++;
        await dblog(runId, 'warn', 'Navidrome getAlbum failed during album fallback', {
          ndAlbumId,
          error: e?.message || String(e),
        });
      }

      const ndArtistId = pickArtistId(albumMeta);

      for (const a of albums) {
        const ymAlbumId = String(a.ymId || '').trim();
        const ymArtistId = String(a.yandexArtistId || '').trim();

        if (!ymAlbumId) continue;

        albumCandidates++;
        albumUpdated += await saveAlbumNdId(ymAlbumId, ndAlbumId);

        if (ndArtistId && ymArtistId) {
          artistUpdated += await saveArtistNdId(ymArtistId, ndArtistId);
        }

        if (fallbackResolvedAlbums <= 30) {
          await dblog(runId, 'debug', 'Album ndId candidate from downloaded album fallback', {
            ymAlbumId,
            artist: a.artist,
            album: a.title,
            rgMbid: a.rgMbid,
            ndAlbumId,
            ndArtistId: ndArtistId || null,
            dryRun,
          });
        }
      }
    }

    const result = {
      ok: true,
      runId,
      dryRun,
      limit,
      loadedSyncedTracks: synced.length,
      checkedUniqueAlbums,
      albumCandidates,
      artistCandidates,
      albumUpdated,
      artistUpdated,
      noAlbumId,
      noArtistId,
      fallbackDownloadedAlbums,
      fallbackResolvedAlbums,
      errors,
    };

    await patchRunStats(runId, {
      phase: 'done',
      total: synced.length + fallbackDownloadedAlbums,
      done: synced.length + fallbackDownloadedAlbums,
      ...result,
    });

    await dblog(runId, 'info', 'Navidrome entity links backfill done', result);
    await endRun(runId, 'ok');

    return result;
  } catch (e: any) {
    const msg = e?.message || String(e);
    await dblog(runId, 'error', 'Navidrome entity links backfill failed', { error: msg });
    await endRun(runId, 'error', msg);
    throw e;
  }
}
