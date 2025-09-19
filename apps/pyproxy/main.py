# apps/pyproxy/main.py
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Body, HTTPException
import logging
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

async def collect_tracks(token: str) -> List[Any]:
    """
    Возвращает список полных объектов треков YandexMusic (после батч-дозапроса /tracks).
    """
    client = await ClientAsync(token).init()
    try:
        likes = await client.users_likes_tracks()  # объект с .tracks или список
        tracks_min = getattr(likes, "tracks", likes) or []
        ids: List[str] = []

        # Собираем пары track_id[:album_id] для батч-запроса /tracks
        for t in tracks_min:
            tid = getattr(t, "id", None)
            aid = getattr(t, "album_id", None)
            if tid is None:
                continue
            ids.append(f"{tid}:{aid}" if aid is not None else str(tid))

        tracks_full: List[Any] = []
        for i in range(0, len(ids), 100):
            part = await client.tracks(ids[i:i + 100])
            if part:
                tracks_full.extend(part)
        return tracks_full
    finally:
        # У ClientAsync внутри aiohttp-сессия; вручную её не закрываем —
        # библиотека сама менеджит, но обернули на будущее.
        pass

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
    Возвращает artists/albums/tracks для лайкнутых треков.
    - artists: дедуп по id, иначе по имени (нормализованному)
    - albums:  дедуп по album.id, иначе по (artistName,title)
    - tracks:  без дедупа (или по id при наличии)
    """
    try:
        logger.info("py.likes.start")
        tracks = await collect_tracks(token)

        # ----- Artists (dedupe: по id, иначе по нормализованному имени) -----
        seen_by_id: Dict[int, str] = {}
        seen_by_key: Dict[str, str] = {}
        for t in tracks:
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
        for t in tracks:
            main_artist = extract_main_artist(t)
            alb = extract_first_album(t)
            if not alb["title"]:
                continue

            key = (
                f"id:{alb['id']}"
                if alb["id"] is not None
                else f"pair:{norm(main_artist['name'] or '')}|||{norm(alb['title'] or '')}"
            )
            if key not in seen_albums:
                seen_albums[key] = AlbumOut(
                    id=alb["id"],
                    title=str(alb["title"]).strip(),
                    artistName=str(main_artist["name"] or "").strip(),
                    year=alb["year"],
                    artistId=main_artist["id"],
                )
        albums_out = list(seen_albums.values())

        # ----- Tracks (нормализованные поля, без MBIDs на этом этапе) -----
        # дедуп по track.id, иначе по (artist|||title|||duration)
        seen_tracks: Dict[str, TrackOut] = {}
        for t in tracks:
            main_artist = extract_main_artist(t)
            alb = extract_first_album(t)

            tid = to_int(getattr(t, "id", None))
            title = getattr(t, "title", None) or ""
            dur_ms = to_int(getattr(t, "duration_ms", None))
            dur_sec = to_int((dur_ms // 1000) if isinstance(dur_ms, int) else getattr(t, "duration", None))

            artist_name = (main_artist["name"] or "").strip()
            album_title = (alb["title"] or "").strip()

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
                albumId=alb["id"],
                artistId=main_artist["id"],
                recMbid=None,
                rgMbid=None,
            )

        tracks_out = list(seen_tracks.values())

        logger.info(
            "py.likes.done artists=%d albums=%d tracks=%d",
            len(artists_out), len(albums_out), len(tracks_out)
        )
        return LikesResponse(artists=artists_out, albums=albums_out, tracks=tracks_out)

    except Exception as e:
        logger.exception("py.likes.fail: %s", e)
        raise HTTPException(status_code=500, detail="py-likes-failed")

@app.get("/health")
async def health():
    return {"ok": True}
