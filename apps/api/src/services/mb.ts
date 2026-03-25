// apps/api/src/services/mb.ts
import Bottleneck from 'bottleneck';
import { request } from 'undici';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'service.mb' });

const limiter = new Bottleneck({
  minTime: 1100,
  maxConcurrent: 1,
});

const BASE = 'https://musicbrainz.org/ws/2';
const UA = 'ym-to-lidarr/1.2 (+contact: you@example.com)';

export type ArtistCandidateMB = {
  externalId: string;
  source: 'mb';
  name: string;
  score?: number;
  disambiguation?: string;
  type?: string;
  country?: string;
  area?: string;
  begin?: string;
  end?: string;
  url?: string;
  highlight?: boolean;
};

export type ReleaseGroupCandidateMB = {
  externalId: string;
  source: 'mb';
  title: string;
  primaryType?: string;
  secondaryTypes?: string[];
  firstReleaseDate?: string;
  primaryArtist?: string;
  score?: number;
  url?: string;
  highlight?: boolean;
};

type MbOpts = { signal?: AbortSignal };

let tlsFailStreak = 0;
let circuitUntilTs = 0;

function jitter(minMs: number, maxMs: number) {
  const a = Math.min(minMs, maxMs);
  const b = Math.max(minMs, maxMs);
  return Math.round(a + Math.random() * (b - a));
}

function isTlsDrop(err: any) {
  const msg = String(err?.message || err);
  return msg.includes('before secure TLS connection was established');
}

