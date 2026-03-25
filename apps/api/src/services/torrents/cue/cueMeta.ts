// apps/api/src/services/torrents/cue/cueMeta.ts
import { prisma } from '../../../prisma';

export function buildFfmpegMetadataArgs(opts: {
  trackNumber: number;
  totalTracks: number;
  title: string;
  albumTitle?: string | null;
  albumArtist?: string | null;
  year?: number | null;
  genre?: string | null;
}): string[] {
  const args: string[] = [];

  args.push('-metadata', `track=${opts.trackNumber}/${opts.totalTracks}`);
  if (opts.title) args.push('-metadata', `title=${opts.title}`);
  if (opts.albumTitle) args.push('-metadata', `album=${opts.albumTitle}`);
  if (opts.albumArtist) args.push('-metadata', `artist=${opts.albumArtist}`);
  if (opts.year) args.push('-metadata', `date=${opts.year}`);
  if (opts.genre) args.push('-metadata', `genre=${opts.genre}`);

  return args;
}

export async function resolveCueAlbumMeta(
  taskMeta: {
    artistName?: string | null;
    albumTitle?: string | null;
    albumYear?: number | null;
    ymAlbumId?: string | null;
  },
  cueMeta: {
    albumTitle?: string | null;
    albumPerformer?: string | null;
    albumGenre?: string | null;
    albumDate?: string | null;
  },
) {
  let albumTitle: string | null = cueMeta.albumTitle || taskMeta.albumTitle || null;
  let albumArtist: string | null = cueMeta.albumPerformer || taskMeta.artistName || null;
  let year: number | null = taskMeta.albumYear ?? null;
  let genre: string | null = null;

  // 1) Берём из БД по ymAlbumId, если есть
  const ymAlbumId = taskMeta.ymAlbumId?.trim();
  if (ymAlbumId && /^\d+$/.test(ymAlbumId)) {
    const albumDb: any = await prisma.yandexAlbum.findUnique({
      where: { ymId: ymAlbumId },
    });
    if (albumDb) {
      if (!albumTitle && albumDb.title) albumTitle = albumDb.title;
      if (!albumArtist && albumDb.artist) albumArtist = albumDb.artist;
      if (!year && typeof albumDb.year === 'number') year = albumDb.year;

      if (albumDb.genresJson) {
        try {
          const arr = JSON.parse(albumDb.genresJson) as string[];
          if (Array.isArray(arr) && arr.length && !genre) {
            genre = String(arr[0]);
          }
        } catch {
          // игнорируем битый JSON
        }
      }
    }
  }

  // 2) Фоллбек на CUE-genre
  if (!genre && cueMeta.albumGenre) {
    genre = cueMeta.albumGenre;
  }

  // 3) Фоллбек на CUE-date → год
  if (!year && cueMeta.albumDate) {
    const m = /(\d{4})/.exec(cueMeta.albumDate);
    if (m) {
      const y = parseInt(m[1], 10);
      if (Number.isFinite(y)) year = y;
    }
  }

  return { albumTitle, albumArtist, year, genre };
}
