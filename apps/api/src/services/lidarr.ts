// apps/api/src/services/lidarr.ts
import { request } from 'undici';

const DEFAULT_HEADERS_TIMEOUT = 10_000; // 10s
const DEFAULT_BODY_TIMEOUT = 30_000;    // 30s

export type Setting = {
  lidarrUrl: string;
  lidarrApiKey: string;

  // дефолты из БД
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null; // e.g. "all"

  lidarrAllowNoMetadata?: boolean | null; // для артистов
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

/** Только БД + мягкие дефолты (на случай пустой БД) */
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
  const res = await request(url, {
    headersTimeout: DEFAULT_HEADERS_TIMEOUT,
    bodyTimeout: DEFAULT_BODY_TIMEOUT,
    ...init
  });
  const text = await res.body.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.statusCode, data: data as T };
}

export async function testLidarr(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api(s, '/api/v1/system/status');
  return { ok: r.status < 400, status: r.status, data: r.data };
}

/* ======== lists ======== */
export async function getQualityProfiles(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/qualityprofile');
  return Array.isArray(r.data) ? r.data : [];
}
export async function getMetadataProfiles(s0: Setting) {
  const s = withDefaults(s0);
  for (const p of ['/api/v1/metadataprofile', '/api/v1/metadata/profile', '/api/v1/metadataProfile']) {
    try {
      const r = await api<any[]>(s, p);
      if (Array.isArray(r.data)) return r.data;
    } catch {}
  }
  return [];
}
export async function getRootFolders(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/rootfolder');
  return Array.isArray(r.data) ? r.data : [];
}
export async function getTags(s0: Setting) {
  const s = withDefaults(s0);
  const r = await api<any[]>(s, '/api/v1/tag');
  return Array.isArray(r.data) ? r.data : [];
}