function isTransientStatus(code: number) {
  return code === 408 || code === 425 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

function isAbortLike(err: any) {
  const msg = String(err?.message || err);
  return (
    err?.name === 'AbortError' ||
    msg.includes('AbortError') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EAI_AGAIN')
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function retryAfterMs(res: any): number | null {
  const h = res?.headers;
  const ra = (typeof h?.get === 'function' ? h.get('retry-after') : null) as string | null;
  if (!ra) return null;

  const sec = Number(ra);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;

  const dt = Date.parse(ra);
  if (Number.isFinite(dt)) {
    const ms = dt - Date.now();
    return ms > 0 ? ms : 0;
  }

  return null;
}

async function maybeWaitCircuit(url: string, signal?: AbortSignal) {
  const now = Date.now();
  if (circuitUntilTs > now) {
    const waitMs = circuitUntilTs - now;
    log.warn('MB circuit open, waiting', 'mb.http.circuit.wait', { url, waitMs });
    await sleep(waitMs, signal);
  }
}


async function getJSON<T = unknown>(url: string, opts?: MbOpts): Promise<T> {
  const startedAt = Date.now();

  const timeoutMs = 12_000;
  const maxAttempts = 4;
  const baseBackoffMs = 1200;
  const maxNetBackoffMs = 12_000;
  const tlsBackoffMinMs = 15_000;
  const tlsBackoffMaxMs = 60_000;
  const tlsStreakToOpenCircuit = 3;
  const circuitMinMs = 60_000;
  const circuitMaxMs = 180_000;

  await maybeWaitCircuit(url, opts?.signal);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await maybeWaitCircuit(url, opts?.signal);

    const attemptStarted = Date.now();
    log.debug('MB request', 'mb.http.req', { url, attempt, timeoutMs });

    const ac = new AbortController();
    const onOuterAbort = () => ac.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) ac.abort();
      else opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    const t = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await request(url, {
        headers: { 'User-Agent': UA },
        signal: ac.signal,
      });

      const durMs = Date.now() - attemptStarted;

      if (res.statusCode >= 400) {
        const body = await res.body.text().catch(() => '');
        const preview = body?.slice(0, 180);

        log.warn('MB error response', 'mb.http.err', {
          url,
          attempt,
          status: res.statusCode,
          durMs,
          preview,
        });

        if (attempt < maxAttempts && isTransientStatus(res.statusCode)) {
          const raMs = retryAfterMs(res);

          const exp = Math.round(baseBackoffMs * Math.pow(2, attempt - 1) * (0.85 + Math.random() * 0.3));
          const backoff = raMs ?? Math.min(30_000, exp);

          log.warn('MB transient, will retry', 'mb.http.retry', {
            url,
            attempt,
            status: res.statusCode,
            backoffMs: backoff,
            retryAfterMs: raMs ?? undefined,
          });

          await sleep(backoff, ac.signal);
          continue;
        }

        throw new Error(`MB ${url} ${res.statusCode}: ${body}`);
      }

      const data = (await res.body.json()) as unknown as T;

      tlsFailStreak = 0;

      log.debug('MB response ok', 'mb.http.ok', {
        status: res.statusCode,
        durMs,
        attempt,
        totalMs: Date.now() - startedAt,
      });

      return data;
    } catch (e: any) {
      const durMs = Date.now() - attemptStarted;

      // --- TLS DROP branch (separate policy) ---
      if (isTlsDrop(e)) {
        tlsFailStreak++;

        if (tlsFailStreak >= tlsStreakToOpenCircuit) {
          const pauseMs = jitter(circuitMinMs, circuitMaxMs);
          circuitUntilTs = Date.now() + pauseMs;

          log.warn('MB TLS streak -> circuit open', 'mb.http.circuit.open', {
            url,
            tlsFailStreak,
            pauseMs,
          });

          tlsFailStreak = 0;

          await sleep(pauseMs, ac.signal);
        }

        if (attempt < maxAttempts) {
          const backoff = jitter(tlsBackoffMinMs, tlsBackoffMaxMs);

          log.warn('MB TLS drop, will retry with long backoff', 'mb.http.retry.tls', {
            url,
            attempt,
            durMs,
            err: e?.message || String(e),
            backoffMs: backoff,
            tlsFailStreak,
          });

          await sleep(backoff, ac.signal);
          continue;
        }

        log.error('MB TLS drop, giving up', 'mb.http.fail.tls', {
          url,
          attempt,
          durMs,
          totalMs: Date.now() - startedAt,
          err: e?.message || String(e),
        });

        throw e;
      }

      if (attempt < maxAttempts && isAbortLike(e)) {
        const exp = Math.round(baseBackoffMs * Math.pow(2, attempt - 1) * (0.85 + Math.random() * 0.3));
        const backoff = Math.min(maxNetBackoffMs, exp);

        log.warn('MB request failed transient', 'mb.http.fail.transient', {
          url,
          attempt,
          durMs,
          err: e?.message || String(e),
          backoffMs: backoff,
        });

        await sleep(backoff, ac.signal);
        continue;
      }

      log.error('MB request failed', 'mb.http.fail', {
        url,
        attempt,
        durMs,
        totalMs: Date.now() - startedAt,
        err: e?.message || String(e),
      });

      throw e;
    } finally {
      clearTimeout(t);
      if (opts?.signal) opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  throw new Error(`MB request failed after ${maxAttempts} attempts: ${url}`);
}

async function mbJSON<T = unknown>(url: string, opts?: MbOpts): Promise<T> {
  return limiter.schedule(() => getJSON<T>(url, opts));
}

export async function mbGetArtistAlbumsCount(mbid: string, opts?: MbOpts): Promise<number> {
  const url = `${BASE}/release-group?fmt=json&artist=${encodeURIComponent(mbid)}&type=album&limit=1`;
  log.info('MB artist albums count', 'mb.artist.albums.start', { mbid });

  try {
    const raw: any = await mbJSON(url, opts);
    const count = Number(raw['release-group-count'] ?? 0) || 0;
    log.info('MB artist albums count done', 'mb.artist.albums.done', { mbid, count });
    return count;
  } catch (e: any) {
    log.error('MB artist albums count failed', 'mb.artist.albums.fail', { mbid, err: e?.message || String(e) });
    throw e;
  }
}

function pickMedian(values: (string | undefined | null)[]): string | undefined {
  const v = values.filter(Boolean) as string[];
  if (!v.length) return undefined;
  const freq: Record<string, number> = {};
  for (const x of v) freq[x] = (freq[x] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

function stripDiacritics(s: string) {
  try {
    return s.normalize('NFKD').replace(/\p{M}+/gu, '');
  } catch {
    return s;
  }
}

function hasCyrillic(s: string) {
  return /[А-Яа-яЁё]/.test(s);
}

function translitRuToLat(s: string): string {
  const map: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  };
  return s
    .toLowerCase()
    .split('')
    .map(ch => map[ch] ?? ch)
    .join('');
}

function fingerprint(s?: string | null): string {
  const x = stripDiacritics(String(s ?? ''))
    .toLowerCase()
    .replace(/[’'`"]/g, '')
    .replace(/[‐-‒–—−]/g, '-')
    .replace(/[[\]().,:;!/?\\|]+/g, ' ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

  const y = hasCyrillic(x) ? translitRuToLat(x) : x;
  return y.replace(/[^a-z0-9]+/g, '');
}

function similarity(a: string, b: string): number {
  const A = fingerprint(a);
  const B = fingerprint(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;
  if (A === B) return 1;

  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };

  const a2 = bigrams(A);
  const b2 = bigrams(B);

  const m = new Map<string, number>();
  for (const x of a2) m.set(x, (m.get(x) ?? 0) + 1);

  let hit = 0;
  for (const x of b2) {
    const n = m.get(x) ?? 0;
    if (n > 0) {
      hit++;
      m.set(x, n - 1);
    }
  }

  return (2 * hit) / (a2.length + b2.length);
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export async function mbFindArtist(name: string, opts?: MbOpts) {
  const variants = uniq([name, hasCyrillic(name) ? translitRuToLat(name) : '']);

  log.info('MB find artist', 'mb.find.artist.start', { name, variants });

  let raw: any = null;
  let list: any[] = [];
  let usedVariant: string | null = null;

  for (const v of variants) {
    const url = `${BASE}/artist?fmt=json&query=${encodeURIComponent(`artist:"${v}"`)}`;
    try {
      raw = await mbJSON(url, opts);
      list = raw?.artists || [];
      usedVariant = v;
      log.debug('MB artist list', 'mb.find.artist.list', { name, variant: v, count: list.length });
      if (list.length) break;
    } catch (e: any) {
      log.warn('MB artist variant failed', 'mb.find.artist.variant.fail', {
        name,
        variant: v,
        err: e?.message || String(e),
      });
    }
  }

  if (!list.length) {
    return { externalId: null as string | null, candidates: [] as ArtistCandidateMB[], raw };
  }

  const qfp = fingerprint(name);

  const ranked: any[] = list
    .slice(0, 50)
    .map((a: any) => {
      const an = String(a?.name ?? '');
      const afp = fingerprint(an);

      const fpEq = !!qfp && !!afp && qfp === afp;
      const sim = similarity(name, an);
      const mbScore = Number(a.score) || 0;

      const boost = (fpEq ? 10_000 : 0) + (sim >= 0.92 ? 2_000 : sim >= 0.85 ? 800 : 0);
      return { a, __rank: boost + mbScore };
    })
    .sort((x, y) => y.__rank - x.__rank)
    .map(x => x.a);

  const hit = ranked[0];

  const candidates: ArtistCandidateMB[] = ranked.slice(0, 3).map((a: any): ArtistCandidateMB => {
    const life = a['life-span'] || {};
    return {
      externalId: a.id,
      source: 'mb',
      name: a.name,
      score: a.score,
      disambiguation: a.disambiguation,
      type: a.type,
      country: a.country,
      area: a.area?.name,
      begin: life.begin,
      end: life.end,
      url: a.id ? `https://musicbrainz.org/artist/${a.id}` : undefined,
    };
  });

  const typeMed = pickMedian(candidates.map(c => c.type));
  const countryMed = pickMedian(candidates.map(c => c.country));

  candidates.forEach((c) => {
    const fpEq = fingerprint(c.name) === qfp;
    c.highlight = fpEq || ((!!typeMed && c.type === typeMed) || (!!countryMed && c.country === countryMed));
  });

  log.info('MB find artist done', 'mb.find.artist.done', {
    name,
    usedVariant,
    candidates: candidates.length,
    externalId: hit?.id ?? null,
    top: {
      name: hit?.name,
      score: hit?.score,
      sim: hit?.name ? similarity(name, hit.name) : undefined,
    },
  });

  return { externalId: hit?.id ?? null, candidates, raw };
}

export async function mbFindReleaseGroup(artist: string, title: string, opts?: MbOpts) {
  const artistVariants = uniq([artist, hasCyrillic(artist) ? translitRuToLat(artist) : '']);
  const titleVariants = uniq([title, hasCyrillic(title) ? translitRuToLat(title) : '']);

  log.info('MB find release-group', 'mb.find.rg.start', {
    artist,
    title,
    artistVariants,
    titleVariants,
  });

  let raw: any = null;
  let list: any[] = [];
  let used: { artist: string; title: string } | null = null;

  const primaryArtist = (rg: any) => {
    const ac = rg?.['artist-credit'] || [];
    if (ac && typeof ac[0] === 'object') return (ac[0].name || ac[0].artist?.name || '').trim();
    return '';
  };

  const titleFp = fingerprint(title);
  const artistFp = fingerprint(artist);

  for (const a of artistVariants) {
    for (const t of titleVariants) {
      const q = `releasegroup:"${t}" AND artist:"${a}"`;
      const url = `${BASE}/release-group?fmt=json&query=${encodeURIComponent(q)}`;

      try {
        raw = await mbJSON(url, opts);
        list = raw?.['release-groups'] || [];
        used = { artist: a, title: t };

        log.debug('MB release-group list', 'mb.find.rg.list', {
          artist,
          title,
          variantArtist: a,
          variantTitle: t,
          count: list.length,
        });

        if (list.length) break;
      } catch (e: any) {
        log.warn('MB release-group variant failed', 'mb.find.rg.variant.fail', {
          artist,
          title,
          variantArtist: a,
          variantTitle: t,
          err: e?.message || String(e),
        });
      }
    }
    if (list.length) break;
  }

  if (!list.length) {
    return { externalId: null as string | null, candidates: [] as ReleaseGroupCandidateMB[], raw };
  }

  const ranked: any[] = list
    .slice(0, 50)
    .map((rg: any) => {
      const rgTitle = String(rg?.title ?? '');
      const rgArtist = primaryArtist(rg);

      const tFpEq = !!titleFp && fingerprint(rgTitle) === titleFp;
      const aFpEq = !!artistFp && fingerprint(rgArtist) === artistFp;

      const tSim = similarity(title, rgTitle);
      const aSim = similarity(artist, rgArtist);

      const mbScore = Number(rg?.score) || 0;

      const boost =
        (tFpEq ? 10_000 : 0) +
        (aFpEq ? 3_000 : 0) +
        (tSim >= 0.92 ? 1_500 : tSim >= 0.85 ? 600 : 0) +
        (aSim >= 0.92 ? 500 : aSim >= 0.85 ? 200 : 0);

      return { rg, __rank: boost + mbScore };
    })
    .sort((x, y) => y.__rank - x.__rank)
    .map(x => x.rg);

  const hit = ranked[0];

  const candidates: ReleaseGroupCandidateMB[] = ranked.slice(0, 3).map((rg: any): ReleaseGroupCandidateMB => ({
    externalId: rg.id,
    source: 'mb',
    title: rg.title,
    primaryType: rg['primary-type'],
    secondaryTypes: rg['secondary-types'],
    firstReleaseDate: rg['first-release-date'],
    primaryArtist: primaryArtist(rg),
    score: rg.score,
    url: rg.id ? `https://musicbrainz.org/release-group/${rg.id}` : undefined,
  }));

  const typeMed = pickMedian(candidates.map(c => c.primaryType));

  candidates.forEach((c) => {
    const fpTitleEq = fingerprint(c.title) === titleFp;
    const fpArtistEq = fingerprint(c.primaryArtist || '') === artistFp;

    c.highlight =
      fpTitleEq ||
      (fpArtistEq && similarity(title, c.title) >= 0.85) ||
      (!!typeMed && c.primaryType === typeMed);
  });

  log.info('MB find release-group done', 'mb.find.rg.done', {
    artist,
    title,
    usedVariant: used,
    candidates: candidates.length,
    externalId: hit?.id ?? null,
    top: {
      title: hit?.title,
      artist: primaryArtist(hit),
      score: hit?.score,
      titleSim: hit?.title ? similarity(title, hit.title) : undefined,
      artistSim: primaryArtist(hit) ? similarity(artist, primaryArtist(hit)) : undefined,
    },
  });

  return { externalId: hit?.id ?? null, candidates, raw };
}

export async function searchArtistMB(name: string): Promise<{ id: string; name: string } | null> {
  try {
    const res = await mbFindArtist(name);
    const out = res.externalId ? { id: res.externalId, name } : null;
    log.info('MB searchArtistMB', 'mb.searchArtistMB', { name, hit: !!out });
    return out;
  } catch (e: any) {
    log.error('MB searchArtistMB failed', 'mb.searchArtistMB.fail', { name, err: e?.message || String(e) });
    throw e;
  }
}
