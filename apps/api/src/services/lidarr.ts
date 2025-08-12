import { request } from 'undici';

export type Setting = {
  lidarrUrl: string;
  lidarrApiKey: string;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
  monitor?: string | null; // e.g. "all"
};

function baseUrl(s: Setting) {
  return s.lidarrUrl.replace(/\/+$/, '');
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

/* ======== NEW: Lists for UI dropdowns ======== */

export async function getQualityProfiles(s: Setting) {
  const r = await api<any[]>(s, '/api/v1/qualityprofile');
  return Array.isArray(r.data) ? r.data : [];
}

export async function getMetadataProfiles(s: Setting) {
  const r = await api<any[]>(s, '/api/v1/metadataprofile');
  return Array.isArray(r.data) ? r.data : [];
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

export async function ensureArtistInLidarr(s: Setting, a: { name: string; mbid: string }) {
  if (!s.rootFolderPath || !s.qualityProfileId || !s.metadataProfileId) {
    throw new Error('Lidarr settings missing: rootFolderPath, qualityProfileId, metadataProfileId');
  }
  const existing = await findExistingArtistByMBID(s, a.mbid);
  if (existing) return existing;

  const lu = await api<any[]>(s, `/api/v1/artist/lookup?term=mbid:${a.mbid}`);
  if (!Array.isArray(lu.data) || !lu.data.length)
    throw new Error(`Lidarr lookup failed for artist ${a.name} (${a.mbid})`);
  const src = lu.data[0];

  const body = {
    ...src,
    foreignArtistId: a.mbid,
    qualityProfileId: s.qualityProfileId,
    metadataProfileId: s.metadataProfileId,
    rootFolderPath: s.rootFolderPath,
    monitored: true,
    monitor: s.monitor || 'all',
    addOptions: { searchForMissingAlbums: false },
    tags: [],
  };

  const r = await api(s, `/api/v1/artist`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.status >= 400 && String(r.data).includes('already exists'))
    return await findExistingArtistByMBID(s, a.mbid);
  if (r.status >= 400)
    throw new Error(`Lidarr add artist failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export async function ensureAlbumInLidarr(
  s: Setting,
  al: { artist: string; title: string; rgMbid: string },
) {
  if (!s.rootFolderPath || !s.qualityProfileId || !s.metadataProfileId) {
    throw new Error('Lidarr settings missing: rootFolderPath, qualityProfileId, metadataProfileId');
  }

  const lu = await api<any[]>(s, `/api/v1/album/lookup?term=mbid:${al.rgMbid}`);
  if (!Array.isArray(lu.data) || !lu.data.length)
    throw new Error(`Lidarr lookup failed for album ${al.title} (${al.rgMbid})`);
  const src = lu.data[0];

  const artistMbid: string | undefined = src.foreignArtistId || src.artist?.foreignArtistId;
  if (artistMbid) {
    await ensureArtistInLidarr(s, {
      name: src.artist?.artistName || al.artist,
      mbid: artistMbid.replace(/^mbid:/, ''),
    });
  }

  const lib = await api<any[]>(s, '/api/v1/album');
  const exists =
    Array.isArray(lib.data) && lib.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid));
  if (exists) return exists;

  const body = {
    ...src,
    foreignAlbumId: al.rgMbid,
    qualityProfileId: s.qualityProfileId,
    metadataProfileId: s.metadataProfileId,
    rootFolderPath: s.rootFolderPath,
    monitored: true,
    addOptions: { searchForNewAlbum: false },
    tags: [],
  };

  const r = await api(s, `/api/v1/album`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.status >= 400 && String(r.data).includes('already exists')) {
    const refreshed = await api<any[]>(s, '/api/v1/album');
    return Array.isArray(refreshed.data)
      ? refreshed.data.find((x) => x.foreignAlbumId?.includes(al.rgMbid))
      : r.data;
  }
  if (r.status >= 400)
    throw new Error(`Lidarr add album failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
