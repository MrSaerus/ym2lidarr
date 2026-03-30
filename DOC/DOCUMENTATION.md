# YM2LIDARR API — Полная документация (актуально)

### [К оглавлению](index.md)

YM2LIDARR — сервис синхронизации музыкальной библиотеки между источниками (Yandex / Navidrome) и Lidarr, с поддержкой матчинг-логики через MusicBrainz, экспортом данных, бэкапами, расписанием (cron) и подсистемой торрентов (Jackett → qBittorrent → копирование/раскладка).

---

## Базовые правила

- Большинство эндпоинтов доступны под префиксом **`/api`**.
- Блок **Runs** доступен **и** с префиксом (`/api/runs…`), **и** без префикса (`/runs…`) — для обратной совместимости.
- Пагинация (где поддерживается): `page`, `pageSize`, иногда поиск `q`, сортировки `sortBy`, `sortDir`.
- Во многих ручных “запускателях” возвращается `runId` — идентификатор прогона для просмотра логов в Runs.

---

## Health

### `GET /api/health` (также доступно: `GET /health`)
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
Получить текущие настройки (набор полей зависит от конфигурации; содержит параметры Yandex/Lidarr/Navidrome, cron-флаги, бэкапы, уведомления, qBittorrent/Jackett и т.д.).

```bash
curl http://localhost:4000/api/settings
```

**Пример ответа (укороченный):**
```json
{
  "yandexToken": "...",
  "yandexDriver": "pyproxy",
  "pyproxyUrl": "http://pyproxy:8080",

  "lidarrUrl": "http://lidarr:8686",
  "lidarrApiKey": "XXX",
  "rootFolderPath": "/music",
  "qualityProfileId": 1,
  "metadataProfileId": 1,
  "monitor": "all",

  "backupEnabled": true,
  "backupDir": "/app/data/backups",
  "backupRetention": 10,

  "qbtUrl": "http://qbittorrent:8080",
  "qbtUser": "admin",
  "qbtPass": "adminadmin",
  "qbtDeleteFiles": true,
  "qbtWebhookSecret": "SECRET",

  "cronYandexPull": "0 * * * *",
  "enableCronYandexPull": true
}
```

---

### `POST /api/settings` (также: `PUT /api/settings`)
Сохранить настройки. Принимаются только разрешённые поля (валидируются/нормализуются на бэке).

```bash
curl -X POST http://localhost:4000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "lidarrUrl":"http://lidarr:8686",
    "lidarrApiKey":"XXX",
    "enableCronYandexPull":true,
    "cronYandexPull":"0 * * * *"
  }'
```

**Пример ответа:**
```json
{ "ok": true }
```

---

### `GET /api/settings/scheduler`
Статус cron-задач (включено/выключено, cron-строка, валидность, nextRun, running).

```bash
curl http://localhost:4000/api/settings/scheduler
```

**Пример ответа:**
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
      "nextRun": "2026-01-04T10:00:00.000Z",
      "running": false
    }
  ]
}
```

---

### `POST /api/settings/scheduler/:key/run`
Ручной запуск конкретной cron-задачи по ключу.

Ключи соответствуют реестру задач (фактический список можно смотреть в ответе `/api/settings/scheduler`), типично:
- `yandexPull`, `yandexMatch`, `yandexPush`
- `lidarrPull`
- `customMatch`, `customPush`
- `backup`
- `navidromePush`
- `torrentsUnmatched`, `torrentsPoll`, `torrentsCopy`

```bash
curl -X POST http://localhost:4000/api/settings/scheduler/yandexPull/run
```

**Пример ответа:**
```json
{ "ok": true, "started": true }
```

---

### Тесты

#### `POST /api/settings/test/yandex`
Проверка Yandex токена (rate-limit: 5 запросов/мин).

```bash
curl -X POST http://localhost:4000/api/settings/test/yandex \
  -H "Content-Type: application/json" \
  -d '{"token":"..."}'
