import { request } from 'undici';

export type Setting = {
  lidarrUrl: string;
  lidarrApiKey: string;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null; // e.g. "all"
};

type EnsureResult = any & {
  __action?: 'created' | 'exists' | 'skipped'; // <- добавил 'skipped'
  __from?: 'lookup' | 'fallback';
  __request?: any;
  __response?: any;
  __reason?: string; // <- причина, когда skipped
};

function baseUrl(s: Setting) {
  return String(s.lidarrUrl || '').replace(/\/+$/, '');
}

function normalizeRoot(p?: string | null) {
  return String(p || '').replace(/\/+$/, '');
}

async function api<T = any>(
    s: Setting,
    path: string,
    init?: Parameters<typeof request>[1],
): Promise<{ status: number; data: T }> {
  const url = `${baseUrl(s)}${path}${path.includes('?') ? '&' : '?'}apikey=${s.lidarrApiKey}`;
  const res = await request(url, init);
  const text = await res.body.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.statusCode, data };
}

export async function testLidarr(s: Setting) {
  const r = await api(s, '/api/v1/system/status');
  return { ok: r.status < 400, status: r.status, data: r.data };
}

/* ======== Lists for UI dropdowns ======== */

export async function getQualityProfiles(s: Setting) {
  const r = await api<any[]>(s, '/api/v1/qualityprofile');
  return Array.isArray(r.data) ? r.data : [];
}

export async function getMetadataProfiles(s: Setting) {
  // разные сборки: пробуем несколько путей
  const paths = ['/api/v1/metadataprofile', '/api/v1/metadata/profile', '/api/v1/metadataProfile'];
  for (const p of paths) {
    try {
      const r = await api<any[]>(s, p);
      if (Array.isArray(r.data)) return r.data;
    } catch {
      // next
    }
  }
  return [];
}

export async function getRootFolders(s: Setting) {
  const r = await api<any[]>(s, '/api/v1/rootfolder');
  return Array.isArray(r.data) ? r.data : [];
}

export async function getTags(s: Setting) {
  const r = await api<any[]>(s, '/api/v1/tag');
  return Array.isArray(r.data) ? r.data : [];
}

/* ======== Helpers used in push ======== */

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
      // даже если 200, но массив пуст — считаем ошибкой lookup
      lastErr = new Error('Lookup returned empty array');
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw new Error(
      `Lookup failed for ${path} (${attempts} attempts): ${String(lastErr?.message || lastErr)}`,
  );
}

async function postWithRetry(
    s: Setting,
    path: string,
    body: any,
    attempts = 3,
    delayMs = 1000,
): Promise<{ status: number; data: any }> {
  let last: { status: number; data: any } | null = null;
  for (let i = 0; i < attempts; i++) {
    const r = await api(s, path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    last = r;
    // если не 500/503 — выходим сразу
    if (r.status < 500 || (r.status !== 500 && r.status !== 503)) return r;

    // 500/503 — часто из-за SkyHook; подождём и повторим
    if (i < attempts - 1) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  return last!;
}

export async function ensureArtistInLidarr(
    s: Setting,
    a: { name: string; mbid: string },
): Promise<EnsureResult> {
  if (!s.rootFolderPath || !s.qualityProfileId || !s.metadataProfileId) {
    throw new Error('Lidarr settings missing: rootFolderPath, qualityProfileId, metadataProfileId');
  }

  // Уже есть?
  const existing = await findExistingArtistByMBID(s, a.mbid);
  if (existing) return { ...existing, __action: 'exists', __from: 'lookup' };

  // Пробуем lookup; если пусто/упало — fallback: минимальный POST
  let src: any | null = null;
  let from: 'lookup' | 'fallback' = 'lookup';
  try {
    const lu = await lookupWithRetry(s, `/api/v1/artist/lookup?term=mbid:${a.mbid}`);
    if (Array.isArray(lu.data) && lu.data.length) {
      src = lu.data[0];
    } else {
      src = null;
      from = 'fallback';
    }
  } catch {
    src = null;
    from = 'fallback';
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
        // минимально достаточное тело без lookup
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
  if (r.status >= 400) {
    // отдадим максимально информативную ошибку
    throw new Error(`Lidarr add artist failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  return { ...(r.data as any), __action: 'created', __from: from, __request: body, __response: r.data };
}

export async function ensureAlbumInLidarr(
    s: Setting,
    al: { artist: string; title: string; rgMbid: string },
): Promise<EnsureResult> {
  if (!s.rootFolderPath || !s.qualityProfileId || !s.metadataProfileId) {
    throw new Error('Lidarr settings missing: rootFolderPath, qualityProfileId, metadataProfileId');
  }

  try {
    const lib0 = await api<any[]>(s, '/api/v1/album');
    const exists0 =
        Array.isArray(lib0.data) && lib0.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
    if (exists0) return { ...exists0, __action: 'exists', __from: 'lookup' };
  } catch {
    // игнорируем — ниже ещё будет попытка
  }

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

  // 4) Ещё раз проверим наличие альбома (как и было изначально)
  const lib = await api<any[]>(s, '/api/v1/album');
  const exists =
      Array.isArray(lib.data) && lib.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
  if (exists) return { ...exists, __action: 'exists', __from: 'lookup' };

  // 5) Создание
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
  if (r.status >= 400)
    throw new Error(`Lidarr add album failed: ${r.status} ${JSON.stringify(r.data)}`);

  return { ...(r.data as any), __action: 'created', __from: 'lookup', __request: body, __response: r.data };
}
