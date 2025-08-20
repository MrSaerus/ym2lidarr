// apps/api/src/services/yandex.ts
import { request } from 'undici';

/**
 * Yandex Music service: pyproxy-only интерфейс + верификация токена.
 * ВАЖНО: yandexPullLikes требует PY (pyproxy URL). Без него — ошибка.
 */

const BASE = 'https://api.music.yandex.net';

// pyproxy URL может прийти из env, но его можно переопределить настройками:
let PY = (process.env.YA_PYPROXY_URL || '').replace(/\/+$/, '');
export function setPyproxyUrl(url?: string | null) {
  PY = (url || PY || '').replace(/\/+$/, '');
}

export function getDriver(settingValue?: string | null): 'pyproxy' | 'native' {
  const v = (settingValue || '').toLowerCase();
  return v === 'native' ? 'native' : 'pyproxy';
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
  const url = new URL(path, BASE);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  }
  const res = await request(url, { headers: authHeaders(token) });
  const text = await res.body.text();

  if (res.statusCode === 403) {
    const err: any = new Error('SmartCaptcha');
    err.code = 'SMARTCAPTCHA';
    err.status = 403;
    err.path = url.pathname;
    throw err;
  }
  if (res.statusCode >= 400) {
    throw new Error(`YA ${url.pathname} ${res.statusCode}: ${text?.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text ? { result: text } : {};
  }
}

export async function yandexGetAccount(token: string): Promise<YAccount> {
  const data: any = await getJSON('/account/status', token);
  const r = data?.result || data;
  const acc = r?.account || r;
  return { uid: Number(acc?.uid || 0), login: acc?.login ?? null };
}

/**
 * Лайки через PYPROXY.
 * Возвращает нормализованные массивы: артисты и альбомы.
 * Если pyproxy не отдаёт id, оставляем их пустыми — воркер сам поставит плейсхолдер key.
 */
export async function yandexPullLikes(
    token: string,
    _opts?: { driver?: 'pyproxy' | 'native' },
): Promise<{
  artists: Array<{ id?: number; name: string; mbid?: string | null }>;
  albums: Array<{ id?: number; title: string; artistName: string; year?: number; artistId?: number; rgMbid?: string | null }>;
}> {
  if (!PY) {
    throw new Error('YA pyproxy URL is not configured (set settings.pyproxyUrl or YA_PYPROXY_URL)');
  }

  const resp = await request(`${PY}/likes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const raw: any = await resp.body.json();
  if (!resp.statusCode || resp.statusCode >= 400) {
    throw new Error(`pyproxy /likes ${resp.statusCode}`);
  }

  const artistsRaw: any[] = Array.isArray(raw?.artists) ? raw.artists : [];
  const albumsRaw: any[] = Array.isArray(raw?.albums) ? raw.albums : [];

  const artists = artistsRaw
      .map((x) => {
        if (typeof x === 'string') {
          return { name: x } as { id?: number; name: string; mbid?: string | null };
        }
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

  return { artists, albums };
}

/**
 * Проверка токена — через pyproxy, если он есть; иначе нативно.
 */
export async function yandexVerifyToken(token: string) {
  if (PY) {
    try {
      const resp = await request(`${PY}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data: any = await resp.body.json();
      return data; // { ok, uid, login, ... } или { ok:false, error }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
  try {
    const a = await yandexGetAccount(token);
    return { ok: !!a.uid, uid: a.uid, login: a.login };
  } catch (e: any) {
    if (String(e?.message || e).includes('SmartCaptcha')) {
      return { ok: false, reason: 'smartcaptcha', error: 'SmartCaptcha' };
    }
    return { ok: false, error: String(e?.message || e) };
  }
}
