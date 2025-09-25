// apps/api/src/services/yandex_unmatched.ts
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { createTask } from './torrents';

const log = createLogger({ scope: 'service.yandex-unmatched' });

type PlannedLike = {
  likeId: number;
  kind: 'album'|'track'|'artist';
  ymAlbumId?: string|null;
  ymTrackId?: string|null;
  ymArtistId?: string|null;
  artistName?: string|null;
  albumTitle?: string|null;
  albumYear?: number|null;
  query: string;
};

function sanitize(s?: string|null) {
  return (s ?? '').replace(/\s+/g,' ').trim();
}

function buildQueryFromLike(row: PlannedLike): string {
  // приоритет: Альбом: "Artist - Album (Year)"; Трек: "Artist - Title"; Артист: "Artist"
  const artist = sanitize(row.artistName);
  if (row.kind === 'album') {
    const album = sanitize(row.albumTitle);
    const year  = row.albumYear ? ` (${row.albumYear})` : '';
    if (artist && album) return `${artist} - ${album}${year}`;
    if (album) return album + year;
  }
  if (row.kind === 'track') {
    // на треке у нас обычно нет year на уровне лайка — тащим только "Artist - Title"
    const title = sanitize(row.albumTitle /* переиспользуем как title в запросе? лучше будем передавать явно */) || sanitize(row.query);
    if (artist && title) return `${artist} - ${title}`;
    if (title) return title;
  }
  // artist
  if (artist) return artist;
  // fallback
  return row.query || 'music';
}

function makeTaskKeyLikeAware(p: PlannedLike): string {
  // уникальность + идемпотентность для одного лайка:
  // taskKey = scope|artist|album|year|ymArtistId|ymAlbumId|ymTrackId
  const parts: string[] = [p.kind];
  const push = (v?: string|null|number) => {
    const s = (v==null ? '' : String(v)).toLowerCase().trim();
    if (s) parts.push(s);
  };
  push(p.artistName);
  if (p.kind === 'album') {
    push(p.albumTitle);
    push(p.albumYear ?? '');
  }
  push(p.ymArtistId);
  push(p.ymAlbumId);
  push(p.ymTrackId);
  return parts.join('|');
}

async function likeAlreadyPlannedOrDone(kind: string, ymId?: string|null) {
  if (!ymId) return false;
  // если есть уже planned/fulfilled по этому ymId — пропустим
  const row = await prisma.yandexLikeSync.findFirst({
    where: { kind, ymId, status: { in: ['planned','fulfilled'] } as any },
    select: { id: true },
  });
  return !!row;
}

