// apps/api/src/services/yandex.ts
import { request } from 'undici';
import { createLogger } from '../lib/logger';

/**
 * Yandex Music service: pyproxy-only интерфейс + верификация токена.
 * ВАЖНО: yandexPullLikes требует PY (pyproxy URL). Без него — ошибка.
 */

const log = createLogger({ scope: 'service.yandex' });

const BASE = 'https://api.music.yandex.net';

// pyproxy URL может прийти из env, но его можно переопределить настройками:
let PY = (process.env.YA_PYPROXY_URL || '').replace(/\/+$/, '');
export function setPyproxyUrl(url?: string | null) {
  const before = PY;
  PY = (url || PY || '').replace(/\/+$/, '');
  if (before !== PY) {
    log.info('pyproxy url updated', 'ya.pyproxy.update', { hasUrl: !!PY });
  }
}

export function getDriver(settingValue?: string | null): 'pyproxy' | 'native' {
  const v = (settingValue || '').toLowerCase();
  const driver = v === 'native' ? 'native' : 'pyproxy';
  log.debug('choose driver', 'ya.driver.select', { driver, hasPy: !!PY });
  return driver;
}

// "правдоподобные" заголовки для нативных вызовов (нужны только для fallback-проверки токена)
const DEFAULT_UA =
  process.env.YA_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const YM_CLIENT = process.env.YA_CLIENT || 'Windows/6.45.1';

type YAccount = { uid: number; login?: string | null };

function authHeaders(token: string) {
  return {
    Authorization: `OAuth ${token}`,
    'User-Agent': DEFAULT_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ru,en;q=0.9',
    Referer: 'https://music.yandex.ru/',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Yandex-Music-Client': YM_CLIENT,
    Connection: 'keep-alive',
  };
}

async function getJSON(path: string, token: string, searchParams?: Record<string, string>) {
  const startedAt = Date.now();
  const url = new URL(path, BASE);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  }
  log.debug('native GET start', 'ya.native.req.start', { path: url.pathname });
  const res = await request(url, { headers: authHeaders(token) });
  const text = await res.body.text();
  const durMs = Date.now() - startedAt;

  if (res.statusCode === 403) {
    log.warn('native GET smartcaptcha', 'ya.native.req.403', { path: url.pathname, durMs });
    const err: any = new Error('SmartCaptcha');
    err.code = 'SMARTCAPTCHA';
    err.status = 403;
    err.path = url.pathname;
    throw err;
  }
  if (res.statusCode >= 400) {
    log.warn('native GET http error', 'ya.native.req.http', {
      path: url.pathname, status: res.statusCode, durMs, preview: text?.slice(0, 180)
    });
    throw new Error(`YA ${url.pathname} ${res.statusCode}: ${text?.slice(0, 200)}`);
  }

  try {
    const json = JSON.parse(text);
    log.debug('native GET ok', 'ya.native.req.ok', { path: url.pathname, durMs });
    return json;
  } catch {
    log.warn('native GET non-json', 'ya.native.req.nonjson', { path: url.pathname, durMs, size: text?.length || 0 });
    return text ? { result: text } : {};
  }
}

export async function yandexGetAccount(token: string): Promise<YAccount> {
  try {
    log.info('get account start', 'ya.account.start');
    const data: any = await getJSON('/account/status', token);
    const r = data?.result || data;
    const acc = r?.account || r;
    const out = { uid: Number(acc?.uid || 0), login: acc?.login ?? null };
    log.info('get account done', 'ya.account.done', { ok: !!out.uid, hasLogin: !!out.login });
    return out;
  } catch (e: any) {
    log.error('get account failed', 'ya.account.fail', { err: e?.message || String(e) });
    throw e;
  }
}

/**
 * Лайки через PYPROXY.
 * Возвращает нормализованные массивы: артисты и альбомы.
 * Если pyproxy не отдаёт id, оставляем их пустыми — воркер сам поставит плейсхолдер key.
 */