```

**Пример ответа:**
```json
{ "ok": true, "uid": 123456, "login": "user@yandex.ru" }
```

---

#### `POST /api/settings/test/lidarr`
Проверка соединения с Lidarr и получение “defaults” (rootFolderPath/quality/metadata/monitor).

```bash
curl -X POST http://localhost:4000/api/settings/test/lidarr \
  -H "Content-Type: application/json" \
  -d '{"lidarrUrl":"http://lidarr:8686","lidarrApiKey":"XXX"}'
```

**Пример ответа:**
```json
{
  "ok": true,
  "status": 200,
  "data": { "version": "2.x" },
  "defaults": {
    "rootFolderPath": "/music",
    "qualityProfileId": 1,
    "metadataProfileId": 1,
    "monitor": "all"
  }
}
```

---

#### `POST /api/settings/lidarr/defaults`
Получить defaults Lidarr (опционально можно передать `overwrite: true`, чтобы сразу применить в настройках).

```bash
curl -X POST http://localhost:4000/api/settings/lidarr/defaults \
  -H "Content-Type: application/json" \
  -d '{"lidarrUrl":"http://lidarr:8686","lidarrApiKey":"XXX","overwrite":false}'
```

**Пример ответа:**
```json
{
  "ok": true,
  "defaults": {
    "rootFolderPath": "/music",
    "qualityProfileId": 1,
    "metadataProfileId": 1,
    "monitor": "all"
  }
}
```

---

#### `POST /api/settings/test/qbt`
Проверка соединения с qBittorrent по настройкам.

```bash
curl -X POST http://localhost:4000/api/settings/test/qbt
```

**Пример ответа:**
```json
{ "ok": true, "status": 200, "version": "v4.x", "webapi": "2.x" }
```

---

## Stats

### `GET /api/stats`
Сводная статистика: счётчики по источникам, последние элементы, активный run (если есть) + список последних runs.

```bash
curl http://localhost:4000/api/stats
```

**Пример ответа (сокращённый):**
```json
{
  "yandex": {
    "artists": { "total": 100, "matched": 90, "unmatched": 10 },
    "albums": { "total": 50, "matched": 40, "unmatched": 10 },
    "latestAlbums": [
      { "id": 123, "title": "Album", "artistName": "Artist", "yandexUrl": "https://music.yandex.ru/album/123", "rgUrl": "https://musicbrainz.org/release-group/..." }
    ],
    "latestArtists": [
      { "id": 456, "name": "Artist", "yandexUrl": "https://music.yandex.ru/artist/456", "mbUrl": "https://musicbrainz.org/artist/..." }
    ]
  },
  "lidarr": {
    "artists": { "total": 70, "matched": 60, "unmatched": 10 },
    "albums": { "total": 120, "matched": 100, "unmatched": 20 },
    "latestAlbums": [],
    "latestArtists": []
  },
  "custom": {
    "artists": { "total": 5, "matched": 3, "unmatched": 2 },
    "latest": []
  },
  "activeRun": null,
  "runs": [
    { "id": 1, "status": "ok", "kind": "yandex.pull.all", "startedAt": "2026-01-04T09:00:00.000Z", "finishedAt": "2026-01-04T09:01:00.000Z", "message": null, "stats": {}, "progress": null }
  ]
}
```

---

## Export

> Экспорт поддерживается для артистов и альбомов (MBID / ReleaseGroupMBID).

- `GET /api/export/artists.json`
- `GET /api/export/albums.json`
- `GET /api/export/artists.csv`
- `GET /api/export/albums.csv`
- `GET /api/export/artists.md`
- `GET /api/export/albums.md`

**Пример:**
```bash
curl http://localhost:4000/api/export/artists.json
```

---

## Backup

### `GET /api/backup/list`
Список доступных бэкапов.

```bash
curl http://localhost:4000/api/backup/list
```

**Пример ответа:**
```json
{
  "ok": true,
  "dir": "/app/data/backups",
  "files": [
    { "file": "backup_20260104_090000.db", "size": 123456, "mtime": 1760000000000 }
  ]
}
```

---

### `POST /api/backup/run`
Выполнить бэкап немедленно (если бэкапы включены в настройках). Также может вернуть `deleted` (если включена retention-политика).

```bash
curl -X POST http://localhost:4000/api/backup/run
```

**Пример ответа:**
```json
{ "ok": true, "file": "backup_20260104_090000.db", "deleted": [] }
```

---

## Unified (объединённые списки)

### `GET /api/unified/artists`
Объединённый список артистов Yandex + Lidarr, с формированием ссылок MB/Yandex/Lidarr.

Параметры: `page`, `pageSize`, `q`, `sortBy=name|id`, `sortDir=asc|desc`

```bash
curl "http://localhost:4000/api/unified/artists?page=1&pageSize=50&q=metallica"
```

**Пример ответа:**
```json
{
  "page": 1,
  "pageSize": 50,
  "total": 1,
  "items": [
    {
      "id": 1,
      "name": "Metallica",
      "mbUrl": "https://musicbrainz.org/artist/...",
      "yandexArtistId": "111",
      "yandexUrl": "https://music.yandex.ru/artist/111",
      "lidarrId": 10,
      "lidarrUrl": "http://lidarr:8686/artist/..."
    }
  ]
}
```

---

### `GET /api/unified/albums`
Объединённый список альбомов Yandex + Lidarr.

Параметры: `page`, `pageSize`, `q`, `sortBy=title|artist|id`, `sortDir=asc|desc`

```bash
curl "http://localhost:4000/api/unified/albums?page=1&pageSize=50&q=black%20album"
```

**Пример ответа:**
```json
{
  "page": 1,
  "pageSize": 50,
  "total": 1,
  "items": [
    {
      "id": 1,
      "title": "Metallica",
      "artistName": "Metallica",
      "year": 1991,
      "rgUrl": "https://musicbrainz.org/release-group/...",
      "releaseUrl": "https://musicbrainz.org/release/...",
      "yandexAlbumId": "222",
      "yandexUrl": "https://music.yandex.ru/album/222",
      "lidarrAlbumId": 99,
      "lidarrUrl": "http://lidarr:8686/album/..."
    }
  ]
}
```

---

## Yandex

> Ручные старты защищены взаимной блокировкой с кроном. При занятости возвращается `409`.

### `POST /api/yandex/pull-all`
Загрузить лайки из Yandex в кэш.

```bash
curl -X POST http://localhost:4000/api/yandex/pull-all
```

**Ответ:**
```json
{ "ok": true, "runId": 42 }
```

---

### `POST /api/yandex/match`
Матчинг Yandex сущностей с MusicBrainz.  
`target`: `artists | albums | both` (по умолчанию `both`).  
`force` может присутствовать в body, но фактическая политика “force” управляется настройками/воркерами.

```bash
curl -X POST http://localhost:4000/api/yandex/match \
  -H "Content-Type: application/json" \
  -d '{"target":"artists"}'
