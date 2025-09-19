// apps/api/src/services/navidrome.ts
import { request } from 'undici';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'service.navidrome' });

export type NdAuth =
  | { user: string; pass: string; client?: string; apiVer?: string }
  | { user: string; token: string; salt: string; client?: string; apiVer?: string };

function stripTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s.charCodeAt(i - 1) === 47 /* '/' */) i--;
  return i === s.length ? s : s.slice(0, i);
}

function collapseWhitespace(src: string): string {
  let out = '';
  let inWs = false;
  for (const ch of src) {
    const isWs = ch.trim() === '';
    if (isWs) {
      if (!inWs && out.length > 0) out += ' ';
      inWs = true;
    } else {
      out += ch;
      inWs = false;
    }
  }
  return out.trim();
}

// Нормализуем ключ для "мягких" сравнений: lowerCase + схлопывание пробелов
function nkey(s: string) {
  return collapseWhitespace((s || '').toLowerCase());
}

export class NavidromeClient {
  private base: string;
  private auth: NdAuth;
  private client: string;
  private apiVer: string;
  private authPass?: string;

  constructor(baseUrl: string, auth: NdAuth, authPass?: string) {
    this.base = stripTrailingSlashes(baseUrl || '');
    this.auth = auth;
    this.client = auth.client || 'YM2LIDARR';
    this.apiVer = auth.apiVer || '1.16.1';
    this.authPass = authPass;
  }

  /** Базовые auth-параметры, чтобы можно было APPEND тех же ключей много раз */
  private authParams(): URLSearchParams {
    const u = new URLSearchParams();
    u.set('u', this.auth.user);
    if ('pass' in this.auth) {
      u.set('p', `enc:${Buffer.from(this.auth.pass, 'utf8').toString('hex')}`);
    }
    if ('token' in this.auth) {
      u.set('t', this.auth.token);
      u.set('s', this.auth.salt);
    }
    u.set('v', this.apiVer);
    u.set('c', this.client);
    u.set('f', 'json');
    return u;
  }

  private urlFor(path: string, params: URLSearchParams) {
    return `${this.base}/rest/${path}.view?${params.toString()}`;
  }