export async function yandexPullLikes(
  token: string,
): Promise<{
  artists: Array<{ id?: number; name: string; mbid?: string | null }>;
  albums: Array<{ id?: number; title: string; artistName: string; year?: number; artistId?: number; rgMbid?: string | null }>;
  // NEW: треки
  tracks: Array<{
    id?: number;
    title: string;
    artistName: string;
    albumTitle?: string;
    durationSec?: number;
    albumId?: number;
    artistId?: number;
    // опциональные поля на будущее для точного матчинга
    recMbid?: string | null;
    rgMbid?: string | null;
  }>;
}> {
  if (!PY) {
    log.error('pyproxy is not configured', 'ya.py.likes.nopy');
    throw new Error('YA pyproxy URL is not configured (set settings.pyproxyUrl or YA_PYPROXY_URL)');
  }

  const startedAt = Date.now();
  try {
    log.info('pyproxy /likes start', 'ya.py.likes.start', { hasPy: !!PY });

    const resp = await request(`${PY}/likes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const status = resp.statusCode || 0;
    let raw: any = null;
    try { raw = await resp.body.json(); }
    catch { raw = null; }

    if (!status || status >= 400) {
      log.warn('pyproxy /likes http error', 'ya.py.likes.http', { status });
      throw new Error(`pyproxy /likes ${status}`);
    }

    const artistsRaw: any[] = Array.isArray(raw?.artists) ? raw.artists : [];
    const albumsRaw: any[] = Array.isArray(raw?.albums) ? raw.albums : [];
    // NEW: разные возможные поля от pyproxy
    const tracksRaw: any[] =
      Array.isArray(raw?.tracks) ? raw.tracks
        : Array.isArray(raw?.songs) ? raw.songs
          : Array.isArray(raw?.likedTracks) ? raw.likedTracks
            : [];

    const artists = artistsRaw
      .map((x) => {
        if (typeof x === 'string') return { name: x } as { id?: number; name: string; mbid?: string | null };
        const id =
          typeof x?.id === 'number'
            ? x.id
            : Number.isFinite(Number(x?.yandexArtistId))
              ? Number(x.yandexArtistId)
              : undefined;
        const name = String(x?.name || '').trim();
        const mbid = typeof x?.mbid === 'string' ? x.mbid : null;
        return { id, name, mbid };
      })
      .filter((a) => a.name);

    const albums = albumsRaw
      .map((x) => {
        const id =
          typeof x?.id === 'number'
            ? x.id
            : Number.isFinite(Number(x?.yandexAlbumId))
              ? Number(x.yandexAlbumId)
              : undefined;
        const title = String(x?.title || '').trim();
        const artistName = String(x?.artistName || x?.artist || '').trim();
        const year =
          typeof x?.year === 'number'
            ? x.year
            : Number.isFinite(Number(x?.releaseYear))
              ? Number(x.releaseYear)
              : undefined;
        const artistId =
          typeof x?.artistId === 'number'
            ? x.artistId
            : Number.isFinite(Number(x?.yandexArtistId))
              ? Number(x.yandexArtistId)
              : undefined;
        const rgMbid = typeof x?.rgMbid === 'string' ? x.rgMbid : null;
        return { id, title, artistName, year, artistId, rgMbid };
      })
      .filter((a) => a.title || a.artistName);

    // нормализация треков
    const tracks = tracksRaw
      .map((x) => {
        const id =
          typeof x?.id === 'number'
            ? x.id
            : Number.isFinite(Number(x?.yandexTrackId))
              ? Number(x.yandexTrackId)
              : Number.isFinite(Number(x?.trackId))
                ? Number(x.trackId)
                : undefined;

        const title = String(x?.title || x?.name || '').trim();
        const artistName = String(x?.artistName || x?.artist || x?.artists?.[0]?.name || '').trim();
        const albumTitle = String(x?.albumTitle || x?.album || x?.release?.title || '').trim();

        const durationSec =
          typeof x?.durationSec === 'number'
            ? x.durationSec
            : Number.isFinite(Number(x?.duration))
              ? Math.round(Number(x.duration))
              : undefined;

        const albumId =
          typeof x?.albumId === 'number'
            ? x.albumId
            : Number.isFinite(Number(x?.yandexAlbumId))
              ? Number(x.yandexAlbumId)
              : Number.isFinite(Number(x?.album?.id))
                ? Number(x.album.id)
                : undefined;

        const artistId =
          typeof x?.artistId === 'number'
            ? x.artistId
            : Number.isFinite(Number(x?.yandexArtistId))
              ? Number(x.yandexArtistId)
              : Number.isFinite(Number(x?.artists?.[0]?.id))
                ? Number(x.artists[0].id)
                : undefined;

        const recMbid = typeof x?.recMbid === 'string' ? x.recMbid : null;
        const rgMbid  = typeof x?.rgMbid  === 'string' ? x.rgMbid  : null;

        return { id, title, artistName, albumTitle, durationSec, albumId, artistId, recMbid, rgMbid };
      })
      .filter((t) => t.title && t.artistName);

    const durMs = Date.now() - startedAt;
    log.info('pyproxy /likes done', 'ya.py.likes.done', {
      artists: artists.length, albums: albums.length, tracks: tracks.length, durMs
    });

    return { artists, albums, tracks };
  } catch (e: any) {
    const durMs = Date.now() - startedAt;
    log.error('pyproxy /likes failed', 'ya.py.likes.fail', { err: e?.message || String(e), durMs });
    throw e;
  }
}

export async function yandexVerifyToken(token: string) {
  if (PY) {
    try {
      log.info('verify via pyproxy start', 'ya.py.verify.start', { hasPy: !!PY });
      const resp = await request(`${PY}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data: any = await resp.body.json();
      const ok = !!data?.ok;
      log.info('verify via pyproxy done', 'ya.py.verify.done', { ok, status: resp.statusCode });
      return data; // { ok, uid, login, ... } или { ok:false, error }
    } catch (e: any) {
      log.error('verify via pyproxy failed', 'ya.py.verify.fail', { err: e?.message || String(e) });
      return { ok: false, error: String(e?.message || e) };
    }
  }
  try {
    log.info('verify via native start', 'ya.native.verify.start');
    const a = await yandexGetAccount(token);
    const ok = !!a.uid;
    log.info('verify via native done', 'ya.native.verify.done', { ok, hasLogin: !!a.login });
    return { ok, uid: a.uid, login: a.login };
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('SmartCaptcha')) {
      log.warn('verify native smartcaptcha', 'ya.native.verify.smartcaptcha');
      return { ok: false, reason: 'smartcaptcha', error: 'SmartCaptcha' };
    }
    log.error('verify via native failed', 'ya.native.verify.fail', { err: msg });
    return { ok: false, error: msg };
  }
}