```

**Ответ:**
```json
{ "ok": true, "runId": 43 }
```

---

### `POST /api/yandex/push`
Пуш сматченных записей в Lidarr. `target`: `artists | albums | both`.

```bash
curl -X POST http://localhost:4000/api/yandex/push \
  -H "Content-Type: application/json" \
  -d '{"target":"albums"}'
```

**Ответ:**
```json
{ "ok": true, "runId": 44 }
```

---

### `GET /api/yandex/artists`
Артисты из кэша Yandex.

Параметры: `page`, `pageSize`, `q`, `sortBy=name|id`, `sortDir=asc|desc`, `missingMb=1`

```bash
curl "http://localhost:4000/api/yandex/artists?page=1&pageSize=10&missingMb=1"
```

**Пример ответа:**
```json
{
  "page": 1,
  "pageSize": 10,
  "total": 100,
  "items": [
    {
      "id": 1,
      "name": "Artist A",
      "yandexArtistId": 1,
      "yandexUrl": "https://music.yandex.ru/artist/1",
      "mbid": null
    }
  ]
}
```

---

### `GET /api/yandex/albums`
Альбомы из кэша Yandex.

Параметры: `page`, `pageSize`, `q`, `sortBy=title|artist|id`, `sortDir=asc|desc`, `missingMb=1`

```bash
curl "http://localhost:4000/api/yandex/albums?page=1&pageSize=10"
```

**Пример ответа:**
```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [
    {
      "id": 1,
      "yandexAlbumId": 1,
      "title": "Album A",
      "artistName": "Artist A",
      "year": 2020,
      "yandexUrl": "https://music.yandex.ru/album/1",
      "rgMbid": "....",
      "rgUrl": "https://musicbrainz.org/release-group/..."
    }
  ]
}
```

---

## Lidarr

### `GET /api/lidarr/artists`
Артисты из кэша Lidarr.

Параметры: `page`, `pageSize`, `q`, `sortBy=name|id`, `sortDir=asc|desc`, `missingMb=1`

```bash
curl "http://localhost:4000/api/lidarr/artists?page=1&pageSize=10"
```

**Пример ответа:**
```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [
    {
      "id": 1,
      "name": "Artist A",
      "mbid": "...",
      "lidarrUrl": "http://lidarr:8686/artist/..."
    }
  ]
}
```

---

### `POST /api/lidarr/artist/:id/refresh`
Обновить артиста в кэше Lidarr.

```bash
curl -X POST http://localhost:4000/api/lidarr/artist/1/refresh
```

**Ответ:**
```json
{ "ok": true }
```

---

### `GET /api/lidarr/albums`
Альбомы из кэша Lidarr.

Параметры: `page`, `pageSize`, `q`, `sortBy=title|artist|id`, `sortDir=asc|desc`, `missingMb=1`

```bash
curl "http://localhost:4000/api/lidarr/albums?page=1&pageSize=10"
```

**Пример ответа (укороченный):**
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
Обновить альбом в кэше Lidarr.

```bash
curl -X POST http://localhost:4000/api/lidarr/album/1/refresh
```

**Ответ:**
```json
{ "ok": true }
```

---

### `POST /api/lidarr/resync`
Полный ресинк артистов и альбомов из Lidarr в локальный кэш.

```bash
curl -X POST http://localhost:4000/api/lidarr/resync
```

**Пример ответа:**
```json
{ "ok": true, "artists": { "upserted": 50 }, "albums": { "upserted": 100 } }
```

---

### `POST /api/lidarr/search-artists`
Запуск “поиска в Lidarr” для артистов (асинхронный запуск воркера).

Body:
- `mode`: `missing|all` (по умолчанию `missing`)

```bash
curl -X POST http://localhost:4000/api/lidarr/search-artists \
  -H "Content-Type: application/json" \
  -d '{"mode":"missing"}'
