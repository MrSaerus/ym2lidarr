// apps/api/src/services/lidarr.ts
import Bottleneck from 'bottleneck';
import { request } from 'undici';
import { createLogger } from '../lib/logger';

const DEFAULT_HEADERS_TIMEOUT = 10_000; // 10s
const DEFAULT_BODY_TIMEOUT = 30_000;    // 30s

const log = createLogger({ scope: 'service.lidarr' });

const skyhookLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1200,
});

export type Setting = {
  lidarrUrl: string;
  lidarrApiKey: string;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null;

  lidarrAllowNoMetadata?: boolean | null;
};

type EnsureResult = any & {
  __action?: 'created' | 'exists' | 'skipped';
  __from?: 'lookup' | 'fallback';
  __request?: any;
  __response?: any;
  __reason?: string;
};

function baseUrl(s: Setting) {
  return String(s.lidarrUrl || '').replace(/\/+$/, '');
}
function normalizeRoot(p?: string | null) {
  return String(p || '').replace(/\/+$/, '');
}

function withDefaults(s: Setting): Setting {
  return {
    ...s,
    rootFolderPath: s.rootFolderPath ?? '/music',
    qualityProfileId: s.qualityProfileId ?? 1,
    metadataProfileId: s.metadataProfileId ?? 1,
    monitor: s.monitor ?? 'all',
    lidarrAllowNoMetadata: !!s.lidarrAllowNoMetadata,
  };
}

function assertPushSettings(s: Setting) {
  const missing: string[] = [];
  if (!s.rootFolderPath)     missing.push('rootFolderPath');
  if (!s.qualityProfileId)   missing.push('qualityProfileId');
  if (!s.metadataProfileId)  missing.push('metadataProfileId');
  if (missing.length) {
    const err: any = new Error(`Lidarr settings missing: ${missing.join(', ')}`);
    err.code = 'LIDARR_CONFIG';
    err.missing = missing;
    throw err;
  }
}

async function api<T = any>(s: Setting, path: string, init?: Parameters<typeof request>[1]) {
  const url = `${baseUrl(s)}${path}${path.includes('?') ? '&' : '?'}apikey=${s.lidarrApiKey}`;
  const method = (init?.method || 'GET') as string;
  log.debug('lidarr request', 'lidarr.http.req', { method, path });
  const res = await request(url, {
    headersTimeout: DEFAULT_HEADERS_TIMEOUT,
    bodyTimeout: DEFAULT_BODY_TIMEOUT,
    ...init
  });
  const text = await res.body.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  log.debug('lidarr response', 'lidarr.http.resp', { method, path, status: res.statusCode });
  return { status: res.statusCode, data: data as T };
}

export async function testLidarr(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api(s, '/api/v1/system/status');
  log.info('test lidarr', 'lidarr.test', { status: r.status });
  return { ok: r.status < 400, status: r.status, data: r.data };
}

/* ======== lists ======== */
export async function getQualityProfiles(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/qualityprofile');
  log.debug('quality profiles fetched', 'lidarr.qualityProfiles', { count: Array.isArray(r.data) ? r.data.length : 0 });
  return Array.isArray(r.data) ? r.data : [];
}
export async function getMetadataProfiles(s0: Setting) {
  const s = withDefaults(s0);
  for (const p of ['/api/v1/metadataprofile', '/api/v1/metadata/profile', '/api/v1/metadataProfile']) {
    try {
      const r = await api<any[]>(s, p);
      if (Array.isArray(r.data)) {
        log.debug('metadata profiles fetched', 'lidarr.metadataProfiles', { path: p, count: r.data.length });
        return r.data;
      }
    } catch (e: any) {
      log.warn('metadata profiles path failed', 'lidarr.metadataProfiles.fail', { path: p, err: e?.message });
    }
  }
  return [];
}
export async function getRootFolders(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/rootfolder');
  log.debug('root folders fetched', 'lidarr.rootFolders', { count: Array.isArray(r.data) ? r.data.length : 0 });
  return Array.isArray(r.data) ? r.data : [];
}
export async function getTags(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/tag');
  log.debug('tags fetched', 'lidarr.tags', { count: Array.isArray(r.data) ? r.data.length : 0 });
  return Array.isArray(r.data) ? r.data : [];
}