export async function planUnmatchedLikes(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 100;

  // 1) соберём кандидатов без MBID
  //    - album: YandexAlbum.rgMbid IS NULL
  //    - track: YandexTrack.recMbid IS NULL AND rgMbid IS NULL
  //    - artist: YandexArtist.mbid IS NULL
  //
  // берём только лайки со статусом 'pending' (ещё не планировали)
  // и актуальные (present = true) записи.

  // альбомы
  const albums = await prisma.yandexLikeSync.findMany({
    where: { kind: 'album', status: 'pending' },
    take: limit,
    orderBy: { firstSeenAt: 'asc' },
    include: {
      // Прямой связи с YandexAlbum по ymId нет — ищем вручную
    } as any,
  });

  // треки
  const tracks = await prisma.yandexLikeSync.findMany({
    where: { kind: 'track', status: 'pending' },
    take: limit,
    orderBy: { firstSeenAt: 'asc' },
  });

  // артисты
  const artists = await prisma.yandexLikeSync.findMany({
    where: { kind: 'artist', status: 'pending' },
    take: limit,
    orderBy: { firstSeenAt: 'asc' },
  });

  const planned: Array<{ likeId: number; taskId: number }> = [];
  let checked = 0, skipped = 0, created = 0;

  // вспомогатели для подгрузки карточек
  async function fetchAlbum(ymId: string) {
    return prisma.yandexAlbum.findFirst({ where: { ymId } });
  }
  async function fetchTrack(ymId: string) {
    return prisma.yandexTrack.findFirst({ where: { ymId } });
  }
  async function fetchArtist(ymId: string) {
    return prisma.yandexArtist.findFirst({ where: { ymId } });
  }

  // универсальный планировщик
  async function planOne(input: PlannedLike, source: 'like:album'|'like:track'|'like:artist', likeId: number) {
    checked++;

    // идемпотентность на уровне лайков
    if (await likeAlreadyPlannedOrDone(input.kind, input.ymAlbumId || input.ymTrackId || input.ymArtistId)) {
      skipped++;
      return;
    }

    const taskKey = makeTaskKeyLikeAware(input);
    // есть ли активная задача с таким ключом?
    const activeStatuses = ['queued','searching','found','added','downloading','moving'] as const;
    const existing = await prisma.torrentTask.findFirst({
      where: { taskKey, status: { in: activeStatuses as any } },
      select: { id: true },
    });
    if (existing) {
      // просто отметим лайк как planned (без создания новой задачи)
      await prisma.yandexLikeSync.update({
        where: { id: likeId },
        data: { status: 'planned', starPlannedAt: new Date(), lastError: null },
      });
      skipped++;
      return;
    }

    const query = buildQueryFromLike(input);

    // создаём TorrentTask (через any, чтобы не упираться в статтипы при наличии/отсутствии ym* полей)
    const data: any = {
      scope: input.kind === 'album' ? 'album' : (input.kind === 'artist' ? 'artist' : 'custom'),
      status: 'queued',
      query,
      movePolicy: 'replace',
      scheduledAt: null,
      taskKey,
      // богаче контекст для копирования/путей:
      artistName: input.artistName ?? null,
      albumTitle: input.albumTitle ?? null,
      albumYear: input.albumYear ?? null,
      source: 'yandex',
    };

    // свяжем с Яндекс-объектами (если эти поля добавлены миграцией)
    if ('ymArtistId' in (prisma as any)._dmmf.datamodel.models.find((m:any)=>m.name==='TorrentTask')?.fields?.reduce((acc:any,f:any)=> (acc[f.name]=true,acc),{})) {
      if (input.ymArtistId) data.ymArtistId = input.ymArtistId;
      if (input.ymAlbumId)  data.ymAlbumId  = input.ymAlbumId;
      if (input.ymTrackId)  data.ymTrackId  = input.ymTrackId;
    }

    const createdTask = await prisma.torrentTask.create({ data });
    await prisma.yandexLikeSync.update({
      where: { id: likeId },
      data: { status: 'planned', starPlannedAt: new Date(), lastError: null },
    });

    created++;
    planned.push({ likeId, taskId: createdTask.id });
  }

  // Планируем альбомы без MBID
  for (const l of albums) {
    if (!l.ymId) { skipped++; continue; }
    const a = await fetchAlbum(l.ymId);
    if (!a || a.rgMbid) { skipped++; continue; } // есть MBID — нам сюда не надо
    await planOne({
      likeId: l.id,
      kind: 'album',
      ymAlbumId: a.ymId,
      ymArtistId: a.yandexArtistId || null,
      albumTitle: a.title,
      albumYear: a.year ?? null,
      artistName: a.artist ?? null,
      query: `${a.artist ?? ''} - ${a.title ?? ''}`
    } as any, 'like:album', l.id);
  }

  // Планируем треки без MBID
  for (const l of tracks) {
    if (!l.ymId) { skipped++; continue; }
    const t = await fetchTrack(l.ymId);
    if (!t || t.recMbid || t.rgMbid) { skipped++; continue; }
    await planOne({
      likeId: l.id,
      kind: 'track',
      ymTrackId: t.ymId,
      ymArtistId: t.ymArtistId || null,
      ymAlbumId: t.ymAlbumId || null,
      artistName: t.artist ?? null,
      albumTitle: t.title ?? null,        // здесь в поле albumTitle пойдёт Title трека — дальше в buildQuery это учитываем
      albumYear: null,
      query: `${t.artist ?? ''} - ${t.title ?? ''}`
    } as any, 'like:track', l.id);
  }

  // Планируем артистов без MBID
  for (const l of artists) {
    if (!l.ymId) { skipped++; continue; }
    const a = await fetchArtist(l.ymId);
    if (!a || a.mbid) { skipped++; continue; }
    await planOne({
      likeId: l.id,
      kind: 'artist',
      ymArtistId: a.ymId,
      artistName: a.name,
      albumTitle: null,
      albumYear: null,
      query: `${a.name ?? ''}`
    } as any, 'like:artist', l.id);
  }

  log.info('planner finished', 'yandex.unmatched.plan.done', { checked, created, skipped });
  return { ok: true as const, checked, created, skipped, planned };
}