```

**Ответ:**
```json
{ "ok": true, "started": true, "runId": 123, "mode": "missing", "artists": 10 }
```

---

### `GET /api/lidarr/stats/downloads`
Статистика по альбомам Lidarr: сколько с downloadId / без downloadId.

```bash
curl http://localhost:4000/api/lidarr/stats/downloads
```

**Ответ:**
```json
{ "ok": true, "total": 100, "withDownloads": 60, "withoutDownloads": 40, "ratio": 0.6 }
```

---

## Custom Artists

### `GET /api/custom-artists`
Список кастомных артистов.

Параметры: `page`, `pageSize`, `q`, `sortBy=name|matched|created`, `sortDir=asc|desc`

```bash
curl "http://localhost:4000/api/custom-artists?page=1&pageSize=10"
```

**Пример ответа (сокращённый):**
```json
{
  "page": 1,
  "pageSize": 10,
  "total": 5,
  "items": [
    {
      "id": 1,
      "name": "Custom Artist",
      "mbid": null,
      "createdAt": "2026-01-04T09:00:00.000Z",
      "mbUrl": null,
      "hasLidarr": false,
      "lidarrUrl": null
    }
  ]
}
```

---

### `POST /api/custom-artists`
Добавить кастомных артистов.

Body: `{ names: string[] }`

```bash
curl -X POST http://localhost:4000/api/custom-artists \
  -H "Content-Type: application/json" \
  -d '{"names":["Artist A","Artist B"]}'
