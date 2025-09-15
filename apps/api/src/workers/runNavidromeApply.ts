import { startRun, endRun, patchRunStats, log as dblog } from '../log';
import { createLogger } from '../lib/logger';
import { NavidromeClient, type NdAuth } from '../services/navidrome';
import {
  computeNavidromePlan,
  type Policy,
  type PlanTarget,
} from './runNavidromePlan';

const log = createLogger({ scope: 'worker.nav.apply' });

type ApplyOpts = {
  navUrl: string;
  auth: NdAuth;
  target: PlanTarget;
  policy: Policy;
  withNdState?: boolean; // default true
  dryRun?: boolean;       // если true — только посчитать и залогировать
  reuseRunId?: number;    // если есть — используем готовый run
  authPass?: string;      // необязательный пароль для фолбэка
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function respOk(r: any): boolean {
  try { return r?.['subsonic-response']?.status === 'ok'; } catch { return false; }
}

type StarSets = {
  artists: Set<string>;
  albums: Set<string>;
  songs: Set<string>;
};
async function fetchStarSets(client: NavidromeClient): Promise<StarSets> {
  const cur = await client.getStarred2();
  return {
    artists: new Set((cur?.artists || []).map((x: any) => String(x.id))),
    albums:  new Set((cur?.albums  || []).map((x: any) => String(x.id))),
    songs:   new Set((cur?.songs   || []).map((x: any) => String(x.id))),
  };
}

type Labels = {
  artists: Map<string,string>;
  albums:  Map<string,string>;
  songs:   Map<string,string>;
};

export async function runNavidromeApply(opts: ApplyOpts) {
  let runId: number;
  if (opts.reuseRunId) {
    runId = opts.reuseRunId;
    await dblog(runId, 'info', 'Navidrome apply continue (reuse run)', {
      target: opts.target, policy: opts.policy, dryRun: !!opts.dryRun,
    });
  } else {
    const run = await startRun('navidrome.apply', {
      phase: 'apply',
      target: opts.target,
      policy: opts.policy,
      star_total: 0, star_done: 0,
      unstar_total: 0, unstar_done: 0,
      dryRun: !!opts.dryRun,
    });
    if (!run) return;
    runId = run.id;
    await dblog(runId, 'info', 'Navidrome apply start', {
      target: opts.target, policy: opts.policy, dryRun: !!opts.dryRun,
    });
  }

  try {
    const preClient = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
    await preClient.ensureAuthHealthy();

    const plan = await computeNavidromePlan({
      navUrl: opts.navUrl,
      auth: opts.auth,
      target: opts.target,
      policy: opts.policy,
      withNdState: opts.withNdState ?? true,
      resolveIds: true,
      authPass: opts.authPass,
    });

    const starIds = plan.toStar;
    const unIds   = plan.toUnstar;

    const starTotal =
      (starIds.artistIds?.length || 0) +
      (starIds.albumIds?.length || 0) +
      (starIds.songIds?.length || 0);

    const unTotal =
      (unIds.artistIds?.length || 0) +
      (unIds.albumIds?.length || 0) +
      (unIds.songIds?.length || 0);

    await patchRunStats(runId, { star_total: starTotal, unstar_total: unTotal });

    const client = new NavidromeClient(opts.navUrl, opts.auth, opts.authPass);
    await client.ensureAuthHealthy();

    await dblog(runId, 'info', 'Apply plan prepared', {
      star: {
        artists: starIds.artistIds?.length || 0,
        albums:  starIds.albumIds?.length  || 0,
        songs:   starIds.songIds?.length   || 0,
      },
      unstar: {
        artists: unIds.artistIds?.length || 0,
        albums:  unIds.albumIds?.length  || 0,
        songs:   unIds.songIds?.length   || 0,
      },
      unresolved: plan.counts.unresolved,
      dryRun: !!opts.dryRun,
    });

    // -------- labels cache --------
    const labels: Labels = {
      artists: new Map(),
      albums:  new Map(),
      songs:   new Map(),
    };

    // заполнить лейблы из "before starred" (полезно для UNSTAR)
    const before = await (async () => {
      const cur = await client.getStarred2();
      for (const a of cur.artists || []) labels.artists.set(String(a.id), a.name || String(a.id));
      for (const al of cur.albums || []) labels.albums.set(String(al.id), `${al.artist || ''} — ${al.name || ''}`.trim() || String(al.id));
      for (const s of cur.songs || []) labels.songs.set(String(s.id), `${s.artist || ''} — ${s.title || ''}`.trim() || String(s.id));
      return {
        artists: new Set((cur?.artists || []).map((x: any) => String(x.id))),
        albums:  new Set((cur?.albums  || []).map((x: any) => String(x.id))),
        songs:   new Set((cur?.songs   || []).map((x: any) => String(x.id))),
      } as StarSets;
    })();

    // подгрузить подписи для STAR ids, которых нет в кэше
    const ensureLabels = async (kind: 'artists'|'albums'|'songs', ids: string[]) => {
      const miss = ids.filter(id => !labels[kind].has(id));
      if (!miss.length) return;

      const limit = 8; // параллелизм
      const work = miss.slice();
      const workers: Promise<void>[] = [];
      const runOne = async (id: string) => {
        try {
          if (kind === 'songs') {
            const s = await client.getSong(id);
            const title = s?.title || '';
            const artist = s?.artist || s?.artists?.[0]?.name || '';
            labels.songs.set(id, `${artist} — ${title}`.trim() || id);
          } else if (kind === 'albums') {
            const al = await client.getAlbum(id);
            const name = al?.name || al?.title || '';
            const artist = al?.artist || al?.artistName || '';
            labels.albums.set(id, `${artist} — ${name}`.trim() || id);
          } else {
            const a = await client.getArtist(id);
            const name = a?.name || '';
            labels.artists.set(id, name || id);
          }
        } catch {
          // fallback
          labels[kind].set(id, id);
        }
      };

      for (let i = 0; i < limit; i++) {
        workers.push((async () => {
          while (work.length) {
            const id = work.shift()!;
            await runOne(id);
          }
        })());
      }
      await Promise.all(workers);
    };

    await ensureLabels('songs',  starIds.songIds || []);
    await ensureLabels('albums', starIds.albumIds || []);
    await ensureLabels('artists',starIds.artistIds || []);

    // Точные счётчики «по факту»
    const added = { artists: 0, albums: 0, songs: 0 };
    const removed = { artists: 0, albums: 0, songs: 0 };

    if (!opts.dryRun) {
      let starDone = 0;
      let unDone = 0;

      // --- хелпер для верификации батча и поштучного логирования
      const verifyBatch = async (
        kind: 'artists'|'albums'|'songs',
        action: 'STAR'|'UNSTAR',
        ids: string[],
      ) => {
        const after = await fetchStarSets(client);
        const sel = after[kind];
        const was = before[kind];

        for (const id of ids) {
          const had = was.has(id);
          const has = sel.has(id);
          const label = labels[kind].get(id) || id;

          if (action === 'STAR') {
            if (has) {
              await dblog(runId, 'info', `STAR OK (${kind.slice(0,-1)}) ${label}`, { id });
              if (!had && has) added[kind]++;
              was.add(id);
            } else {
              await dblog(runId, 'warn', `STAR FAIL (${kind.slice(0,-1)}) ${label}`, { id });
            }
          } else {
            if (!has) {
              await dblog(runId, 'info', `UNSTAR OK (${kind.slice(0,-1)}) ${label}`, { id });
              if (had && !has) removed[kind]++;
              was.delete(id);
            } else {
              await dblog(runId, 'warn', `UNSTAR FAIL (${kind.slice(0,-1)}) ${label}`, { id });
            }
          }
        }
        return after;
      };

      // STAR — artists
      if (starIds.artistIds?.length) {
        await dblog(runId, 'info', 'Starring artists…', { count: starIds.artistIds.length });
        for (const ids of chunk(starIds.artistIds, 200)) {
          if (!ids.length) continue;
          const resp = await client.star({ artistIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Star artists batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('artists', 'STAR', ids);
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — albums
      if (starIds.albumIds?.length) {
        await dblog(runId, 'info', 'Starring albums…', { count: starIds.albumIds.length });
        for (const ids of chunk(starIds.albumIds, 200)) {
          if (!ids.length) continue;
          const resp = await client.star({ albumIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Star albums batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('albums', 'STAR', ids);
          starDone += ids.length;
          if (starDone % 200 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // STAR — songs
      if (starIds.songIds?.length) {
        await dblog(runId, 'info', 'Starring songs…', { count: starIds.songIds.length });
        for (const ids of chunk(starIds.songIds, 500)) {
          if (!ids.length) continue;
          const resp = await client.star({ songIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Star songs batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('songs', 'STAR', ids);
          starDone += ids.length;
          if (starDone % 500 === 0) await patchRunStats(runId, { star_done: starDone });
        }
        await patchRunStats(runId, { star_done: starDone });
      }

      // UNSTAR — artists
      if (unIds.artistIds?.length) {
        await dblog(runId, 'info', 'Unstarring artists…', { count: unIds.artistIds.length });
        for (const ids of chunk(unIds.artistIds, 200)) {
          if (!ids.length) continue;
          const resp = await client.unstar({ artistIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Unstar artists batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('artists', 'UNSTAR', ids);
          unDone += ids.length;
          if (unDone % 200 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }

      // UNSTAR — albums
      if (unIds.albumIds?.length) {
        await dblog(runId, 'info', 'Unstarring albums…', { count: unIds.albumIds.length });
        for (const ids of chunk(unIds.albumIds, 200)) {
          if (!ids.length) continue;
          const resp = await client.unstar({ albumIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Unstar albums batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('albums', 'UNSTAR', ids);
          unDone += ids.length;
          if (unDone % 200 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }

      // UNSTAR — songs
      if (unIds.songIds?.length) {
        await dblog(runId, 'info', 'Unstarring songs…', { count: unIds.songIds.length });
        for (const ids of chunk(unIds.songIds, 500)) {
          if (!ids.length) continue;
          const resp = await client.unstar({ songIds: ids });
          const ok = respOk(resp);
          await dblog(runId, ok ? 'debug' : 'warn', 'Unstar songs batch', { size: ids.length, status: ok ? 'ok' : 'failed' });
          await verifyBatch('songs', 'UNSTAR', ids);
          unDone += ids.length;
          if (unDone % 500 === 0) await patchRunStats(runId, { unstar_done: unDone });
        }
        await patchRunStats(runId, { unstar_done: unDone });
      }
    }

    // Финальный снимок и сводка
    const finalSets = await fetchStarSets(client);

    const starSummary = {
      artists: (plan.toStar.artistIds?.length || 0),
      albums:  (plan.toStar.albumIds?.length || 0),
      songs:   (plan.toStar.songIds?.length || 0),
    };
    const unstarSummary = {
      artists: (plan.toUnstar.artistIds?.length || 0),
      albums:  (plan.toUnstar.albumIds?.length || 0),
      songs:   (plan.toUnstar.songIds?.length || 0),
    };

    await dblog(runId, 'info', `Apply summary — STAR: artists ${starSummary.artists}, albums ${starSummary.albums}, songs ${starSummary.songs} (total ${starSummary.artists + starSummary.albums + starSummary.songs})`);
    await dblog(runId, 'info', `Apply summary — UNSTAR: artists ${unstarSummary.artists}, albums ${unstarSummary.albums}, songs ${unstarSummary.songs} (total ${unstarSummary.artists + unstarSummary.albums + unstarSummary.songs})`);

    await dblog(runId, 'info', 'Apply per-item result (counts)', { added, removed });

    await dblog(runId, 'info', 'Navidrome starred after-apply', {
      ndArtists: finalSets.artists.size,
      ndAlbums:  finalSets.albums.size,
      ndSongs:   finalSets.songs.size,
      delta: {
        artists: finalSets.artists.size - before.artists.size,
        albums:  finalSets.albums.size  - before.albums.size,
        songs:   finalSets.songs.size   - before.songs.size,
      },
    });

    await dblog(runId, 'info', 'Navidrome apply done', {
      target: opts.target,
      star_total: starTotal, unstar_total: unTotal,
      unresolved: plan.counts.unresolved,
      dryRun: !!opts.dryRun,
    });
    await patchRunStats(runId, { phase: 'done' });
    await endRun(runId, 'ok');
  } catch (e: any) {
    await dblog(runId, 'error', 'Navidrome apply failed', { error: String(e?.message || e) });
    await endRun(runId, 'error', String(e?.message || e));
  }
}