/* ======== helpers ======== */
async function findExistingArtistByMBID(s: Setting, mbid: string) {
  const lookup = await api<any[]>(s, `/api/v1/artist?term=mbid:${mbid}`);
  if (Array.isArray(lookup.data) && lookup.data.some((a) => a.foreignArtistId?.includes(mbid))) {
    return lookup.data.find((a) => a.foreignArtistId?.includes(mbid));
  }
  const all = await api<any[]>(s, `/api/v1/artist`);
  if (Array.isArray(all.data)) return all.data.find((a) => a.foreignArtistId?.includes(mbid));
  return null;
}
async function lookupWithRetry(s: Setting, path: string, attempts = 2, delayMs = 800) {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await api<any[]>(s, path);
      if (Array.isArray(r.data) && r.data.length) return r;
      lastErr = new Error('Lookup returned empty array');
    } catch (e) { lastErr = e; }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Lookup failed for ${path} (${attempts} attempts): ${String(lastErr?.message || lastErr)}`);
}
async function postWithRetry(s: Setting, path: string, body: any, attempts = 3, delayMs = 1000) {
  let last: { status: number; data: any } | null = null;
  for (let i = 0; i < attempts; i++) {
    const r = await api(s, path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    last = r;
    if (r.status < 500 || (r.status !== 500 && r.status !== 503)) return r;
    if (i < attempts - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  return last!;
}

/* ======== public: ensure* ======== */
export async function ensureArtistInLidarr(s0: Setting, a: { name: string; mbid: string }): Promise<EnsureResult> {
  const s = withDefaults(s0);
  assertPushSettings(s);

  const allowNoMeta = !!s.lidarrAllowNoMetadata;

  const existing = await findExistingArtistByMBID(s, a.mbid);
  if (existing) return { ...existing, __action: 'exists', __from: 'lookup' };

  let src: any | null = null;
  let from: 'lookup' | 'fallback' = 'lookup';
  try {
    const lu = await lookupWithRetry(s, `/api/v1/artist/lookup?term=mbid:${a.mbid}`);
    src = Array.isArray(lu.data) && lu.data.length ? lu.data[0] : null;
    if (!src && !allowNoMeta) return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    if (!src) from = 'fallback';
  } catch {
    if (!allowNoMeta) return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    src = null; from = 'fallback';
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

  const r = await postWithRetry(s, `/api/v1/artist`, body, 3, 1000);

  if (r.status >= 400 && String(r.data).includes('already exists')) {
    const again = await findExistingArtistByMBID(s, a.mbid);
    const res = again ?? r.data;
    return { ...(res as any), __action: 'exists', __from: from, __request: body, __response: r.data };
  }
  if (r.status >= 400) throw new Error(`Lidarr add artist failed: ${r.status} ${JSON.stringify(r.data)}`);

  return { ...(r.data as any), __action: 'created', __from: from, __request: body, __response: r.data };
}

export async function ensureAlbumInLidarr(s0: Setting, al: { artist: string; title: string; rgMbid: string }): Promise<EnsureResult> {
  const s = withDefaults(s0);
  assertPushSettings(s);

  try {
    const lib0 = await api<any[]>(s, '/api/v1/album');
    const exists0 = Array.isArray(lib0.data) && lib0.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
    if (exists0) return { ...exists0, __action: 'exists', __from: 'lookup' };
  } catch {}

  let src: any | null = null;
  try {
    const lu = await lookupWithRetry(s, `/api/v1/album/lookup?term=mbid:${al.rgMbid}`);
    if (!Array.isArray(lu.data) || !lu.data.length) {
      return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
    }
    src = lu.data[0];
  } catch {
    return { __action: 'skipped', __reason: 'lidarrapi_metadata_unavailable' };
  }

  const artistMbid: string | undefined = src.foreignArtistId || src.artist?.foreignArtistId;
  if (artistMbid) {
    await ensureArtistInLidarr(s, {
      name: src.artist?.artistName || al.artist,
      mbid: artistMbid.replace(/^mbid:/, ''),
    });
  }

  const lib = await api<any[]>(s, '/api/v1/album');
  const exists = Array.isArray(lib.data) && lib.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
  if (exists) return { ...exists, __action: 'exists', __from: 'lookup' };

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

  const r = await postWithRetry(s, `/api/v1/album`, body, 3, 1000);

  if (r.status >= 400 && String(r.data).includes('already exists')) {
    const refreshed = await api<any[]>(s, '/api/v1/album');
    const found = Array.isArray(refreshed.data)
        ? refreshed.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid))
        : r.data;
    return { ...(found as any), __action: 'exists', __from: 'lookup', __request: body, __response: r.data };
  }
  if (r.status >= 400) throw new Error(`Lidarr add album failed: ${r.status} ${JSON.stringify(r.data)}`);

  return { ...(r.data as any), __action: 'created', __from: 'lookup', __request: body, __response: r.data };
}

// ==================== ADD: confirm & retry helpers (artists + albums) ====================
import { request as __undiciRequest } from 'undici';

// Локальный helper HTTP для этого модуля (не конфликтует с workers.ts)
async function __lidarrApi<T = any>(base: string, key: string, path: string): Promise<T> {
  const url = `${base.replace(/\/+$/, '')}${path}`;
  const res = await __undiciRequest(url, { headers: { 'X-Api-Key': key } });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`Lidarr ${path} ${res.statusCode}: ${text?.slice(0, 180)}`);
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

function __sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function __jitter(extra = 250) { return Math.floor(Math.random() * extra); }
function __isTransientLidarrError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return /\b(5\d\d|serviceunavailable|temporarily unavailable|timeout|timed out|etimedout|econn|refused|fetch failed|503)\b/.test(msg);
}

/** Локальная проверка присутствия артиста по MBID: НЕ бьёт SkyHook */
export async function findArtistLocalByMBID(base: string, apiKey: string, mbid: string): Promise<any | null> {
  const artists: any[] = await __lidarrApi(base, apiKey, '/api/v1/artist');
  return artists.find(a => (a?.foreignArtistId || a?.mbid) === mbid) || null;
}

/**
 * Проверка альбома по MBID.
 * В Лидарре нет стабильного фильтра «по MBID» в локальном списке альбомов,
 * поэтому используем album lookup (это бьёт SkyHook). Это ОК, т.к. главный кейс
 * — обработка транзиентных 503 с ретраями.
 */
export async function lookupAlbumByMBID(base: string, apiKey: string, rgMbid: string): Promise<any | null> {
  try {
    const items: any[] = await __lidarrApi(base, apiKey, `/api/v1/album/lookup?term=mbid:${encodeURIComponent(rgMbid)}`);
    // Если SkyHook ответил успешно и есть совпадение — считаем подтверждённым.
    const hit = items?.find?.((x: any) => (x?.foreignAlbumId || x?.mbid) === rgMbid) || null;
    return hit || (Array.isArray(items) && items.length ? items[0] : null);
  } catch (e) {
    throw e;
  }
}

/**
 * Добавление артиста с подтверждением появления в ЛОКАЛЬНОЙ базе.
 * - Идемпотентный pre-check (local /artist)
 * - ensureArtistInLidarr
 * - post-check (local /artist), ретраи на 5xx/503
 */
export async function pushArtistWithConfirm(
    setting: any,
    it: { name: string; mbid: string },
    log: (level: 'info'|'warn'|'error', msg: string, extra?: any) => Promise<void>,
    opts: { maxAttempts?: number; initialDelayMs?: number } = {},
): Promise<{ ok: true; res: any } | { ok: false; reason: string }> {
  const base = String(setting?.lidarrUrl || '').replace(/\/+$/, '');
  const apiKey = String(setting?.lidarrApiKey || '');
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  let delay = Math.max(500, opts.initialDelayMs ?? 1000);

  // pre-check
  try {
    const exists = await findArtistLocalByMBID(base, apiKey, it.mbid);
    if (exists) {
      await log('info', `Artist already present (pre-check): ${it.name}`, { mbid: it.mbid, lidarrId: exists.id, action: 'exists-pre' });
      return { ok: true, res: { __action: 'exists', id: exists.id, artistName: exists.artistName || exists.name, path: exists.path } };
    }
  } catch (e: any) {
    await log('warn', 'Pre-check failed (will continue)', { name: it.name, mbid: it.mbid, error: String(e?.message || e) });
  }

  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await ensureArtistInLidarr(setting, { name: it.name, mbid: it.mbid });

      // post-check: ждём появления локально
      const confirmAttempts = 3;
      let confirmed: any | null = null;
      for (let c = 0; c < confirmAttempts; c++) {
        await __sleep(500 + __jitter(200));
        try {
          confirmed = await findArtistLocalByMBID(base, apiKey, it.mbid);
          if (confirmed) break;
        } catch (e: any) {
          await log('warn', 'Post-check read failed (will retry confirm)', { attempt: c + 1, name: it.name, mbid: it.mbid, error: String(e?.message || e) });
        }
      }

      if (confirmed) {
        await log('info', `✔ Pushed artist (confirmed): ${confirmed.artistName || it.name}`, {
          action: res?.__action || 'created',
          lidarrId: confirmed.id, path: confirmed.path,
          name: confirmed.artistName || it.name, mbid: it.mbid, from: res?.__from,
          payload: res?.__request, response: res?.__response,
        });
        return { ok: true, res: { ...res, id: confirmed.id, path: confirmed.path, artistName: confirmed.artistName || it.name } };
      }

      lastErr = new Error('timeout waiting artist to appear (post-check)');
      await log('warn', `~ Retrying (artist not confirmed yet): ${it.name}`, { attempt, maxAttempts, delayMs: delay, reason: String(lastErr.message) });
    } catch (e: any) {
      lastErr = e;
      const transient = __isTransientLidarrError(e);
      await log(transient ? 'warn' : 'error', transient ? `~ Retrying push (transient): ${it.name}` : `✖ Push failed (fatal): ${it.name}`, {
        attempt, maxAttempts, delayMs: transient ? delay : 0, error: String(e?.message || e),
      });
      if (!transient) break;
    }

    await __sleep(delay + __jitter(300));
    delay = Math.min(delay * 3, 90_000);
  }

  return { ok: false, reason: String(lastErr?.message || lastErr || 'unknown error') };
}

/**
 * Добавление альбома с подтверждением.
 * - Pre-check: /api/v1/album/lookup?term=mbid:<rgMbid> (да, это SkyHook; решает наш кейс с 503 через ретраи)
 * - ensureAlbumInLidarr
 * - Post-check: тот же lookup с ретраями (на 503/5xx)
 */
export async function pushAlbumWithConfirm(
    setting: any,
    it: { artist: string; title: string; rgMbid: string },
    log: (level: 'info'|'warn'|'error', msg: string, extra?: any) => Promise<void>,
    opts: { maxAttempts?: number; initialDelayMs?: number } = {},
): Promise<{ ok: true; res: any } | { ok: false; reason: string }> {
  const base = String(setting?.lidarrUrl || '').replace(/\/+$/, '');
  const apiKey = String(setting?.lidarrApiKey || '');
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  let delay = Math.max(500, opts.initialDelayMs ?? 1000);

  // pre-check (если что-то вернулось — считаем, что в каталоге уже есть релиз по этому MBID)
  try {
    const hit = await lookupAlbumByMBID(base, apiKey, it.rgMbid);
    if (hit) {
      await log('info', `Album seems present (pre-check lookup): ${it.artist} — ${it.title}`, {
        rgMbid: it.rgMbid, action: 'exists-pre', hitTitle: hit?.title,
      });
      return { ok: true, res: { __action: 'exists', id: hit?.id, title: hit?.title, path: hit?.path } };
    }
  } catch (e: any) {
    // Если тут 503 — продолжим, логнём и пойдём в ensure + ретраи
    if (__isTransientLidarrError(e)) {
      await log('warn', 'Album pre-check transient failure (will continue)', { artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e) });
    } else {
      await log('warn', 'Album pre-check failed (non-transient, will continue anyway)', { artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e) });
    }
  }

  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await ensureAlbumInLidarr(setting, { artist: it.artist, title: it.title, rgMbid: it.rgMbid });

      // post-check через lookup с несколькими быстрыми попытками
      const confirmAttempts = 3;
      let confirmed: any | null = null;
      for (let c = 0; c < confirmAttempts; c++) {
        await __sleep(500 + __jitter(200));
        try {
          confirmed = await lookupAlbumByMBID(base, apiKey, it.rgMbid);
          if (confirmed) break;
        } catch (e: any) {
          await log('warn', 'Album post-check lookup failed (will retry confirm)', {
            attempt: c + 1, artist: it.artist, title: it.title, rgMbid: it.rgMbid, error: String(e?.message || e),
          });
        }
      }

      if (confirmed) {
        await log('info', `✔ Pushed album (confirmed): ${confirmed.title || it.title}`, {
          action: res?.__action || 'created',
          lidarrId: confirmed.id, path: confirmed.path,
          title: confirmed.title || it.title, rgMbid: it.rgMbid, from: res?.__from,
          payload: res?.__request, response: res?.__response,
        });
        return { ok: true, res: { ...res, id: confirmed.id, path: confirmed.path, title: confirmed.title || it.title } };
      }

      lastErr = new Error('timeout waiting album to appear (post-check)');
      await log('warn', `~ Retrying (album not confirmed yet): ${it.artist} — ${it.title}`, { attempt, maxAttempts, delayMs: delay, reason: String(lastErr.message) });
    } catch (e: any) {
      lastErr = e;
      const transient = __isTransientLidarrError(e);
      await log(transient ? 'warn' : 'error', transient ? `~ Retrying album push (transient): ${it.artist} — ${it.title}` : `✖ Album push failed (fatal): ${it.artist} — ${it.title}`, {
        attempt, maxAttempts, delayMs: transient ? delay : 0, error: String(e?.message || e),
      });
      if (!transient) break;
    }

    await __sleep(delay + __jitter(300));
    delay = Math.min(delay * 3, 90_000);
  }

  return { ok: false, reason: String(lastErr?.message || lastErr || 'unknown error') };
}