```

**Пример ответа:**
```json
{
  "ok": true,
  "added": 2,
  "exists": 0,
  "failed": 0,
  "errors": [],
  "existed": [],
  "createdIds": [101, 102],
  "created": 2
}
```

---

### `PATCH /api/custom-artists/:id`
Обновить имя и/или MBID (если выставляется MBID — бэк может попытаться заполнить `mbAlbumsCount`).

```bash
curl -X PATCH http://localhost:4000/api/custom-artists/1 \
  -H "Content-Type: application/json" \
  -d '{"mbid":"xxx-yyy-zzz"}'
```

**Ответ:** возвращает обновлённую запись `CustomArtist`.

---

### `DELETE /api/custom-artists/:id`
Удалить артиста.

```bash
curl -X DELETE http://localhost:4000/api/custom-artists/1
```

**Ответ:**
```json
{ "ok": true }
```

---

### `POST /api/custom-artists/:id/match`
Матчинг одного кастомного артиста (создаёт `runId`).

```bash
curl -X POST http://localhost:4000/api/custom-artists/1/match \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

**Ответ:**
```json
{ "ok": true, "started": true, "runId": 101 }
```

---

### `POST /api/custom-artists/match-all`
Матчинг всех кастомных артистов.

```bash
curl -X POST http://localhost:4000/api/custom-artists/match-all
```

**Ответ:**
```json
{ "ok": true, "started": true, "runId": 102 }
```

---

## Sync (совместимостьные ручные старты)

> Исторический набор эндпоинтов. Часть логики управляется настройками (например, force-флаги).

### `POST /api/sync/yandex/pull`
Yandex Pull (legacy). Можно передать `token` для override.

```bash
curl -X POST http://localhost:4000/api/sync/yandex/pull \
  -H "Content-Type: application/json" \
  -d '{"token":"..."}'
```

**Ответ:**
```json
{ "started": true, "runId": 1 }
```

---

### `POST /api/sync/lidarr/pull`
Lidarr Pull. Опционально `target=artists|albums|both` (body или query). Если target не задан — legacy “both”.

```bash
curl -X POST "http://localhost:4000/api/sync/lidarr/pull?target=artists"
```

**Ответ:**
```json
{ "started": true, "runId": 2, "target": "artists" }
```

---

### `POST /api/sync/match`
MusicBrainz match. `target=artists|albums|both` (body или query). `force` берётся из настроек `mbMatchForce`.

```bash
curl -X POST http://localhost:4000/api/sync/match \
  -H "Content-Type: application/json" \
  -d '{"target":"both"}'
```

**Ответ:**
```json
{ "started": true, "runId": 3, "force": false, "target": "both" }
```

---

### `POST /api/sync/lidarr`
Пуш в Lidarr.  
Body:
- `target`: `artists|albums` (если не передано — “from-settings”)
- `source`: `yandex|custom` (по умолчанию `yandex`)

```bash
curl -X POST http://localhost:4000/api/sync/lidarr \
  -H "Content-Type: application/json" \
  -d '{"target":"artists","source":"yandex"}'
```

**Ответ:**
```json
{ "started": true, "target": "artists", "source": "yandex" }
```

---

### `POST /api/sync/custom/match`
Match-all custom (force берётся из настроек `customMatchForce`).

```bash
curl -X POST http://localhost:4000/api/sync/custom/match
```

**Ответ:**
```json
{ "started": true, "runId": 10, "force": false }
```

---

### `POST /api/sync/custom/push`
Push-all custom → Lidarr.

```bash
curl -X POST http://localhost:4000/api/sync/custom/push
```

**Ответ:**
```json
{ "started": true, "runId": 11 }
```

---

### `POST /api/sync/yandex/pull-all`
Полный Pull.

```bash
curl -X POST http://localhost:4000/api/sync/yandex/pull-all
```

**Ответ:**
```json
{ "started": true, "runId": 20 }
```

