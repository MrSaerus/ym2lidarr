# apps/pyproxy/main.py
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Body
import logging
from pydantic import BaseModel
from yandex_music import ClientAsync

app = FastAPI(title="YA PyProxy")
logger = logging.getLogger("pyproxy")

# ====== Schemas ======
class ArtistOut(BaseModel):
    id: Optional[int] = None
    name: str

class AlbumOut(BaseModel):
    id: Optional[int] = None
    title: str
    artistName: str
    year: Optional[int] = None
    artistId: Optional[int] = None

class LikesResponse(BaseModel):
    artists: List[ArtistOut]
    albums: List[AlbumOut]

# ====== Utils ======
def norm(s: str) -> str:
    return (s or "").strip().casefold()

def to_int(x: Any) -> Optional[int]:
    try:
        i = int(x)
        return i
    except Exception:
        return None

async def collect(token: str):
    client = await ClientAsync(token).init()
    likes = await client.users_likes_tracks()  # может вернуть объект с .tracks или просто список
    tracks = []
    ids: List[str] = []

    # Собираем пары track_id[:album_id] для батч-запроса /tracks
    for t in getattr(likes, "tracks", likes) or []:
        tid = getattr(t, "id", None)
        aid = getattr(t, "album_id", None)
        if tid is None:
            continue
        ids.append(f"{tid}:{aid}" if aid is not None else str(tid))

    # Подтягиваем полные объекты треков
    for i in range(0, len(ids), 100):
        part = await client.tracks(ids[i:i + 100])
        tracks.extend(part or [])
    return tracks

# ====== Endpoints ======
@app.post("/verify")
async def verify(token: str = Body(..., embed=True)):
    try:
        client = await ClientAsync(token).init()

        # Простейшая проверка
        await client.users_likes_tracks()

        # best-effort uid/login
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
        logger.exception("Exception occurred during token verification")
        return {"ok": False, "error": "An internal error occurred"}

@app.post("/likes", response_model=LikesResponse)
async def likes(token: str = Body(..., embed=True)):
    tracks = await collect(token)

    # ----- Artists (dedupe: по id, иначе по нормализованному имени) -----
    seen_by_id: Dict[int, str] = {}
    seen_by_key: Dict[str, str] = {}

    for t in tracks or []:
        artists = getattr(t, "artists", None) or []
        for a in artists:
            name = getattr(a, "name", None)
            if not name:
                continue
            aid = to_int(getattr(a, "id", None))
            if aid is not None:
                # приоритет по id
                if aid not in seen_by_id:
                    seen_by_id[aid] = str(name).strip()
            else:
                k = norm(str(name))
                if k and k not in seen_by_key:
                    seen_by_key[k] = str(name).strip()

    artists_out: List[ArtistOut] = (
            [ArtistOut(id=aid, name=name) for aid, name in seen_by_id.items()] +
            [ArtistOut(name=name) for name in seen_by_key.values()]
    )

    # ----- Albums (dedupe: по album.id, иначе по (artistName,title)) -----
    seen_albums: Dict[str, AlbumOut] = {}

    for t in tracks or []:
        # основной артист трека
        main_artist_obj = (getattr(t, "artists", None) or [None])[0]
        main_artist_name = getattr(main_artist_obj, "name", "") or ""
        main_artist_id = to_int(getattr(main_artist_obj, "id", None))

        # первый альбом у трека
        alb = (getattr(t, "albums", None) or [None])[0]
        if not alb:
            continue

        title = getattr(alb, "title", None)
        if not title:
            continue

        alb_id = to_int(getattr(alb, "id", None))
        year = getattr(alb, "year", None) or getattr(alb, "release_year", None)

        key = f"id:{alb_id}" if alb_id is not None else f"pair:{norm(main_artist_name)}|||{norm(title)}"
        if key not in seen_albums:
            seen_albums[key] = AlbumOut(
                id=alb_id,
                title=str(title).strip(),
                artistName=str(main_artist_name).strip(),
                year=to_int(year),
                artistId=main_artist_id,
            )

    albums_out = list(seen_albums.values())

    return LikesResponse(artists=artists_out, albums=albums_out)

@app.get("/health")
async def health():
    return {"ok": True}
