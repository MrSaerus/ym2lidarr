# YM2LIDARR API — Полная документация(Generated)

Все эндпоинты доступны под префиксом `/api`. Ниже приведено описание каждого маршрута с примерами запроса и ответа.

---

## Health

### `GET /api/health`
Проверка доступности сервиса.

**Пример запроса:**
```bash
curl http://localhost:4000/api/health
```

**Пример ответа:**
```json
{ "ok": true }
```

---

## Settings

### `GET /api/settings`
Получить текущие настройки.

```bash
curl http://localhost:4000/api/settings
```

```json
{
  "yandexToken": "...",
  "lidarrUrl": "http://lidarr:8686",
  "cronYandexPull": "0 * * * *",
  "enableCronYandexPull": true
}
```

---

### `GET /api/settings/scheduler`
Статус cron-задач.

```bash
curl http://localhost:4000/api/settings/scheduler
```

```json
{
  "ok": true,
  "jobs": [
    {
      "key": "yandexPull",
      "title": "Yandex: Pull all",
      "enabled": true,
      "cron": "0 * * * *",
      "valid": true,
      "nextRun": "2025-08-24T17:00:00.000Z",
      "running": false
    }
  ]
}
```

---

### `POST /api/settings/test/yandex`
Проверка Yandex токена.

```bash
curl -X POST http://localhost:4000/api/settings/test/yandex -d '{"token":"..."}' -H "Content-Type: application/json"
```

```json
{ "ok": true, "uid": 123456, "login": "user@yandex.ru" }
```

---

### `POST /api/settings/test/lidarr`
Проверка соединения с Lidarr.

```bash
curl -X POST http://localhost:4000/api/settings/test/lidarr -d '{"lidarrUrl":"http://lidarr:8686","lidarrApiKey":"XXX"}' -H "Content-Type: application/json"
```

```json
{ "ok": true, "status": 200, "data": { "version": "2.0.0.0" }, "defaults": { "rootFolderPath": "/music", "qualityProfileId": 1, "metadataProfileId": 1, "monitor": "all" } }
```

---

## Stats

### `GET /api/stats`
Сводная статистика по Yandex, Lidarr и кастомным артистам.

```bash
curl http://localhost:4000/api/stats
```

```json
{
  "yandex": {
    "artists": { "total": 100, "matched": 90, "unmatched": 10 },
    "albums": { "total": 50, "matched": 40, "unmatched": 10 },
    "latestAlbums": [ { "id": 123, "title": "Album", "artistName": "Artist" } ],
    "latestArtists": [ { "id": 456, "name": "Artist" } ]
  },
  "lidarr": {
    "artists": { "total": 70, "matched": 60, "unmatched": 10 }
  },
  "custom": {
    "artists": { "total": 5, "matched": 3, "unmatched": 2 }
  }
}
```

---

## Backup

### `GET /api/backup/list`
Список доступных бэкапов.

```bash
curl http://localhost:4000/api/backup/list
```

```json
{
  "ok": true,
  "dir": "/app/data/backups",
  "files": [
    { "file": "backup_20250824_170000.db", "size": 123456, "mtime": 1724500000000 }
  ]
}
```

---

### `POST /api/backup/run`
Выполнить бэкап немедленно.

```bash
curl -X POST http://localhost:4000/api/backup/run
```

```json
{ "ok": true, "file": "backup_20250824_170000.db", "path": "/app/data/backups/backup_20250824_170000.db" }
```

---

## Unified

### `GET /api/unified/artists`
Объединённый список артистов из Yandex и Lidarr.

```bash
curl http://localhost:4000/api/unified/artists
```

```json
{
  "page": 1,
  "pageSize": 50,
  "total": 2,
  "items": [
    {
      "id": 1,
      "name": "Artist A",
      "mbUrl": "https://musicbrainz.org/artist/...",
      "yandexUrl": "https://music.yandex.ru/artist/111",
      "lidarrUrl": "http://lidarr/artist/..."
    }
  ]
}
```

---

### `GET /api/unified/albums`
Объединённый список альбомов.

```bash
curl http://localhost:4000/api/unified/albums
```

```json
{
  "page": 1,
  "pageSize": 50,
  "total": 2,
  "items": [
    {
      "id": 1,
      "title": "Best Album",
      "artistName": "Artist A",
      "year": 2020,
      "rgUrl": "https://musicbrainz.org/release-group/...",
      "yandexUrl": "https://music.yandex.ru/album/111",
      "lidarrUrl": "http://lidarr/album/..."
    }
  ]
}
```

---

## Yandex

### `POST /api/yandex/pull-all`
Загрузить лайки из Yandex в кэш.

```bash
curl -X POST http://localhost:4000/api/yandex/pull-all
```

```json
{ "ok": true, "runId": 42 }
```

---

### `POST /api/yandex/match`
Матчинг артистов и альбомов с MusicBrainz.

```bash
curl -X POST http://localhost:4000/api/yandex/match -d '{"target":"artists","force":true}' -H "Content-Type: application/json"
```

```json
{ "ok": true, "runId": 43 }
```

---

### `POST /api/yandex/push`
Пуш сматченных записей в Lidarr.

```bash
curl -X POST http://localhost:4000/api/yandex/push -d '{"target":"albums"}' -H "Content-Type: application/json"
```