  /** Универсальный GET: принимает либо Record, либо уже собранный URLSearchParams */
  private async get(path: string, params?: Record<string, any> | URLSearchParams) {
    let q: URLSearchParams;
    if (params instanceof URLSearchParams) {
      q = params;
    } else {
      q = this.authParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) q.set(k, String(v));
        }
      }
    }

    const url = this.urlFor(path, q);
    const t0 = Date.now();
    log.debug('GET start', 'nd.get.start', { path, urlPreview: url.slice(0, 180) });
    const res = await request(url, { method: 'GET' });
    const text = await res.body.text();
    const dur = Date.now() - t0;

    if (!res.statusCode || res.statusCode >= 400) {
      log.warn('GET http error', 'nd.get.http', { path, status: res.statusCode, dur, preview: text?.slice(0, 180) });
      throw new Error(`Navidrome GET ${path}: ${res.statusCode}`);
    }
    try {
      const json = JSON.parse(text);
      const status = json?.['subsonic-response']?.status;
      log.debug('GET ok', 'nd.get.ok', { path, dur, status });
      return json;
    } catch {
      log.warn('GET non-json', 'nd.get.nonjson', { path, dur, size: text?.length || 0 });
      throw new Error(`Navidrome non-json at ${path}`);
    }
  }

  async ensureAuthHealthy() {
    const r = await this.get('ping');
    const ok = !!r?.['subsonic-response']?.status && r['subsonic-response'].status !== 'failed';
    if (!ok) throw new Error('Navidrome auth failed');
    log.info('Navidrome auth OK', 'nd.auth.ok', { via: ('pass' in this.auth) ? 'pass' : 'token' });
  }

  async ping() {
    const r = await this.get('ping');
    return !!r?.['subsonic-response']?.status && r['subsonic-response'].status !== 'failed';
  }

  async pingInfo(): Promise<{ ok: boolean; server?: string; type?: string; version?: string; serverVersion?: string }> {
    const r = await this.get('ping');
    const sr = r?.['subsonic-response'] || {};
    const ok = !!sr?.status && sr.status !== 'failed';
    const type = sr?.type || undefined;
    const version = sr?.version || undefined;
    const serverVersion = sr?.serverVersion || undefined;
    const server =
      (type && serverVersion) ? `${type} ${serverVersion}` :
        (type && version)       ? `${type} ${version}` :
          (type || version || undefined);

    return { ok, server, type, version, serverVersion };
  }

  async getStarred2() {
    const r = await this.get('getStarred2');
    const root = r?.['subsonic-response']?.starred2 || {};
    const artists: Array<{ id: string; name: string }> = root.artist || [];
    const albums: Array<{ id: string; name: string; artist: string }> = root.album || [];
    const songs: Array<{ id: string; title: string; artist: string; album?: string; duration?: number }> = root.song || [];
    return { artists, albums, songs };
  }

  // --- Метаданные по ID (для красивых логов) ---
  async getSong(id: string) {
    const r = await this.get('getSong', { id });
    return r?.['subsonic-response']?.song;
  }
  async getAlbum(id: string) {
    const r = await this.get('getAlbum', { id });
    return r?.['subsonic-response']?.album;
  }
  async getArtist(id: string) {
    const r = await this.get('getArtist', { id });
    return r?.['subsonic-response']?.artist;
  }

  // Чуть увеличим выборку — резолв будет устойчивее
  async search2(query: string, count = 100) {
    const r = await this.get('search2', { query, songCount: count, albumCount: count, artistCount: count });
    const root = r?.['subsonic-response']?.searchResult2 || {};
    return {
      artists: (root.artist || []) as Array<{ id: string; name: string }>,
      albums: (root.album || []) as Array<{ id: string; name: string; artist: string }>,
      songs: (root.song || []) as Array<{ id: string; title: string; artist: string; album?: string; duration?: number }>,
    };
  }

  /**
   * ВАЖНО: несколько ID должны передаваться повторяющимися параметрами,
   * а НЕ строкой через запятую (`id=a&id=b`, а не `id=a,b`).
   */
  async star(opts: { artistIds?: string[]; albumIds?: string[]; songIds?: string[] }) {
    const p = this.authParams();
    for (const id of opts.songIds || [])   p.append('id', id);
    for (const id of opts.albumIds || [])  p.append('albumId', id);
    for (const id of opts.artistIds || []) p.append('artistId', id);
    if (![...(opts.songIds||[]), ...(opts.albumIds||[]), ...(opts.artistIds||[])].length) {
      log.debug('Star noop (empty ids)', 'nd.star.noop');
      return { ok: true };
    }
    log.info('Star request', 'nd.star', {
      songs: opts.songIds?.length || 0,
      albums: opts.albumIds?.length || 0,
      artists: opts.artistIds?.length || 0,
    });
    return this.get('star', p);
  }

  async unstar(opts: { artistIds?: string[]; albumIds?: string[]; songIds?: string[] }) {
    const p = this.authParams();
    for (const id of opts.songIds || [])   p.append('id', id);
    for (const id of opts.albumIds || [])  p.append('albumId', id);
    for (const id of opts.artistIds || []) p.append('artistId', id);
    if (![...(opts.songIds||[]), ...(opts.albumIds||[]), ...(opts.artistIds||[])].length) {
      log.debug('Unstar noop (empty ids)', 'nd.unstar.noop');
      return { ok: true };
    }
    log.info('Unstar request', 'nd.unstar', {
      songs: opts.songIds?.length || 0,
      albums: opts.albumIds?.length || 0,
      artists: opts.artistIds?.length || 0,
    });
    return this.get('unstar', p);
  }

  // ===== Улучшенный резолв с «мягкими» правилами совпадения =====
  private eq(a: string, b: string) { return nkey(a) === nkey(b); }
  private incl(needle: string, hay: string) { const n = nkey(needle); const h = nkey(hay); return !!n && h.includes(n); }
  private matchish(a: string, b: string) {
    const A = nkey(a), B = nkey(b);
    if (!A || !B) return false;
    return A === B || A.includes(B) || B.includes(A);
  }

  async resolveArtistIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const name = k;
      log.info('Resolve artist', 'nd.resolve.artist', { want: { name } });
      const r = await this.search2(name, 100);
      let found = r.artists.find(a => this.matchish(a.name, name));
      if (!found) found = r.artists.find(a => this.incl(name, a.name));
      log.debug('Resolve artist candidates', 'nd.resolve.artist.candidates', {
        want: { name }, total: r.artists.length,
        matched: found ? 1 : 0,
        sample: r.artists.slice(0, 5).map(a => ({ id: a.id, name: a.name })),
      });
      if (found) {
        out.set(k, found.id);
        log.info('Artist resolved', 'nd.resolve.artist.ok', { want: { name }, id: found.id });
      } else {
        log.warn('Artist not found', 'nd.resolve.artist.none', { want: { name } });
      }
    }
    return out;
  }

  async resolveAlbumIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const [artist, title] = k.split('|||');
      const q = `${artist} ${title}`.trim();
      log.info('Resolve album', 'nd.resolve.album', { want: { artist, title } });
      const r = await this.search2(q, 100);
      let found = r.albums.find(a => this.matchish(a.artist, artist) && this.matchish(a.name, title));
      if (!found) found = r.albums.find(a => this.incl(artist, a.artist) && this.incl(title, a.name));
      log.debug('Resolve album candidates', 'nd.resolve.album.candidates', {
        want: { artist, title }, total: r.albums.length,
        matched: found ? 1 : 0,
        sample: r.albums.slice(0, 5).map(a => ({ id: a.id, name: a.name, artist: a.artist })),
      });
      if (found) {
        out.set(k, found.id);
        log.info('Album resolved', 'nd.resolve.album.ok', { want: { artist, title }, id: found.id });
      } else {
        log.warn('Album not found', 'nd.resolve.album.none', { want: { artist, title } });
      }
    }
    return out;
  }

  async resolveSongIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const k of keys) {
      const [artist, title, durStr] = k.split('|||');
      const wantDur = parseInt(durStr || '0', 10) || 0;
      const q = `${artist} ${title}`.trim();

      log.info('Resolve song', 'nd.resolve.song', { want: { artist, title, wantDur: wantDur || undefined } });

      const r = await this.search2(q, 100);

      const cand = r.songs.filter(s =>
        this.matchish(s.artist, artist) && this.matchish(s.title, title)
      );

      log.debug('Resolve song candidates', 'nd.resolve.song.candidates', {
        want: { artist, title },
        total: r.songs.length,
        matched: cand.length,
        sample: r.songs.slice(0, 5).map(s => ({ id: s.id, artist: s.artist, title: s.title, duration: s.duration })),
      });

      if (!cand.length) {
        log.warn('Song not found', 'nd.resolve.song.none', { want: { artist, title } });
        continue;
      }

      if (wantDur <= 0) {
        out.set(k, cand[0].id);
        log.info('Song resolved (no duration)', 'nd.resolve.song.ok.nodur', {
          want: { artist, title }, chosen: { id: cand[0].id, artist: cand[0].artist, title: cand[0].title, duration: cand[0].duration }
        });
        continue;
      }

      const best = cand
        .map(s => ({ s, diff: Math.abs((s.duration || 0) - wantDur) }))
        .sort((a, b) => a.diff - b.diff)[0];

      const tol = Math.max(10, Math.round(wantDur * 0.1)); // 10 сек или 10%
      if (best && best.diff <= tol) {
        out.set(k, best.s.id);
        log.info('Song resolved (duration match)', 'nd.resolve.song.ok', {
          want: { artist, title, wantDur }, chosen: { id: best.s.id, duration: best.s.duration, diff: best.diff, tol }
        });
      } else {
        // фолбэк: берём текстово-подходящий вариант
        out.set(k, cand[0].id);
        log.info('Song resolved (fallback first)', 'nd.resolve.song.ok.fallback', {
          want: { artist, title, wantDur }, chosen: { id: cand[0].id, duration: cand[0].duration }
        });
      }
    }
    return out;
  }
}