---

### `POST /api/sync/yandex/match`
Match Yandex (force берётся из настроек `yandexMatchForce`). `target` в body/query.

```bash
curl -X POST "http://localhost:4000/api/sync/yandex/match?target=albums"
```

**Ответ:**
```json
{ "started": true, "runId": 21, "target": "albums", "force": false }
```

---

### `POST /api/sync/yandex/push`
Push Yandex → Lidarr. `target` в body/query.

```bash
curl -X POST "http://localhost:4000/api/sync/yandex/push?target=both"
```

**Ответ:**
```json
{ "started": true, "runId": 22, "target": "both" }
```

---

### Runs внутри `/sync`

#### `GET /api/sync/runs?limit=…&kind=…`
```bash
curl "http://localhost:4000/api/sync/runs?limit=20"
```

#### `GET /api/sync/runs/:id`
Возвращает запись `SyncRun` напрямую.

#### `GET /api/sync/runs/:id/logs?after=…`
Возвращает **массив** логов напрямую (без обёртки `{ ok, items… }`).

#### `POST /api/sync/runs/:id/stop`
Мягкая остановка (ставит `cancel=true` в stats).

---

## Runs & Logs (основной API + совместимость без `/api`)

### `GET /api/runs?limit=30` (также: `GET /runs?limit=…`)
Список запусков (limit по умолчанию 20, диапазон 1..200).

```bash
curl "http://localhost:4000/api/runs?limit=2"
```

**Пример ответа:**
```json
{
  "ok": true,
  "runs": [
    {
      "id": 2,
      "status": "running",
      "startedAt": "2026-01-04T09:10:00.000Z",
      "finishedAt": null,
      "message": null,
      "kind": "lidarr.pull.artists",
      "progress": { "total": 100, "done": 20, "pct": 20 }
    },
    {
      "id": 1,
      "status": "ok",
      "startedAt": "2026-01-04T09:00:00.000Z",
      "finishedAt": "2026-01-04T09:01:00.000Z",
      "message": null,
      "kind": "yandex.pull.all",
      "progress": null
    }
  ]
}
```

---

### `GET /api/runs/latest` (также: `GET /runs/latest`)
Последний запуск.

---

### `GET /api/runs/:id` (также: `GET /runs/:id`)
Детали запуска (возвращает запись `SyncRun` напрямую).

---

### `GET /api/runs/:id/logs?after=…&limit=…` (также: `GET /runs/:id/logs…`)
Логи запуска.

Параметры:
- `after` (id последнего полученного лога, по умолчанию 0)
- `limit` (1..500, по умолчанию 200)

```bash
curl "http://localhost:4000/api/runs/1/logs?after=0&limit=200"
```

**Пример ответа:**
```json
{
  "ok": true,
  "items": [
    { "id": 1, "ts": "2026-01-04T09:00:01.000Z", "level": "info", "message": "Start", "data": null, "runId": 1 }
  ],
  "nextAfter": 1
}
```

---

### `POST /api/runs/:id/stop` (также: `POST /runs/:id/stop`)
Мягкая остановка (ставит `cancel=true` в stats). Если run уже завершён — может вернуть `alreadyFinished`.

```bash
curl -X POST http://localhost:4000/api/runs/2/stop
```

**Ответ:**
```json
{ "ok": true }
```

---

## Jackett Indexers

### `GET /api/jackett/indexers`
Список индексаторов Jackett (поле `apiKey` в ответе маскируется пустой строкой).

```bash
curl http://localhost:4000/api/jackett/indexers
```

---

### `POST /api/jackett/indexers`
Создать индексатор.

```bash
curl -X POST http://localhost:4000/api/jackett/indexers \
  -H "Content-Type: application/json" \
  -d '{
    "name":"RuTracker",
    "enabled":true,
    "allowAuto":true,
    "baseUrl":"http://jackett:9117",
    "apiKey":"KEY",
    "categories":["5030","5040"],
    "order":100
  }'
```

**Ответ:**
```json
{ "ok": true, "id": 2 }
```

