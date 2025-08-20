// apps/api/src/services/lidarr.ts
import { request } from 'undici';

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
  const res = await request(url, init);
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