/* ======== helpers ======== */
async function findExistingArtistByMBID(s: Setting, mbid: string) {
  const lookup = await api<any[]>(s, `/api/v1/artist?term=mbid:${mbid}`);
  if (Array.isArray(lookup.data) && lookup.data.some((a) => a.foreignArtistId?.includes(mbid))) {
    log.debug('artist exists via term lookup', 'lidarr.artist.exists.term', { mbid });
    return lookup.data.find((a) => a.foreignArtistId?.includes(mbid));
  }
  const all = await api<any[]>(s, `/api/v1/artist`);
  if (Array.isArray(all.data)) {
    const hit = all.data.find((a) => a.foreignArtistId?.includes(mbid));
    if (hit) log.debug('artist exists via full list', 'lidarr.artist.exists.full', { mbid });
    return hit;
  }
  return null;
}

async function lookupWithRetry(s: Setting, path: string, attempts = 2, delayMs = 800) {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      log.debug('lookup attempt', 'lidarr.lookup.try', { path, attempt: i + 1, attempts });

      const r = path.includes('/lookup')
        ? await skyhookLimiter.schedule(() => api<any[]>(s, path))
        : await api<any[]>(s, path);

      if (Array.isArray(r.data) && r.data.length) return r;
      lastErr = new Error('Lookup returned empty array');
      log.warn('lookup empty', 'lidarr.lookup.empty', { path, attempt: i + 1 });
    } catch (e) {
      lastErr = e;
      log.warn('lookup failed (retry)', 'lidarr.lookup.fail', { path, attempt: i + 1, err: (e as any)?.message });
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Lookup failed for ${path} (${attempts} attempts): ${String(lastErr?.message || lastErr)}`);
}

async function postWithRetry(s: Setting, path: string, body: any, attempts = 3, delayMs = 1000) {
  let last: { status: number; data: any } | null = null;

  const isRetryableStatus = (st: number) =>
    st === 429 || st === 500 || st === 502 || st === 503 || st === 504;

  for (let i = 0; i < attempts; i++) {
    try {
      log.debug('post attempt', 'lidarr.post.try', { path, attempt: i + 1, attempts });

      const r = await api(s, path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      last = r;

      if (!isRetryableStatus(r.status)) {
        log.debug('post attempt done', 'lidarr.post.done', { path, status: r.status });
        return r;
      }

      log.warn('post transient error (retry)', 'lidarr.post.retry', { path, status: r.status, attempt: i + 1 });
    } catch (e: any) {
      const msg = String(e?.message || e);
      last = { status: 599, data: { error: msg } };

      log.warn('post network error (retry)', 'lidarr.post.retry.net', {
        path, attempt: i + 1, err: msg,
      });
    }

    if (i < attempts - 1) await new Promise(res => setTimeout(res, delayMs));
  }

  log.error('post failed after retries', 'lidarr.post.fail', { path, status: last?.status });
  return last!;
}

/* ======== public: ensure* ======== */
export async function ensureArtistInLidarr(s0: Setting, a: { name: string; mbid: string }): Promise<EnsureResult> {
  const s = withDefaults(s0);
  assertPushSettings(s);

  const allowNoMeta = !!s.lidarrAllowNoMetadata;

  log.info('ensure artist', 'lidarr.ensure.artist.start', { mbid: a.mbid, name: a.name, allowNoMeta });

  const existing = await findExistingArtistByMBID(s, a.mbid);
  if (existing) {
    log.info('artist already exists', 'lidarr.ensure.artist.exists', { mbid: a.mbid, id: existing.id });
    return { ...existing, __action: 'exists', __from: 'lookup' };
  }

  let src: any | null = null;
  let from: 'lookup' | 'fallback' = 'lookup';
  try {
    const lu = await lookupWithRetry(s, `/api/v1/artist/lookup?term=mbid:${a.mbid}`);
    src = Array.isArray(lu.data) && lu.data.length ? lu.data[0] : null;
    if (!src && !allowNoMeta) {
      log.warn('artist metadata unavailable (skip)', 'lidarr.ensure.artist.skip.meta', { mbid: a.mbid });
      return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    }
    if (!src) { from = 'fallback'; log.debug('artist fallback body will be used', 'lidarr.ensure.artist.fallback', { mbid: a.mbid }); }
  } catch {
    if (!allowNoMeta) {
      log.warn('artist lookup failed (skip w/o metadata)', 'lidarr.ensure.artist.skip.lookup', { mbid: a.mbid });
      return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    }
    src = null; from = 'fallback';
    log.warn('artist lookup failed (fallback)', 'lidarr.ensure.artist.lookup.fail', { mbid: a.mbid });
  }

  const baseBody = {
    foreignArtistId: a.mbid,
    qualityProfileId: s.qualityProfileId,
    metadataProfileId: s.metadataProfileId,
    rootFolderPath: normalizeRoot(s.rootFolderPath),
    monitored: true,
    monitor: s.monitor || 'all',
    addOptions: { searchForMissingAlbums: false },
    tags: [] as any[],
  };

  const body = src
    ? { ...src, ...baseBody }
    : {
      artistName: a.name,
      path: `${normalizeRoot(s.rootFolderPath)}/${a.name}`.replace(/\/{2,}/g, '/'),
      ...baseBody,
    };

  log.debug('adding artist to lidarr', 'lidarr.ensure.artist.post', { mbid: a.mbid, from });

  const r = await postWithRetry(s, `/api/v1/artist`, body, 3, 1000);

  if (r.status >= 400 && String(r.data).includes('already exists')) {
    const again = await findExistingArtistByMBID(s, a.mbid);
    const res = again ?? r.data;
    log.info('artist reported exists after post', 'lidarr.ensure.artist.exists.after', { mbid: a.mbid, id: (res as any)?.id });
    return { ...(res as any), __action: 'exists', __from: from, __request: body, __response: r.data };
  }
  if (r.status >= 400) {
    log.error('artist add failed', 'lidarr.ensure.artist.fail', { mbid: a.mbid, status: r.status });
    throw new Error(`Lidarr add artist failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  log.info('artist created', 'lidarr.ensure.artist.created', { mbid: a.mbid, id: (r.data as any)?.id });
  return { ...(r.data as any), __action: 'created', __from: from, __request: body, __response: r.data };
}

