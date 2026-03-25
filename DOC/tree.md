# API(Generated)
### [К оглавлению](index.md)

## Базовые правила путей

- Почти все эндпоинты доступны под префиксом **`/api/*`**.
- **Health** доступен **и без `/api`**: `GET /health` и `GET /api/health`.
- **Runs** доступны **в двух вариантах** (оба валидны):  
  `GET /runs…` **и** `GET /api/runs…` (то же для `latest`, `:id`, `:id/logs`, `:id/stop`).

---

## Health

- **GET `/health`** — проверка живости `{ ok: true }`.
- **GET `/api/health`** — то же самое.

---

## Settings

- **GET `/api/settings`** — получить настройки (секреты вроде паролей маскируются пустой строкой).
- **POST `/api/settings`** — сохранить настройки.
- **PUT `/api/settings`** — то же, что `POST`.

### Scheduler (UI/операторские ручные запуски)

- **GET `/api/settings/scheduler`** — статусы cron-джоб (ключ, cron, enabled, valid, nextRun, running…).
- **POST `/api/settings/scheduler/:key/run`** — ручной запуск *поддерживается только для ключей*:
  - `torrentsUnmatched`
  - `torrentsPoll`
  - `torrentsCopy`  
  Остальные ключи вернут `404 Unknown scheduler key`.

### Тесты/помощники

- **POST `/api/settings/test/yandex`** — проверить токен Yandex.  
  Body: `{ token?: string }` (если не передан — берётся из настроек/ENV).
- **POST `/api/settings/test/lidarr`** — проверить Lidarr API (может вернуть `defaults` и информацию о применении дефолтов).  
  Body опционально: `{ lidarrUrl?, lidarrApiKey?, ... }`
- **POST `/api/settings/lidarr/defaults`** — подтянуть дефолты Lidarr из настроек.  
  Body: `{ overwrite?: boolean }`
- **POST `/api/settings/test/qbt`** — проверить qBittorrent (webapiVersion + login) по данным из настроек.

---

## Stats

- **GET `/api/stats`** — сводка по Yandex/Lidarr/Custom, последние элементы, доли “скачано/не скачано”, пересечения и последние прогоны.

---

## Export

- **GET `/api/export/artists.json`** — артисты в JSON (MBID).
- **GET `/api/export/albums.json`** — альбомы в JSON (ReleaseGroupMBID).
- **GET `/api/export/artists.csv`**, **GET `/api/export/albums.csv`** — CSV (с BOM для Excel).
- **GET `/api/export/artists.md`**, **GET `/api/export/albums.md`** — Markdown таблицы.

---

## Backup

- **GET `/api/backup/list`** — список бэкапов (директория берётся из settings `backupDir`, иначе дефолт).
- **POST `/api/backup/run`** — выполнить бэкап сейчас (может вернуть `400`, если бэкап отключён настройками).

---

## Unified (объединённые списки)

### Artists

- **GET `/api/unified/artists`** — объединённые артисты Yandex+Lidarr (ссылки MB/Lidarr/Yandex).  
  Query: `page`, `pageSize`, `q`, `sortBy`, `sortDir`.

### Albums

- **GET `/api/unified/albums`** — объединённые альбомы Yandex+Lidarr (ссылки MB/Lidarr/Yandex).  
  Query: `page`, `pageSize`, `q`, `sortBy`, `sortDir`.

---

## Yandex

### Ручные старты (прямые эндпоинты)

- **POST `/api/yandex/pull-all`** — Yandex → кэш.  
  Response: `{ ok: true, runId }`
- **POST `/api/yandex/match`** — матчинг к MB.  
  Body: `{ target?: 'artists'|'albums'|'both', force?: boolean }`
- **POST `/api/yandex/push`** — отправка в Lidarr.  
  Body: `{ target?: 'artists'|'albums'|'both' }`

### Списки

