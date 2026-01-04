# apps/pyproxy/main.py
import logging
from typing import List, Optional, Dict, Any, Set
from fastapi import FastAPI, Body, HTTPException
from pydantic import BaseModel
from yandex_music import ClientAsync

app = FastAPI(title="YA PyProxy")
logger = logging.getLogger("pyproxy")
logging.basicConfig(level=logging.INFO)

# ====== Schemas ======
class ArtistOut(BaseModel):
    id: Optional[int] = None
    name: str
    mbid: Optional[str] = None  # на будущее (API это поле спокойно проглотит)

class AlbumOut(BaseModel):
    id: Optional[int] = None
    title: str
    artistName: str
    year: Optional[int] = None
    artistId: Optional[int] = None
    rgMbid: Optional[str] = None  # на будущее для релиз-группы
    genre: Optional[str] = None   # жанр альбома (если есть)

class TrackOut(BaseModel):
    id: Optional[int] = None
    title: str
    artistName: str
    albumTitle: Optional[str] = None
    durationSec: Optional[int] = None
    albumId: Optional[int] = None
    artistId: Optional[int] = None
    recMbid: Optional[str] = None  # на будущее: запись
    rgMbid: Optional[str] = None   # на будущее: релиз-группа
    genre: Optional[str] = None       # жанр трека (если есть)
    albumGenre: Optional[str] = None  # жанр альбома (дублируем для удобства)
    liked: bool = False               # именно этот трек лайкнут пользователем


class LikesResponse(BaseModel):
    artists: List[ArtistOut]
    albums: List[AlbumOut]
    tracks: List[TrackOut]

# ====== Utils ======
def norm(s: str) -> str:
    return (s or "").strip().casefold()

def to_int(x: Any) -> Optional[int]:
    try:
        return int(x)
    except Exception:
        return None


def extract_main_artist(track_obj: Any) -> Dict[str, Optional[Any]]:
    a = (getattr(track_obj, "artists", None) or [None])[0]
    if not a:
        return {"name": None, "id": None}
    return {
        "name": getattr(a, "name", None),
        "id": to_int(getattr(a, "id", None)),
    }

def extract_first_album(track_obj: Any) -> Dict[str, Optional[Any]]:
    alb = (getattr(track_obj, "albums", None) or [None])[0]
    if not alb:
        return {"id": None, "title": None, "year": None}
    return {
        "id": to_int(getattr(alb, "id", None)),
        "title": getattr(alb, "title", None),
        "year": to_int(getattr(alb, "year", None) or getattr(alb, "release_year", None)),
    }

def extract_album_genre(album_obj: Any) -> Optional[str]:
    """
    Мягко достаём жанр альбома.
    В разных ответах Я.Музыки:
      - поле genre может быть строкой,
      - поле genres может быть списком объектов или строк.
    """
    if album_obj is None:
        return None

    g = getattr(album_obj, "genre", None)
    if g:
        return str(g)

    g_list = getattr(album_obj, "genres", None)
    if not g_list:
        return None

    first = g_list[0]
    if isinstance(first, str):
        return first
    title = getattr(first, "title", None)
    if title:
        return str(title)

    return None

# ====== Endpoints ======
@app.post("/verify")
async def verify(token: str = Body(..., embed=True)):
    try:
        client = await ClientAsync(token).init()
        # Простая проверка доступа
        await client.users_likes_tracks()

        uid = None
        login = None
        try:
            me = await client.me
            account = getattr(me, "account", None)
            uid = getattr(account, "uid", None) or getattr(me, "uid", None)
            login = getattr(account, "login", None) or getattr(me, "login", None)
        except Exception:
            pass

        return {"ok": True, "uid": uid, "login": login}
    except Exception as e:
        logger.exception("verify failed: %s", e)
        # API ориентируется на { ok:false }, это безопаснее чем 500
        return {"ok": False, "error": "verify-failed"}

