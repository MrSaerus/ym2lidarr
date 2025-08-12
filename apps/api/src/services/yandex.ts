import { request } from 'undici';

/**
 * Yandex Music service: native HTTP client + optional Python sidecar (pyproxy).
 * - setPyproxyUrl(url) — чтобы менять URL из настроек
 * - getDriver(value)   — нормализует значение 'pyproxy' | 'native'
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

// "правдоподобные" заголовки для нативных вызовов
const DEFAULT_UA =
  process.env.YA_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const YM_CLIENT = process.env.YA_CLIENT || 'Windows/6.45.1';

type YAccount = { uid: number; login?: string | null };
type FullTrack = {
  id: number;
  title?: string;
  durationMs?: number;
  albums?: { title?: string; year?: number; releaseYear?: number }[];
  artists?: { name?: string }[];
};

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
 * Забирает лайки (артисты/альбомы) либо через pyproxy, либо нативно.
 */
export async function yandexPullLikes(
  token: string,
  opts?: { driver?: 'pyproxy' | 'native' },
): Promise<{ artists: string[]; albums: { artist: string; title: string; year?: number }[] }> {
  const driver = (opts?.driver || 'pyproxy') as 'pyproxy' | 'native';

  // Предпочитаем pyproxy, если он доступен и драйвер = pyproxy
  if (driver === 'pyproxy' && PY) {
    const resp = await request(`${PY}/likes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data: any = await resp.body.json();
    if (!resp.statusCode || resp.statusCode >= 400) {
      throw new Error(`pyproxy ${resp.statusCode}`);
    }
    return {
      artists: Array.isArray(data?.artists) ? data.artists : [],
      albums: Array.isArray(data?.albums) ? data.albums : [],
    };
  }

  // --- Нативный путь (может словить SmartCaptcha на некоторых IP/заголовках) ---
  const acc = await yandexGetAccount(token);
  if (!acc.uid) throw new Error('Yandex token invalid or no UID');

  const data: any = await getJSON(`/users/${acc.uid}/likes/tracks`, token);
  const list: any[] = data?.result?.tracks || data?.result?.library?.tracks || data?.result || [];
  const pairs = list
    .map((x: any) => {
      const id = x?.id ?? x?.trackId ?? x?.track?.id;
      const aid = x?.albumId ?? x?.album?.id ?? x?.track?.albumId ?? x?.track?.albums?.[0]?.id;
      if (!id) return null;
      return aid ? `${id}:${aid}` : String(id);
    })
    .filter(Boolean) as string[];

  const batch = 100;
  const full: FullTrack[] = [];
  for (let i = 0; i < pairs.length; i += batch) {
    const chunk = pairs.slice(i, i + batch);
    const tr: any = await getJSON('/tracks', token, { 'track-ids': chunk.join(',') });
    const arr: any[] = Array.isArray(tr?.result) ? tr.result : tr?.result?.tracks || [];
    for (const t of arr) {
      full.push({
        id: Number(t.id),
        title: t.title,
        durationMs: t.durationMs ?? t.duration_ms,
        albums: t.albums,
        artists: t.artists,
      });
    }
  }

  // Уникальные артисты
  const artistsMap = new Map<string, string>();
  for (const t of full) {
    for (const a of t.artists || []) {
      if (a?.name) {
        const k = a.name.trim().toLowerCase();
        if (!artistsMap.has(k)) artistsMap.set(k, a.name.trim());
      }
    }
  }
  const artists = Array.from(artistsMap.values());

  // Уникальные альбомы (по главному артисту + названию)
  const albumMap = new Map<string, { artist: string; title: string; year?: number }>();
  for (const t of full) {
    const mainArtist = t.artists?.[0]?.name || '';
    const alb = t.albums?.[0];
    if (!alb?.title) continue;
    const year = alb.year ?? alb.releaseYear;
    const key = `${mainArtist.trim().toLowerCase()}|||${alb.title.trim().toLowerCase()}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, { artist: mainArtist, title: alb.title, year });
    }
  }
  const albums = Array.from(albumMap.values());

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
      return data; // { ok, uid, login, tracks? } или { ok:false, error }
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
