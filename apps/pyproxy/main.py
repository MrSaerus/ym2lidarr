import asyncio
from typing import List, Optional, Tuple, Any, Dict
from fastapi import FastAPI, Body
from pydantic import BaseModel
from yandex_music import ClientAsync

app = FastAPI(title="YA PyProxy")

class LikesResponse(BaseModel):
    artists: List[str]
    albums: List[dict]

def norm(s: str) -> str:
    return (s or "").strip().casefold()

def dedupe_preserve_case(names: List[str]) -> List[str]:
    seen: Dict[str, str] = {}
    for n in names:
        k = norm(n)
        if k and k not in seen:
            seen[k] = n.strip()
    return list(seen.values())

async def collect(token: str):
    client = await ClientAsync(token).init()
    likes = await client.users_likes_tracks()
    tracks = []
    ids = []
    for t in getattr(likes, "tracks", likes) or []:
        tid = getattr(t, "id", None)
        aid = getattr(t, "album_id", None)
        if tid is None:
            continue
        ids.append(f"{tid}:{aid}" if aid is not None else str(tid))
    for i in range(0, len(ids), 100):
        part = await client.tracks(ids[i:i+100])
        tracks.extend(part or [])
    return tracks

@app.post("/verify")
async def verify(token: str = Body(..., embed=True)):
    try:
        client = await ClientAsync(token).init()

        # Простейшая проверка работоспособности токена:
        # если запрос проходит — токен валиден (и капчи нет).
        await client.users_likes_tracks()

        # Пытаемся аккуратно достать uid/login (не во всех версиях есть одинаково)
        uid = None
        login = None
        try:
            me = await client.me  # в некоторых версиях это coroutine/property
            account = getattr(me, "account", None)
            uid = getattr(account, "uid", None) or getattr(me, "uid", None)
            login = getattr(account, "login", None) or getattr(me, "login", None)
        except Exception:
            pass

        return {"ok": True, "uid": uid, "login": login}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/likes", response_model=LikesResponse)
async def likes(token: str = Body(..., embed=True)):
    tracks = await collect(token)

    # artists
    names: List[str] = []
    for t in tracks:
        for a in (getattr(t, "artists", None) or []):
            if getattr(a, "name", None):
                names.append(a.name)
    artists = dedupe_preserve_case(names)

    # albums
    seen: Dict[str, dict] = {}
    for t in tracks:
        alb = (getattr(t, "albums", None) or [None])[0]
        title = getattr(alb, "title", None) if alb else None
        year = getattr(alb, "year", None) or getattr(alb, "release_year", None) if alb else None
        if not title:
            continue
        main_artist = ""
        if getattr(t, "artists", None):
            main_artist = t.artists[0].name or ""
        key = f"{norm(main_artist)}|||{norm(title)}"
        if key not in seen:
            seen[key] = {"artist": main_artist, "title": title, "year": year}
    return {"artists": artists, "albums": list(seen.values())}

@app.get("/health")
async def health():
    return {"ok": True}