- **GET `/api/yandex/artists`** — артисты из кэша Yandex.  
  Query: `page`, `pageSize` (clamp 1..200), `q`, `sortBy`, `sortDir`.
- **GET `/api/yandex/albums`** — альбомы из кэша Yandex.  
  Query: `page`, `pageSize` (clamp 1..200), `q`, `sortBy`, `sortDir`.

---

## Lidarr

### Artists

- **GET `/api/lidarr/artists`** — артисты из кэша Lidarr.
- **POST `/api/lidarr/artist/:id/refresh`** — обновить кэш артиста (тянет из Lidarr и upsert в БД).

### Albums

- **GET `/api/lidarr/albums`** — альбомы из кэша Lidarr.  
  Query (поддерживается): `page`, `pageSize`, `q`, `monitored=all|true|false`, `sortBy`, `sortDir`,
  `minTracks`, `maxTracks`, `minSize`, `maxSize`, `hasPath=all|with|without`.
- **POST `/api/lidarr/album/:id/refresh`** — обновить кэш альбома.
- **POST `/api/lidarr/resync`** — полный ресинк артистов и альбомов (блокируется, если идёт lidarr pull).

### Дополнительно

- **GET `/api/lidarr/stats/downloads`** — статистика скачанности артистов (total/withDownloads/withoutDownloads/ratio).
- **POST `/api/lidarr/search-artists`** — массовый “Search” артистов в Lidarr (асинхронно через run).  
  Body: `{ mode?: 'fast'|'normal'|'slow' }`

---

## Custom Artists

- **GET `/api/custom-artists`** — список кастомных артистов.  
  Query: `page`, `pageSize`, `q`, `sortBy=name|matched|created`, `sortDir=asc|desc`.
- **POST `/api/custom-artists`** — добавить артистов.  
  Body: `{ names: string[] }`
- **PATCH `/api/custom-artists/:id`** — обновить имя/MBID.
- **DELETE `/api/custom-artists/:id`** — удалить артиста.

### Матчинг

- **POST `/api/custom-artists/:id/match`** — матчинг одного артиста (поддерживает `force`).
- **POST `/api/custom-artists/match-all`** — матчинг всех (поддерживает `force`).

---

## Sync (совместимостьные ручные старты)

> Это legacy/compat слой. Рекомендуемые ручные старты — в `/api/yandex/*`, `/api/lidarr/*`, `/api/custom-artists/*`.

- **POST `/api/sync/yandex/pull`** — Yandex Pull.
- **POST `/api/sync/lidarr/pull`** — Lidarr Pull.
- **POST `/api/sync/match`** — матчинг MB.
- **POST `/api/sync/lidarr`** — push в Lidarr.  
  Body: `{ target?: 'artists'|'albums', source?: 'yandex'|'custom' }`
- **POST `/api/sync/custom/match`** — матчинг custom артистов.
- **POST `/api/sync/custom/push`** — push custom артистов в Lidarr.
- **POST `/api/sync/yandex/pull-all`** — полный Pull.
- **POST `/api/sync/yandex/match`** — матчинг Yandex.
- **POST `/api/sync/yandex/push`** — push Yandex.

### Runs внутри `/sync`

- **GET `/api/sync/runs`** — последние прогоны.
- **GET `/api/sync/runs/:id`** — детали.
- **GET `/api/sync/runs/:id/logs`** — логи.
- **POST `/api/sync/runs/:id/stop`** — мягкая остановка.

---

## Runs & Logs

Дублируются **и без `/api`**, и с `/api`.

- **GET `/runs?limit=…`** / **GET `/api/runs?limit=…`** — список запусков (`limit` по умолчанию 20, clamp 1..200).
- **GET `/runs/latest`** / **GET `/api/runs/latest`** — последний запуск.
- **GET `/runs/:id`** / **GET `/api/runs/:id`** — детали запуска.
- **GET `/runs/:id/logs?after=…&limit=…`** / **GET `/api/runs/:id/logs?...`** — логи (limit clamp 1..500).
- **POST `/runs/:id/stop`** / **POST `/api/runs/:id/stop`** — мягкая остановка (cancel=true).