@app.post("/likes", response_model=LikesResponse)
async def likes(token: str = Body(..., embed=True)):
    """
    Возвращает artists/albums/tracks для ЛАЙКНУТЫХ треков.
    Поведение:
      - tracks: только лайкнутые треки;
      - liked = true для всех треков в выдаче;
      - genre: жанр трека (если есть; список жанров сериализован в строку);
      - albumGenre: жанр альбома (если есть).
    """
    try:
        logger.info("py.likes.start")
        client = await ClientAsync(token).init()

        # 1) Минимальные лайки
        likes = await client.users_likes_tracks()
        tracks_min = getattr(likes, "tracks", likes) or []

        # 2) Дотягиваем полные объекты треков через /tracks
        ids_for_tracks: List[str] = []
        for t in tracks_min:
            tid = getattr(t, "id", None)
            aid = getattr(t, "album_id", None)
            if tid is None:
                continue
            if aid is not None:
                ids_for_tracks.append(f"{tid}:{aid}")
            else:
                ids_for_tracks.append(str(tid))

        liked_tracks: List[Any] = []
        for i in range(0, len(ids_for_tracks), 100):
            part = await client.tracks(ids_for_tracks[i:i + 100])
            if part:
                liked_tracks.extend(part)

        # 3) Собираем album_ids и дотягиваем meta альбомов (для жанра/года)
        album_ids: Set[int] = set()
        for t in liked_tracks:
            alb = extract_first_album(t)
            aid = alb.get("id")
            if aid:
                album_ids.add(aid)

        album_meta_map: Dict[int, Any] = {}
        if album_ids:
            ids_list = list(album_ids)
            for i in range(0, len(ids_list), 20):
                chunk = ids_list[i:i + 20]
                albums = await client.albums(chunk)
                for alb in albums or []:
                    aid = to_int(getattr(alb, "id", None))
                    if not aid:
                        continue
                    album_meta_map[aid] = alb

        # ----- Artists (dedupe: по id, иначе по нормализованному имени) -----
        seen_by_id: Dict[int, str] = {}
        seen_by_key: Dict[str, str] = {}
        for t in liked_tracks:
            artists = getattr(t, "artists", None) or []
            for a in artists:
                name = getattr(a, "name", None)
                if not name:
                    continue
                aid = to_int(getattr(a, "id", None))
                if aid is not None:
                    if aid not in seen_by_id:
                        seen_by_id[aid] = str(name).strip()
                else:
                    k = norm(str(name))
                    if k and k not in seen_by_key:
                        seen_by_key[k] = str(name).strip()

        artists_out: List[ArtistOut] = (
                [ArtistOut(id=aid, name=name) for aid, name in seen_by_id.items()]
                + [ArtistOut(name=name) for name in seen_by_key.values()]
        )

        # ----- Albums (dedupe: по album.id, иначе по (artistName,title)) -----
        seen_albums: Dict[str, AlbumOut] = {}
        for t in liked_tracks:
            main_artist = extract_main_artist(t)
            alb = extract_first_album(t)
            if not alb["title"] and alb["id"] is None:
                continue

            album_id = alb["id"]
            album_obj = album_meta_map.get(album_id) if album_id is not None else None
            album_genre = extract_album_genre(album_obj)

            key = (
                f"id:{album_id}"
                if album_id is not None
                else f"pair:{norm(main_artist['name'] or '')}|||{norm(alb['title'] or '')}"
            )

            if key in seen_albums:
                continue

            album_title = str(alb["title"] or "").strip()
            if not album_title and album_obj is not None:
                album_title = str(getattr(album_obj, "title", "")).strip()

            seen_albums[key] = AlbumOut(
                id=album_id,
                title=album_title,
                artistName=str(main_artist["name"] or "").strip(),
                year=alb["year"],
                artistId=main_artist["id"],
                genre=album_genre,
            )

        albums_out = list(seen_albums.values())

        # ----- Tracks (только лайкнутые, с жанрами) -----
        seen_tracks: Dict[str, TrackOut] = {}
        for t in liked_tracks:
            main_artist = extract_main_artist(t)
            alb = extract_first_album(t)

            tid = to_int(getattr(t, "id", None))
            title = getattr(t, "title", None) or ""
            dur_ms = to_int(getattr(t, "duration_ms", None))
            dur_sec = to_int(
                (dur_ms // 1000) if isinstance(dur_ms, int) else getattr(t, "duration", None)
            )

            artist_name = (main_artist["name"] or "").strip()
            album_title = (alb["title"] or "").strip()
            album_id = alb["id"]

            # жанр трека
            track_genre_list = []
            tg = getattr(t, "genres", None) or getattr(t, "genre", None)
            if isinstance(tg, list):
                for g in tg:
                    if isinstance(g, str):
                        track_genre_list.append(g)
                    else:
                        g_title = getattr(g, "title", None)
                        if g_title:
                            track_genre_list.append(str(g_title))
            elif isinstance(tg, str):
                track_genre_list.append(tg)

            # приводим к строке (можно потом класть в JSON-поле как есть)
            if track_genre_list:
                track_genre: Optional[str] = str(track_genre_list)
            else:
                track_genre = "[]"

            # жанр альбома
            album_obj = album_meta_map.get(album_id) if album_id is not None else None
            album_genre = extract_album_genre(album_obj)

            if not album_title and album_obj is not None:
                album_title = str(getattr(album_obj, "title", "")).strip()

            if tid is not None:
                key = f"id:{tid}"
            else:
                key = f"pair:{norm(artist_name)}|||{norm(title)}|||{dur_sec or 0}"

            if key in seen_tracks:
                continue

            seen_tracks[key] = TrackOut(
                id=tid,
                title=str(title).strip(),
                artistName=artist_name,
                albumTitle=album_title or None,
                durationSec=dur_sec,
                albumId=album_id,
                artistId=main_artist["id"],
                recMbid=None,
                rgMbid=None,
                genre=track_genre,
                albumGenre=album_genre,
                liked=True,  # все треки здесь получены из users_likes_tracks
            )

        tracks_out = list(seen_tracks.values())

        logger.info(
            "py.likes.done artists=%d albums=%d tracks=%d",
            len(artists_out), len(albums_out), len(tracks_out),
        )
        return LikesResponse(artists=artists_out, albums=albums_out, tracks=tracks_out)

    except Exception as e:
        logger.exception("py.likes.fail: %s", e)
        raise HTTPException(status_code=500, detail="py-likes-failed")


@app.get("/health")
async def health():
    return {"ok": True}