---

### `PUT /api/jackett/indexers/:id`
Обновить индексатор (пустой `apiKey` не перезатирает текущий).

---

### `DELETE /api/jackett/indexers/:id`
Удалить индексатор.

---

### `POST /api/jackett/indexers/:id/test`
Проверить caps (torznab) для индексатора.

```bash
curl -X POST http://localhost:4000/api/jackett/indexers/2/test
```

**Ответ:**
```json
{ "ok": true, "status": 200, "version": "..." }
```

---

## Torrents

Блок управления торрент-тасками (создание/поиск релизов/выбор/добавление в qBittorrent/копирование/поллинг статусов).

Базовый префикс: **`/api/torrents`**

### Tasks

#### `POST /api/torrents/tasks`
Создать (или переиспользовать) задачу.

Body (основное):
- `kind`: `artist|album` (обязательно)
- `artistName`, `albumTitle`, `year`, `query`
- `source`: `manual|auto|yandex` (по умолчанию `manual`)
- `collisionPolicy`: `replace|keep|skip` (по умолчанию `replace`)
- `minSeeders`, `limitReleases`, `indexerId`, `targetPath`, `scheduledAt`

```bash
curl -X POST http://localhost:4000/api/torrents/tasks \
  -H "Content-Type: application/json" \
  -d '{"kind":"album","artistName":"Artist","albumTitle":"Album","year":2020}'
```

**Ответ (пример):**
```json
{ "ok": true, "existed": false, "task": { "id": 1, "kind": "album", "status": "queued" } }
```

---

#### `GET /api/torrents/tasks`
Список задач.

Параметры:
- `status`: `any` или конкретный статус (`queued|searching|found|added|downloading|downloaded|moved|failed|...`)
- `page`, `pageSize`, `q`
- сортировки: `sortField`, `sortDir=asc|desc`

```bash
curl "http://localhost:4000/api/torrents/tasks?status=any&page=1&pageSize=50&q=metallica"
```

---

#### `GET /api/torrents/tasks/:id`
Получить задачу по id.

---

#### `PATCH /api/torrents/tasks/:id/status`
Проставить статус (и/или служебные поля).

Body:
- `status` (обязательно, один из `TorrentStatus`)
- `lastError?`, `startedAt?`, `finishedAt?`, `qbitHash?`

---

### Releases

#### `POST /api/torrents/tasks/:id/releases`
Bulk upsert релизов (обычно результат torznab).

Body: `{ items: [...] }`

---

#### `GET /api/torrents/tasks/:id/releases`
Список релизов по задаче.

---

### Search / Pick / Add / Move / Copy / QBT status

#### `POST /api/torrents/tasks/:id/search`
Запрос к Jackett (torznab).  
Body: `{ limitPerIndexer?: number }`

#### `POST /api/torrents/tasks/:id/pick`
Выбор лучшего релиза.  
Body: `{ commit?: boolean }` (если `commit=true` — записывает выбор в БД)

#### `POST /api/torrents/tasks/:id/add`
Добавить выбранный релиз в qBittorrent.  
Body: `{ releaseId?, savePath?, autoStart?, tags? }`

#### `POST /api/torrents/tasks/:id/move`
Триггер relocate в “final path” для конкретной задачи.

#### `POST /api/torrents/tasks/:id/copy`
Копирование скачанного в финальную директорию (логика зависит от настроек путей).

#### `GET /api/torrents/tasks/:id/qbt`
Обновить и вернуть статус задачи из qBittorrent.

---

### QBT automation endpoints

#### `POST /api/torrents/qbt/relocate`
Auto-relocate downloaded (batch).  
Body: `{ batchSize?: number }`

#### `POST /api/torrents/qbt/copy-downloaded`
Auto-copy downloaded (batch).  
Body: `{ batchSize?: number }`

#### `POST /api/torrents/qbt/poll`
Auto-poll qBittorrent (batch).  
Body: `{ batchSize?: number }`

---

### qBittorrent Webhook

