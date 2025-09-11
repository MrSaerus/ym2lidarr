// apps/api/src/services/navidrome.ts
import { request } from 'undici';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'service.navidrome' });

export type NdAuth =
  | { user: string; pass: string; client?: string; apiVer?: string }
  | { user: string; token: string; salt: string; client?: string; apiVer?: string };

function nkey(s: string) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export class NavidromeClient {
  private base: string;
  private auth: NdAuth;
  private client: string;
  private apiVer: string;

  constructor(baseUrl: string, auth: NdAuth) {
    this.base = (baseUrl || '').replace(/\/+$/, '');
    this.auth = auth;
    this.client = auth.client || 'YM2LIDARR';
    this.apiVer = auth.apiVer || '1.16.1';
  }

  private qs(extra: Record<string, any> = {}): string {
    const u = new URLSearchParams();
    u.set('u', this.auth.user);
    if ('pass' in this.auth) {
      // Subsonic ожидает enc:HEX для пароля, но Navidrome принимает и голый пароль.
      // Используем enc:HEX для совместимости.
      u.set('p', `enc:${Buffer.from(this.auth.pass, 'utf8').toString('hex')}`);
    }
    if ('token' in this.auth) {
      u.set('t', this.auth.token);
      u.set('s', this.auth.salt);
    }
    u.set('v', this.apiVer);
    u.set('c', this.client);
    u.set('f', 'json');
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) u.set(k, String(v));
    }
    return u.toString();
  }

  private async get(path: string, params?: Record<string, any>) {
    const url = `${this.base}/rest/${path}.view?${this.qs(params)}`;
    const t0 = Date.now();
    log.debug('GET start', 'nd.get.start', { path });
    const res = await request(url, { method: 'GET' });
    const text = await res.body.text();
    const dur = Date.now() - t0;

    if (!res.statusCode || res.statusCode >= 400) {
      log.warn('GET http error', 'nd.get.http', { path, status: res.statusCode, dur, preview: text?.slice(0, 180) });
      throw new Error(`Navidrome GET ${path}: ${res.statusCode}`);
    }
    try {
      const json = JSON.parse(text);
      log.debug('GET ok', 'nd.get.ok', { path, dur });
      return json;
    } catch {
      log.warn('GET non-json', 'nd.get.nonjson', { path, dur, size: text?.length || 0 });
      throw new Error(`Navidrome non-json at ${path}`);
    }
  }

  async ping() {
    const r = await this.get('ping');
    return !!r?.['subsonic-response']?.status && r['subsonic-response'].status !== 'failed';
  }

  async getStarred2() {
    const r = await this.get('getStarred2');
    const root = r?.['subsonic-response']?.starred2 || {};
    const artists: Array<{ id: string; name: string }> = root.artist || [];
    const albums: Array<{ id: string; name: string; artist: string }> = root.album || [];
    const songs: Array<{ id: string; title: string; artist: string; album?: string; duration?: number }> = root.song || [];
    return { artists, albums, songs };
  }

  async search2(query: string, count = 5) {
    const r = await this.get('search2', { query, songCount: count, albumCount: count, artistCount: count });
    const root = r?.['subsonic-response']?.searchResult2 || {};
    return {
      artists: (root.artist || []) as Array<{ id: string; name: string }>,
      albums: (root.album || []) as Array<{ id: string; name: string; artist: string }>,
      songs: (root.song || []) as Array<{ id: string; title: string; artist: string; album?: string; duration?: number }>,
    };
  }

  async star(opts: { artistIds?: string[]; albumIds?: string[]; songIds?: string[] }) {
    return this.get('star', {
      id: (opts.songIds || []).join(','),
      albumId: (opts.albumIds || []).join(','),
      artistId: (opts.artistIds || []).join(','),
    });
  }

  async unstar(opts: { artistIds?: string[]; albumIds?: string[]; songIds?: string[] }) {
    return this.get('unstar', {
      id: (opts.songIds || []).join(','),
      albumId: (opts.albumIds || []).join(','),
      artistId: (opts.artistIds || []).join(','),
    });
  }

  // ===== Helpers for ID resolution (used by APPLY, not by PLAN) =====
  async resolveArtistIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const name = k; // artist key = normalized name
      const r = await this.search2(name, 5);
      const found = r.artists.find(a => nkey(a.name) === nkey(name));
      if (found) out.set(k, found.id);
    }
    return out;
  }

  async resolveAlbumIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const [artist, title] = k.split('|||');
      const q = `${artist} ${title}`.trim();
      const r = await this.search2(q, 5);
      const found = r.albums.find(a => nkey(a.artist) === nkey(artist) && nkey(a.name) === nkey(title));
      if (found) out.set(k, found.id);
    }
    return out;
  }

  async resolveSongIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const [artist, title, durStr] = k.split('|||');
      const wantDur = parseInt(durStr || '0', 10) || 0;
      const q = `${artist} ${title}`.trim();
      const r = await this.search2(q, 10);
      const found = r.songs.find(s =>
        nkey(s.artist) === nkey(artist) &&
        nkey(s.title) === nkey(title) &&
        Math.abs((s.duration || 0) - wantDur) <= 2
      );
      if (found) out.set(k, found.id);
    }
    return out;
  }
}