```json
{ "ok": true, "runId": 44 }
```

---

### `GET /api/yandex/artists`
Артисты из Yandex кэша.

```bash
curl http://localhost:4000/api/yandex/artists?page=1&pageSize=10
```

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 100,
  "items": [
    { "id": 1, "name": "Artist A", "yandexUrl": "https://music.yandex.ru/artist/1", "mbUrl": "https://musicbrainz.org/artist/..." }
  ]
}
```

---

### `GET /api/yandex/albums`
Альбомы из Yandex кэша.

```bash
curl http://localhost:4000/api/yandex/albums?page=1&pageSize=10
```

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [
    { "id": 1, "title": "Album A", "artistName": "Artist A", "yandexUrl": "https://music.yandex.ru/album/1", "rgUrl": "https://musicbrainz.org/release-group/..." }
  ]
}
```

---

## Lidarr

### `GET /api/lidarr/artists`
Артисты из кэша Lidarr.

```bash
curl http://localhost:4000/api/lidarr/artists?page=1&pageSize=10
```

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [
    { "id": 1, "name": "Artist A", "monitored": true, "lidarrUrl": "http://lidarr/artist/..." }
  ]
}
```

---

### `POST /api/lidarr/artist/:id/refresh`
Обновить артиста в кэше.

```bash
curl -X POST http://localhost:4000/api/lidarr/artist/1/refresh
```

```json
{ "ok": true }
```

---

### `GET /api/lidarr/albums`
Альбомы из кэша Lidarr.

```bash
curl http://localhost:4000/api/lidarr/albums?page=1&pageSize=10
```

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [
    { "id": 1, "title": "Album A", "artistName": "Artist A", "lidarrUrl": "http://lidarr/album/..." }
  ]
}
```

---

### `POST /api/lidarr/album/:id/refresh`
Обновить альбом в кэше.

```bash
curl -X POST http://localhost:4000/api/lidarr/album/1/refresh
```

```json
{ "ok": true }
```

---

### `POST /api/lidarr/resync`
Полный ресинк артистов и альбомов.

```bash
curl -X POST http://localhost:4000/api/lidarr/resync
```

```json
{ "ok": true, "artists": { "upserted": 50 }, "albums": { "upserted": 100 } }
```

---

## Custom Artists

### `GET /api/custom-artists`
Список кастомных артистов.

```bash
curl http://localhost:4000/api/custom-artists?page=1&pageSize=10
```

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 5,
  "items": [
    { "id": 1, "name": "Custom Artist", "mbid": null, "createdAt": "2025-08-24T12:00:00Z" }
  ]
}
```

---

### `POST /api/custom-artists`
Добавить артистов.

```bash
curl -X POST http://localhost:4000/api/custom-artists -d '{"names":["Artist A","Artist B"]}' -H "Content-Type: application/json"
```

```json
{ "created": 2 }
```

---

### `PATCH /api/custom-artists/:id`
Обновить артиста.

```bash
curl -X PATCH http://localhost:4000/api/custom-artists/1 -d '{"mbid":"xxx-yyy-zzz"}' -H "Content-Type: application/json"
```

```json
{ "id": 1, "name": "Custom Artist", "mbid": "xxx-yyy-zzz" }
```

---

### `DELETE /api/custom-artists/:id`
Удалить артиста.

```bash
curl -X DELETE http://localhost:4000/api/custom-artists/1
```

```json
{ "ok": true }
```

---

### `POST /api/custom-artists/:id/match`
Матчинг одного кастомного артиста.

```bash
curl -X POST http://localhost:4000/api/custom-artists/1/match -d '{"force":true}' -H "Content-Type: application/json"
```

```json
{ "ok": true, "started": true, "runId": 101 }
```

---

### `POST /api/custom-artists/match-all`
Матчинг всех кастомных артистов.

```bash
curl -X POST http://localhost:4000/api/custom-artists/match-all
```

```json
{ "ok": true, "started": true, "runId": 102 }
```

---

## Runs & Logs

### `GET /api/runs?limit=30`
Список запусков.

```bash
curl http://localhost:4000/api/runs?limit=2
```

```json
{
  "ok": true,
  "runs": [
    { "id": 1, "status": "ok", "startedAt": "2025-08-24T12:00:00Z", "kind": "yandex" },
    { "id": 2, "status": "running", "startedAt": "2025-08-24T12:10:00Z", "kind": "lidarr" }
  ]
}
```

---

### `GET /api/runs/:id/logs`
Логи запуска.

```bash
curl http://localhost:4000/api/runs/1/logs
```

```json
{
  "ok": true,
  "items": [
    { "id": 1, "ts": "2025-08-24T12:00:01Z", "level": "info", "message": "Start" },
    { "id": 2, "ts": "2025-08-24T12:00:10Z", "level": "info", "message": "Pull complete" }
  ],
  "nextAfter": 2
}
```

---

### `POST /api/runs/:id/stop`
Остановить выполнение.

```bash
curl -X POST http://localhost:4000/api/runs/2/stop
```

```json
{ "ok": true }
```

---

# Стабильные эндпоинты для UI

- **GET `/api/runs?limit=30`**
- **GET `/api/runs/:id/logs`**
- **GET `/api/stats`**