#### `POST /api/torrents/qbt/webhook?secret=XYZ`
Webhook обновления статусов из qBittorrent. Secret можно передать:
- `?secret=...` **или**
- заголовком `x-qbt-secret: ...`

Body (типично): `{ hash, state, progress, name? }`

---

## Pipeline

> Утилитарный блок для “run-unmatched” (план/выполнение) — в ответе возвращаются stats и список задействованных задач.

### `POST /api/pipeline/plan-unmatched`
Посчитать план: какие альбомы/артисты будут обработаны.

Body:
- `limit?: number` (по умолчанию 20)
- `minSeeders?: number`
- `limitPerIndexer?: number`
- `parallelSearches?: number`

```bash
curl -X POST http://localhost:4000/api/pipeline/plan-unmatched \
  -H "Content-Type: application/json" \
  -d '{"limit":10}'
```

**Ответ:**
```json
{
  "ok": true,
  "plan": {
    "albums": { "selected": 10, "total": 100 },
    "artists": { "selected": 0, "total": 50 }
  }
}
```

---

### `POST /api/pipeline/run-unmatched`
Выполнить обработку unmatched: создать торрент-таски, поиск, add to qBittorrent.

Body (те же параметры +):
- `dryRun?: boolean`
- `autoStart?: boolean`

```bash
curl -X POST http://localhost:4000/api/pipeline/run-unmatched \
  -H "Content-Type: application/json" \
  -d '{"limit":10,"dryRun":false}'
```

**Ответ (пример):**
```json
{
  "ok": true,
  "stats": { "tasksCreated": 10, "addedToQbt": 10 },
  "tasks": [ { "id": 1 }, { "id": 2 } ]
}
```

---

## Navidrome

Блок интеграции с Navidrome (тест/план/apply).

### `POST /api/navidrome/test`
Проверка подключения к Navidrome (по настройкам / body).

```bash
curl -X POST http://localhost:4000/api/navidrome/test
```

**Ответ (пример):**
```json
{ "ok": true, "server": { "type": "navidrome", "version": "..." } }
```

---

### `POST /api/navidrome/plan`
Построить план синхронизации (что будет добавлено/обновлено).

```bash
curl -X POST http://localhost:4000/api/navidrome/plan \
  -H "Content-Type: application/json" \
  -d '{"target":"all"}'
```

**Ответ:**
```json
{ "ok": true, "runId": 200 }
```

---

### `POST /api/navidrome/apply`
Применить план синхронизации.

```bash
curl -X POST http://localhost:4000/api/navidrome/apply \
  -H "Content-Type: application/json" \
  -d '{"target":"all"}'
```

**Ответ:**
```json
{ "ok": true, "runId": 201 }
```

---

## Webhooks

### `POST /api/webhooks/lidarr?secret=...`
Webhook Lidarr (на успешный импорт). Если `qbtWebhookSecret` задан в настройках — требуется `?secret=`.

Поведение: извлекает hash (`downloadId`/`torrentInfoHash`) и удаляет торрент из qBittorrent (с учётом `qbtDeleteFiles`).

```bash
curl -X POST "http://localhost:4000/api/webhooks/lidarr?secret=SECRET" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"DownloadFolderImported","downloadId":"<40hex>","artist":{"name":"A"},"album":{"title":"B"}}'
```

**Ответ (пример):**
```json
{
  "ok": true,
  "deleted": "0123...abcd",
  "deleteFiles": true,
  "eventType": "DownloadFolderImported",
  "artist": "A",
  "album": "B"
}
```

---

## Debug

### `GET /api/debug/qbt/ping`
Пинг qBittorrent по `QBT_URL` из окружения (диагностика).

```bash
curl http://localhost:4000/api/debug/qbt/ping
```

**Ответ (пример):**
```json
{ "ok": true, "base": "http://qbittorrent:8080", "webapi": "2.x", "status": 200 }
```

---

# Стабильные эндпоинты для UI

- **GET `/api/runs?limit=30`**
- **GET `/api/runs/:id/logs`**
- **GET `/api/stats`**
