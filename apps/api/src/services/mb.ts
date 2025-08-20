// apps/api/src/services/mb.ts
import Bottleneck from 'bottleneck';
import { request } from 'undici';

const limiter = new Bottleneck({ minTime: 1100 }); // ~1 req/sec
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

async function getJSON<T = unknown>(url: string): Promise<T> {
  const res = await request(url, { headers: { 'User-Agent': UA } });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`MB ${url} ${res.statusCode}: ${body}`);
  }
  // undici's .json() is typed as unknown — cast at the boundary
  const data = (await res.body.json()) as unknown as T;
  return data;
}

function norm(s?: string) {
  return (s || '').trim().toLowerCase();
}

function pickMedian(values: (string | undefined | null)[]): string | undefined {
  const v = values.filter(Boolean) as string[];
  if (!v.length) return undefined;
  const freq: Record<string, number> = {};
  for (const x of v) freq[x] = (freq[x] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Поиск артиста в MusicBrainz.
 * Возвращает { externalId, candidates, raw }, где candidates имеют поля source/externalId.
 */
export const mbFindArtist = limiter.wrap(async (name: string) => {
  const url = `${BASE}/artist?fmt=json&query=${encodeURIComponent(`artist:"${name}"`)}`;
  const raw: any = await getJSON(url);
  const list: any[] = raw?.artists || [];
  if (!list.length)
    return { externalId: null as string | null, candidates: [] as ArtistCandidateMB[], raw };

  const exact = list.filter((a: any) => norm(a.name) === norm(name));
  const ranked: any[] = exact
      .concat(list.filter((a: any) => !exact.includes(a)))
      .slice(0, 50)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

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

  const typeMed = pickMedian(candidates.map((c) => c.type));
  const countryMed = pickMedian(candidates.map((c) => c.country));
  candidates.forEach((c) => {
    c.highlight = (!!typeMed && c.type === typeMed) || (!!countryMed && c.country === countryMed);
  });

  return { externalId: hit?.id ?? null, candidates, raw };
});

/**
 * Поиск release-group (альбома) по артисту и названию.
 * Возвращает { externalId, candidates, raw }, где candidates имеют поля source/externalId.
 */
export const mbFindReleaseGroup = limiter.wrap(async (artist: string, title: string) => {
  const q = `releasegroup:"${title}" AND artist:"${artist}"`;
  const url = `${BASE}/release-group?fmt=json&query=${encodeURIComponent(q)}`;
  const raw: any = await getJSON(url);
  const list: any[] = raw?.['release-groups'] || [];
  if (!list.length)
    return { externalId: null as string | null, candidates: [] as ReleaseGroupCandidateMB[], raw };

  const clean = (s: string) =>
      (s || '')
          .replace(/\s*[([].*?[)\]]\s*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

  const primaryArtist = (rg: any) => {
    const ac = rg['artist-credit'] || [];
    if (ac && typeof ac[0] === 'object') return (ac[0].name || ac[0].artist?.name || '').trim();
    return '';
  };

  const exact = list.filter(
      (rg: any) => clean(rg.title) === clean(title) && norm(primaryArtist(rg)) === norm(artist),
  );
  const ranked: any[] = exact
      .concat(list.filter((rg: any) => !exact.includes(rg)))
      .slice(0, 50)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  const hit = ranked[0];

  const candidates: ReleaseGroupCandidateMB[] = ranked.slice(0, 3).map(
      (rg: any): ReleaseGroupCandidateMB => ({
        externalId: rg.id,
        source: 'mb',
        title: rg.title,
        primaryType: rg['primary-type'],
        secondaryTypes: rg['secondary-types'],
        firstReleaseDate: rg['first-release-date'],
        primaryArtist: primaryArtist(rg),
        score: rg.score,
        url: rg.id ? `https://musicbrainz.org/release-group/${rg.id}` : undefined,
      }),
  );

  const typeMed = pickMedian(candidates.map((c) => c.primaryType));
  candidates.forEach((c) => {
    c.highlight =
        (!!typeMed && c.primaryType === typeMed) || norm(c.primaryArtist) === norm(artist);
  });

  return { externalId: hit?.id ?? null, candidates, raw };
});