> 🔒 Для UI стабильные пути:
> - `GET /api/runs?limit=30`
> - `GET /api/runs/:id/logs`
> - `GET /api/stats`

---

## Jackett Indexers

- **GET `/api/jackett/indexers`** — список (apiKey маскируется).
- **POST `/api/jackett/indexers`** — создать (`baseUrl`, `apiKey`).
- **PUT `/api/jackett/indexers/:id`** — обновить (пустой apiKey не перезатирает сохранённый).
- **DELETE `/api/jackett/indexers/:id`** — удалить.
- **POST `/api/jackett/indexers/:id/test`** — test `caps` (можно временно передать `baseUrl`/`apiKey`).

---

## Torrents

### Tasks

- **POST `/api/torrents/tasks`** — создать/обновить задачу (`kind=artist|album` + поля).
- **GET `/api/torrents/tasks`** — список задач (status/page/pageSize/q/sortField/sortDir).
- **GET `/api/torrents/tasks/:id`** — получить задачу.
- **PATCH `/api/torrents/tasks/:id/status`** — выставить статус вручную.  
  Body: `{ status, lastError?, startedAt?, finishedAt?, qbitHash? }`

### Releases

- **POST `/api/torrents/tasks/:id/releases`** — bulk upsert релизов.
- **GET `/api/torrents/tasks/:id/releases`** — список релизов.
- **POST `/api/torrents/tasks/:id/search`** — поиск через Jackett.  
  Body: `{ limitPerIndexer? }`
- **POST `/api/torrents/tasks/:id/pick`** — выбрать лучший релиз.  
  Body: `{ commit?: boolean }`
- **POST `/api/torrents/tasks/:id/add`** — добавить в qBittorrent.  
  Body: `{ releaseId?, savePath?, autoStart?, tags? }`

### Файловые операции и qBittorrent

- **POST `/api/torrents/tasks/:id/move`** — relocate в финальный путь (единично).
- **POST `/api/torrents/tasks/:id/copy`** — copy downloaded (единично).
- **GET `/api/torrents/tasks/:id/qbt`** — обновить/вернуть статус из qBittorrent.

- **POST `/api/torrents/qbt/webhook?secret=…`** — webhook от qBittorrent (`secret` также в `X-QBT-Secret`).
- **POST `/api/torrents/qbt/relocate`** — пакетный relocate. Body: `{ batchSize? }`
- **POST `/api/torrents/qbt/copy-downloaded`** — пакетный copy downloaded. Body: `{ batchSize? }`
- **POST `/api/torrents/qbt/poll`** — пакетный poll. Body: `{ batchSize? }`

---

## Pipeline

- **POST `/api/pipeline/plan-unmatched`** — подготовить кандидатов.  
  Body: `{ limit?: number }` (default 100, clamp 1..500)
- **POST `/api/pipeline/run-unmatched`** — запустить обработку unmatched (пайплайн).

---

## Navidrome

На роут навешан rate-limit.

- **POST `/api/navidrome/plan`** — построить план изменений.
- **POST `/api/navidrome/apply`** — применить план (асинхронно через run).  
  Body: `{ dryRun?: boolean, target?: 'artists'|'albums'|'tracks'|'all', ...creds }`
- **POST `/api/navidrome/test`** — проверить авторизацию и info/version.

---

## Webhooks

- **POST `/api/webhooks/lidarr?secret=…`** — webhook от Lidarr (403 при неверном secret, если secret задан в settings).  
  Обрабатывает import-события и удаляет торрент в qBittorrent по infohash (с учётом deleteFiles).

---

## Debug

- **GET `/api/debug/qbt/ping`** — диагностика доступности qBittorrent (webapiVersion) по `QBT_URL`.