export async function ensureAlbumInLidarr(s0: Setting, al: { artist: string; title: string; rgMbid: string }): Promise<EnsureResult> {
  const s = withDefaults(s0);
  assertPushSettings(s);

  log.info('ensure album', 'lidarr.ensure.album.start', { rgMbid: al.rgMbid, artist: al.artist, title: al.title });

  try {
    const lib0 = await api<any[]>(s, '/api/v1/album');
    const exists0 = Array.isArray(lib0.data) && lib0.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
    if (exists0) {
      log.info('album already exists (pre)', 'lidarr.ensure.album.exists.pre', { rgMbid: al.rgMbid, id: (exists0 as any)?.id });
      return { ...exists0, __action: 'exists', __from: 'lookup' };
    }
  } catch (e: any) {
    log.warn('album list read failed (pre-check continue)', 'lidarr.ensure.album.pre.fail', { err: e?.message, rgMbid: al.rgMbid });
  }

  let src: any | null = null;
  try {
    const lu = await lookupWithRetry(s, `/api/v1/album/lookup?term=mbid:${al.rgMbid}`);
    if (!Array.isArray(lu.data) || !lu.data.length) {
      log.warn('album metadata unavailable (skip)', 'lidarr.ensure.album.skip.meta', { rgMbid: al.rgMbid });
      return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    }
    src = lu.data[0];
  } catch {
    log.warn('album lookup failed (skip)', 'lidarr.ensure.album.lookup.fail', { rgMbid: al.rgMbid });
    return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
  }

  const artistMbid: string | undefined = src.foreignArtistId || src.artist?.foreignArtistId;
  if (artistMbid) {
    log.debug('ensure album: ensuring artist first', 'lidarr.ensure.album.ensureArtist', { artistMbid });
    await ensureArtistInLidarr(s, {
      name: src.artist?.artistName || al.artist,
      mbid: artistMbid.replace(/^mbid:/, ''),
    });
  }

  const lib = await api<any[]>(s, '/api/v1/album');
  const exists = Array.isArray(lib.data) && lib.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
  if (exists) {
    log.info('album already exists (post pre-ensure)', 'lidarr.ensure.album.exists.postPre', { rgMbid: al.rgMbid, id: (exists as any)?.id });
    return { ...exists, __action: 'exists', __from: 'lookup' };
  }

  const body = {
    ...src,
    foreignAlbumId: al.rgMbid,
    qualityProfileId: s.qualityProfileId,
    metadataProfileId: s.metadataProfileId,
    rootFolderPath: normalizeRoot(s.rootFolderPath),
    monitored: true,
    addOptions: { searchForNewAlbum: false },
    tags: [],
  };

  log.debug('adding album to lidarr', 'lidarr.ensure.album.post', { rgMbid: al.rgMbid });

  const r = await postWithRetry(s, `/api/v1/album`, body, 3, 1000);

  if (r.status >= 400 && String(r.data).includes('already exists')) {
    const refreshed = await api<any[]>(s, '/api/v1/album');
    const found = Array.isArray(refreshed.data)
      ? refreshed.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid))
      : r.data;
    log.info('album exists after post', 'lidarr.ensure.album.exists.after', { rgMbid: al.rgMbid, id: (found as any)?.id });
    return { ...(found as any), __action: 'exists', __from: 'lookup', __request: body, __response: r.data };
  }
  if (r.status >= 400) {
    log.error('album add failed', 'lidarr.ensure.album.fail', { rgMbid: al.rgMbid, status: r.status });
    throw new Error(`Lidarr add album failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  log.info('album created', 'lidarr.ensure.album.created', { rgMbid: al.rgMbid, id: (r.data as any)?.id });
  return { ...(r.data as any), __action: 'created', __from: 'lookup', __request: body, __response: r.data };
}

// ==================== confirm & retry helpers (artists + albums) ====================

async function __lidarrApi<T = any>(base: string, key: string, path: string): Promise<T> {
  const b = base.replace(/\/+$/, '');
  const url = `${b}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`;

  log.debug('confirm api call', 'lidarr.confirm.http.req', { path });

  const res = await request(url, {
    headersTimeout: DEFAULT_HEADERS_TIMEOUT,
    bodyTimeout: DEFAULT_BODY_TIMEOUT,
  });

  const text = await res.body.text();

  if (res.statusCode >= 400) {
    log.warn('confirm api error', 'lidarr.confirm.http.fail', { path, status: res.statusCode });
    throw new Error(`Lidarr ${path} ${res.statusCode}: ${text?.slice(0, 180)}`);
  }

  try { return JSON.parse(text) as T; } catch { return text as any; }
}

function __jitter(extra = 250) { return Math.floor(Math.random() * extra); }
function __isTransientLidarrError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return /\b(5\d\d|serviceunavailable|temporarily unavailable|timeout|timed out|etimedout|econn|refused|fetch failed|503)\b/.test(msg);
}

// ======== ADD: abort helpers ========
type ShouldAbortFn = () => boolean | Promise<boolean>;

async function __shouldAbort(fn?: ShouldAbortFn): Promise<boolean> {
  if (!fn) return false;
  try { return !!(await fn()); } catch { return false; }
}

async function __sleepAbortable(ms: number, shouldAbort?: ShouldAbortFn, stepMs = 250) {
  const step = Math.max(50, stepMs);
  let left = Math.max(0, ms);

  while (left > 0) {
    if (await __shouldAbort(shouldAbort)) return;
    const chunk = Math.min(step, left);
    await new Promise(r => setTimeout(r, chunk));
    left -= chunk;
  }
}

// ===================================

export async function findArtistLocalByMBID(base: string, apiKey: string, mbid: string): Promise<any | null> {
  const artists: any[] = await __lidarrApi(base, apiKey, '/api/v1/artist');
  const needle = String(mbid).toLowerCase();
  return artists.find(a => String(a?.foreignArtistId || a?.mbid || '').toLowerCase().includes(needle)) || null;
}

export async function findAlbumLocalByMBID(base: string, apiKey: string, rgMbid: string): Promise<any | null> {
  const albums: any[] = await __lidarrApi(base, apiKey, '/api/v1/album');
  const needle = String(rgMbid).toLowerCase();
  return albums.find(a => String(a?.foreignAlbumId || a?.mbid || '').toLowerCase().includes(needle)) || null;
}

export async function lookupAlbumByMBID(base: string, apiKey: string, rgMbid: string): Promise<any | null> {
  const path = `/api/v1/album/lookup?term=mbid:${encodeURIComponent(rgMbid)}`;

  const items: any[] = await skyhookLimiter.schedule(() =>
    __lidarrApi(base, apiKey, path)
  );

  const needle = String(rgMbid).toLowerCase();
  const hit = items?.find?.((x: any) =>
    String(x?.foreignAlbumId || x?.mbid || '').toLowerCase().includes(needle)
  ) || null;

  return hit || (Array.isArray(items) && items.length ? items[0] : null);
}

type LogFn = (level: 'info' | 'warn' | 'error', msg: string, extra?: any) => Promise<void>;

type PushConfirmOpts = {
  maxAttempts?: number;
  initialDelayMs?: number;
  shouldAbort?: ShouldAbortFn;
};

export async function pushArtistWithConfirm(
  setting: any,
  it: { name: string; mbid: string },
  extLog: LogFn,
  opts: PushConfirmOpts = {},
): Promise<{ ok: true; res: any } | { ok: false; reason: string }> {
  const base = String(setting?.lidarrUrl || '').replace(/\/+$/, '');
  const apiKey = String(setting?.lidarrApiKey || '');
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  let delay = Math.max(500, opts.initialDelayMs ?? 1000);

  if (await __shouldAbort(opts.shouldAbort)) {
    await extLog('warn', `Cancelled before artist push: ${it.name}`, { mbid: it.mbid });
    return { ok: false, reason: 'cancelled' };
  }

  // pre-check
  try {
    const exists = await findArtistLocalByMBID(base, apiKey, it.mbid);
    if (exists) {
      await extLog('info', `Artist already present (pre-check): ${it.name}`, { mbid: it.mbid, lidarrId: exists.id, action: 'exists-pre' });
      log.info('artist present pre-check', 'lidarr.push.artist.pre.exists', { mbid: it.mbid, id: exists.id });
      return { ok: true, res: { __action: 'exists', id: exists.id, artistName: exists.artistName || exists.name, path: exists.path } };
    }
  } catch (e: any) {
    await extLog('warn', 'Pre-check failed (will continue)', { name: it.name, mbid: it.mbid, error: String(e?.message || e) });
    log.warn('artist pre-check failed', 'lidarr.push.artist.pre.fail', { mbid: it.mbid, err: e?.message });
  }

  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await __shouldAbort(opts.shouldAbort)) {
      await extLog('warn', `Cancelled during artist push: ${it.name}`, { mbid: it.mbid, attempt, maxAttempts });
      return { ok: false, reason: 'cancelled' };
    }

    try {
      const res = await ensureArtistInLidarr(setting, { name: it.name, mbid: it.mbid });

      const confirmAttempts = 3;
      let confirmed: any | null = null;

      for (let c = 0; c < confirmAttempts; c++) {
        if (await __shouldAbort(opts.shouldAbort)) {
          await extLog('warn', `Cancelled during artist confirm: ${it.name}`, { mbid: it.mbid, confirmAttempt: c + 1 });
          return { ok: false, reason: 'cancelled' };
        }

        await __sleepAbortable(500 + __jitter(200), opts.shouldAbort);

        try {
          confirmed = await findArtistLocalByMBID(base, apiKey, it.mbid);
          if (confirmed) break;
        } catch (e: any) {
          await extLog('warn', 'Post-check read failed (will retry confirm)', {
            attempt: c + 1, name: it.name, mbid: it.mbid, error: String(e?.message || e),
          });
          log.warn('artist post-check read failed', 'lidarr.push.artist.post.read.fail', { attempt: c + 1, mbid: it.mbid, err: e?.message });
        }
      }

      if (confirmed) {
        await extLog('info', `✔ Pushed artist (confirmed): ${confirmed.artistName || it.name}`, {
          action: res?.__action || 'created',
          lidarrId: confirmed.id,
          path: confirmed.path,
          name: confirmed.artistName || it.name,
          mbid: it.mbid,
          from: res?.__from,
          payload: res?.__request,
          response: res?.__response,
        });
        log.info('artist push confirmed', 'lidarr.push.artist.confirmed', { mbid: it.mbid, id: confirmed.id });
        return { ok: true, res: { ...res, id: confirmed.id, path: confirmed.path, artistName: confirmed.artistName || it.name } };
      }

      lastErr = new Error('timeout waiting artist to appear (post-check)');
      await extLog('warn', `~ Retrying (artist not confirmed yet): ${it.name}`, {
        attempt, maxAttempts, delayMs: delay, reason: String(lastErr.message),
      });
      log.warn('artist not confirmed yet', 'lidarr.push.artist.confirm.wait', { attempt, mbid: it.mbid, delayMs: delay });
    } catch (e: any) {
      lastErr = e;
      const transient = __isTransientLidarrError(e);
      await extLog(transient ? 'warn' : 'error',
        transient ? `~ Retrying push (transient): ${it.name}` : `✖ Push failed (fatal): ${it.name}`,
        { attempt, maxAttempts, delayMs: transient ? delay : 0, error: String(e?.message || e) }
      );

      if (transient) {
        log.warn('transient artist push error (retry)', 'lidarr.push.artist.retry', { attempt, mbid: it.mbid, err: e?.message, delayMs: delay });
      } else {
        log.error('fatal artist push error', 'lidarr.push.artist.fail', { attempt, mbid: it.mbid, err: e?.message });
        break;
      }
    }

    if (await __shouldAbort(opts.shouldAbort)) {
      await extLog('warn', `Cancelled before retry sleep (artist): ${it.name}`, { mbid: it.mbid, attempt, maxAttempts });
      return { ok: false, reason: 'cancelled' };
    }

    await __sleepAbortable(delay + __jitter(300), opts.shouldAbort);
    delay = Math.min(delay * 3, 90_000);
  }

  log.error('artist push failed after retries', 'lidarr.push.artist.final.fail', { mbid: it.mbid, reason: String(lastErr?.message || lastErr || 'unknown') });
  return { ok: false, reason: String(lastErr?.message || lastErr || 'unknown error') };
}

export async function pushAlbumWithConfirm(
  setting: any,
  it: { artist: string; title: string; rgMbid: string },
  extLog: LogFn,
  opts: PushConfirmOpts = {},
): Promise<{ ok: true; res: any } | { ok: false; reason: string }> {
  const base = String(setting?.lidarrUrl || '').replace(/\/+$/, '');
  const apiKey = String(setting?.lidarrApiKey || '');
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  let delay = Math.max(500, opts.initialDelayMs ?? 1000);

  if (await __shouldAbort(opts.shouldAbort)) {
    await extLog('warn', `Cancelled before album push: ${it.artist} — ${it.title}`, { rgMbid: it.rgMbid });
    return { ok: false, reason: 'cancelled' };
  }

  try {
    const local = await findAlbumLocalByMBID(base, apiKey, it.rgMbid);
    if (local) {
      await extLog('info', `Album already present (pre-check local): ${it.artist} — ${it.title}`, {
        rgMbid: it.rgMbid, action: 'exists-pre', lidarrId: local?.id, hitTitle: local?.title,
      });
      log.info('album present pre-check local', 'lidarr.push.album.pre.exists.local', { rgMbid: it.rgMbid, id: local?.id });
      return { ok: true, res: { __action: 'exists', id: local?.id, title: local?.title, path: local?.path } };
    }
  } catch (e: any) {
    await extLog('warn', 'Album pre-check local failed (will continue)', {
      artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e),
    });
    log.warn('album pre-check local failed', 'lidarr.push.album.pre.local.fail', { rgMbid: it.rgMbid, err: e?.message });
  }

  if (await __shouldAbort(opts.shouldAbort)) {
    await extLog('warn', `Cancelled after album pre-check local: ${it.artist} — ${it.title}`, { rgMbid: it.rgMbid });
    return { ok: false, reason: 'cancelled' };
  }

  try {
    const hit = await lookupAlbumByMBID(base, apiKey, it.rgMbid);
    if (hit) {
      await extLog('info', `Album seems present (pre-check lookup): ${it.artist} — ${it.title}`, {
        rgMbid: it.rgMbid, action: 'exists-pre', hitTitle: hit?.title,
      });
      log.info('album present pre-check', 'lidarr.push.album.pre.exists', { rgMbid: it.rgMbid, id: hit?.id });
      return { ok: true, res: { __action: 'exists', id: hit?.id, title: hit?.title, path: hit?.path } };
    }
  } catch (e: any) {
    if (__isTransientLidarrError(e)) {
      await extLog('warn', 'Album pre-check transient failure (will continue)', {
        artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e),
      });
      log.warn('album pre-check transient', 'lidarr.push.album.pre.transient', { rgMbid: it.rgMbid, err: e?.message });
    } else {
      await extLog('warn', 'Album pre-check failed (non-transient, will continue anyway)', {
        artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e),
      });
      log.warn('album pre-check failed', 'lidarr.push.album.pre.fail', { rgMbid: it.rgMbid, err: e?.message });
    }
  }

  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await __shouldAbort(opts.shouldAbort)) {
      await extLog('warn', `Cancelled during album push: ${it.artist} — ${it.title}`, { rgMbid: it.rgMbid, attempt, maxAttempts });
      return { ok: false, reason: 'cancelled' };
    }

    try {
      const res = await ensureAlbumInLidarr(setting, { artist: it.artist, title: it.title, rgMbid: it.rgMbid });

      const confirmAttempts = 3;
      let confirmed: any | null = null;

      for (let c = 0; c < confirmAttempts; c++) {
        if (await __shouldAbort(opts.shouldAbort)) {
          await extLog('warn', `Cancelled during album confirm: ${it.artist} — ${it.title}`, { rgMbid: it.rgMbid, confirmAttempt: c + 1 });
          return { ok: false, reason: 'cancelled' };
        }

        await __sleepAbortable(500 + __jitter(200), opts.shouldAbort);

        try {
          confirmed = await findAlbumLocalByMBID(base, apiKey, it.rgMbid);

          if (!confirmed) {
            confirmed = await lookupAlbumByMBID(base, apiKey, it.rgMbid);
          }

          if (confirmed) break;
        } catch (e: any) {
          await extLog('warn', 'Album post-check lookup failed (will retry confirm)', {
            attempt: c + 1, artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e),
          });
          log.warn('album post-check lookup failed', 'lidarr.push.album.post.lookup.fail', { attempt: c + 1, rgMbid: it.rgMbid, err: e?.message });
        }
      }

      if (confirmed) {
        await extLog('info', `✔ Pushed album (confirmed): ${confirmed.title || it.title}`, {
          action: res?.__action || 'created',
          lidarrId: confirmed.id,
          path: confirmed.path,
          title: confirmed.title || it.title,
          rgMbid: it.rgMbid,
          from: res?.__from,
          payload: res?.__request,
          response: res?.__response,
        });
        log.info('album push confirmed', 'lidarr.push.album.confirmed', { rgMbid: it.rgMbid, id: confirmed.id });
        return { ok: true, res: { ...res, id: confirmed.id, path: confirmed.path, title: confirmed.title || it.title } };
      }

      lastErr = new Error('timeout waiting album to appear (post-check)');
      await extLog('warn', `~ Retrying (album not confirmed yet): ${it.artist} — ${it.title}`, {
        attempt, maxAttempts, delayMs: delay, reason: String(lastErr.message),
      });
      log.warn('album not confirmed yet', 'lidarr.push.album.confirm.wait', { attempt, rgMbid: it.rgMbid, delayMs: delay });
    } catch (e: any) {
      lastErr = e;
      const transient = __isTransientLidarrError(e);
      await extLog(transient ? 'warn' : 'error',
        transient ? `~ Retrying album push (transient): ${it.artist} — ${it.title}` : `✖ Album push failed (fatal): ${it.artist} — ${it.title}`,
        { attempt, maxAttempts, delayMs: transient ? delay : 0, error: String(e?.message || e) }
      );

      if (transient) {
        log.warn('transient album push error (retry)', 'lidarr.push.album.retry', { attempt, rgMbid: it.rgMbid, err: e?.message, delayMs: delay });
      } else {
        log.error('fatal album push error', 'lidarr.push.album.fail', { attempt, rgMbid: it.rgMbid, err: e?.message });
        break;
      }
    }

    if (await __shouldAbort(opts.shouldAbort)) {
      await extLog('warn', `Cancelled before retry sleep (album): ${it.artist} — ${it.title}`, { rgMbid: it.rgMbid, attempt, maxAttempts });
      return { ok: false, reason: 'cancelled' };
    }

    await __sleepAbortable(delay + __jitter(300), opts.shouldAbort);
    delay = Math.min(delay * 3, 90_000);
  }

  log.error('album push failed after retries', 'lidarr.push.album.final.fail', { rgMbid: it.rgMbid, reason: String(lastErr?.message || lastErr || 'unknown') });
  return { ok: false, reason: String(lastErr?.message || lastErr || 'unknown error') };
}
