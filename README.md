**YM → Lidarr**

Сервис, забирает **лайки из Яндекс.Музыки** и отправляет их в **Lidarr** (кастом-лист артистов или релиз-группы альбомов).

🚀 **Возможности**

- Сбор лайкнутых **треков/альбомов** из Яндекс.Музыки.
- Матчинг с **MusicBrainz** (артисты → MBID, альбомы → release-group MBID).
- **Push в Lidarr**: артисты (по умолчанию) или альбомы.
- Экспорт **JSON/CSV/MD** (прямо из БД, без файлов-кусков).
- Вкладки **Found / Unmatched** с кандидатами и ссылками на MB/Yandex Music.
- **Live Logs** — онлайновый просмотр логов текущего/последнего прогона.
- **Настройки во фронте**: токены/ключи, режимы, расписания, частоты.
- **Планировщик** (cron) для Яндекс-синка, Лидарр-пуша и бэкапов (вкл/выкл).
- **Бэкапы SQLite** (VACUUM INTO) с ротацией.
- **Нотификации** о завершении синка: Telegram или Webhook.
- **Health-checks** для всех компонентов (web/api/pyproxy).
- Всё хранится в **SQLite** (настройки, кэши, кандидаты, логи, результаты).

🧩 **Архитектура**

```
Next.js (web, 3000)  ──>  Node.js API (4000)  ──>  SQLite (Prisma)
```

- **web** — Next.js 14, UI и настройка.
- **api** — Express + Prisma, вся логика, cron, экспорт, нотификации.
- **pyproxy** — FastAPI, безопасная работа с ЯМ (обходит SmartCaptcha).

📦 **Быстрый старт (Docker)**
Требуется Docker и docker compose v2.

```bash

# 1) склонировать
git clone <repo>
cd <repo>

# 2) (опционально) задать переменные окружения в .env
cp .env.example .env

# 3) собрать и запустить
docker compose up -d --build

# web: http://localhost:3000
# api: http://localhost:4000/health
# pyproxy: http://localhost:8080/health
```

**Пример** `docker-compose.yml`

```yaml
services:
  api:
    build:
      context: .
      dockerfile: docker/api.Dockerfile
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/app.db
      - YA_PYPROXY_URL=http://pyproxy:8080
      - MB_RECHECK_HOURS=168
    ports:
      - '4000:4000'
    volumes:
      - db:/app/data
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:4000/health || exit 1']
      interval: 30s
      timeout: 5s
      retries: 3
    depends_on:
      - pyproxy

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    environment:
      - NEXT_PUBLIC_API_BASE=http://localhost:4000
      - NODE_ENV=production
    ports:
      - '3000:3000'
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:3000/health || exit 1']
      interval: 30s
      timeout: 5s
      retries: 3
    depends_on:
      - api

  pyproxy:
    build:
      context: apps/pyproxy
      dockerfile: Dockerfile
    ports:
      - '8080:8080'
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:8080/health || exit 1']
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  db:
```

🧑‍💻 **Локальная разработка**

Требуется Node.js ≥ 18.17 (рекомендуется 20.x) и npm.

```bash
npm i

# prisma
export DATABASE_URL="file:./data/app.db"
npx prisma generate
npx prisma migrate dev --name init

# dev-серверы (в разных терминалах):
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000

# pyproxy (python >= 3.10)
cd apps/pyproxy
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

В проде/в докере Prisma использует путь file:/app/data/app.db.

⚙️ **Настройки (во фронте)**
**Yandex Music**

- Driver: pyproxy (по умолчанию) или native. Рекомендуется pyproxy.
- PyProxy URL: например, http://pyproxy:8080.
- Yandex token: OAuth токен ЯМ.
- Sync cron (Yandex): CRON-выражение или пусто (отключено).

**Lidarr**

- Push target: artists (по умолчанию) или albums (release-groups).
- Lidarr URL: http://lidarr:8686
- Lidarr API key: ключ API.
- Sync cron (Lidarr push): CRON или пусто (отключено).

**Backups (SQLite)**

- Enabled: вкл/выкл.
- Cron: расписание бэкапа.
- Retention (files): сколько файлов держать.
- Directory: каталог бэкапов (по умолчанию /app/data/backups).
- Бэкап делает атомный снапшот через VACUUM INTO.

**Notifications**

- Type: none / telegram / webhook.
- Telegram:
  - Telegram Bot Token
  - Telegram Chat ID
- Webhook:
  - Webhook URL
  - Webhook Secret (опционально, для подписи HMAC-SHA256 в заголовке X-Signature).

🖥️ **Интерфейс**
**Overview** — общая статистика, запуск синка/пуша.
**Found** — сматченные артисты/альбомы (ссылки на MB и YM).
**Unmatched** — не сматченные, кандидаты c подсветкой, ссылки на MB/YM.
**Live Logs** — логи текущего/последнего запуска, онлайн-обновление.
**Settings** — все настройки, тесты коннектов, запуск бэкапа, ссылки на экспорт.

🔁 **Как это работает**

1. Сбор лайков у ЯМ через pyproxy (или native).
2. Из треков собираем артистов и альбомы (уникально).
3. Матчинг с MusicBrainz c кэшем и ограничением частоты запросов.
4. Сохранение результатов/кандидатов/кэша в SQLite.
5. Пуш в Lidarr (артисты/альбомы — настраивается).
6. Live-логирование в БД, нотификации о результате.

**Cool-down рематчинга**
Повторный матчинг пропускается в течение MB_RECHECK_HOURS (по умолчанию 168 часов / 7 дней).
Можно принудительно запустить Run (force) — игнорирует cool-down.

🔗 **API (основное)**

## **Системные**

**GET** `/api/health`
Проверка живости сервера и зависимостей.

**Ответ (200):**
```
{ "status": "ok", "uptimeSec": 12345, "version": "x.y.z", "now": "2025-08-16T10:00:00Z" }
```

**GET** `/api/stats` — ✅ зафиксировано
Агрегированная статистика по библиотеке/задачам.

**Ответ (200):**
```
{
"artists": 412,
"albums": 1890,
"tracks": 21543,
"unmatched": 238,
"lastRunAt": "2025-08-16T08:40:12Z",
"durations": { "syncMsP50": 8200, "syncMsP95": 19400 }
}
```
## **Запуски и логи**

**GET** `/api/runs?limit=30` — ✅ зафиксировано
Список последних запусков (sync/push/backup и т.п.).

**Ответ (200):**
```
[
{ "id": "run_01H...", "type": "yandex_sync", "startedAt": "2025-08-16T08:39:55Z", "status": "ok", "durationMs": 10422 },
{ "id": "run_01H...", "type": "lidarr_push", "startedAt": "2025-08-16T08:12:00Z", "status": "error", "durationMs": 3110 }
]
```

**GET** `/api/runs/:id`
Детали запуска. 

**Ответ (200):**
```
{ "id": "run_01H...", "type": "yandex_sync", "status": "ok", "metrics": { "found": 320, "unmatched": 12 } }
```

**GET** `/api/runs/:id/logs` — ✅ зафиксировано
Стрим/лента логов конкретного запуска.

**Ответ (200):**
```
[
{ "ts": "2025-08-16T08:40:01Z", "level": "info", "msg": "Login OK" },
{ "ts": "2025-08-16T08:40:04Z", "level": "info", "msg": "Fetched 250 tracks" }
]
```

## **Планировщик и воркеры**

**GET** `/api/scheduler`
Текущие cron-настройки задач.

**Ответ (200):**
```
{ "yandexSync": "0 */2 * * *", "lidarrPush": "15 */2 * * *", "backup": "0 3 * * *" }
```

**PUT** `/api/scheduler`
Обновление cron-масок.

**Body:**
```
{ "yandexSync": "*/30 * * * *" }
```

**GET** `/api/workers`
Статусы фоновых воркеров.

**Ответ (200):**
```
[
{ "name": "yandex", "running": true, "lastRun": "2025-08-16T08:40:12Z" },
{ "name": "lidarr", "running": true, "lastRun": "2025-08-16T08:12:45Z" },
{ "name": "backup", "running": false, "lastRun": "2025-08-15T03:00:11Z" }
]
```

**POST** `/api/workers/:name/start` `/ POST /api/workers/:name/stop`
**Запуск/остановка воркера.**

## **Синхронизация**

**POST** `/api/sync/yandex`
Запустить сбор библиотеки/плейлистов из Яндекс.Музыки.

*body (опц.):*
```
{ "playlists": ["liked", "custom:12345"], "fullRescan": false }
```

*Ответ (202):*
```
{ "runId": "run_01H..." }
```

**POST** `/api/sync/lidarr`
Запустить пуш результатов в Lidarr.

**Ответ (202):**
```
{ "runId": "run_01H..." }
```

**GET** `/api/sync/status`
Короткий статус последнего цикла sync→match→push.

**Ответ (200):**
```
{ "phase": "match", "progress": 0.42, "runId": "run_01H..." }
```

## **Данные библиотеки**

**GET** `/api/found`
Сопоставленные релизы/треки (есть MBID/Lidarr ID).
**Параметры:** `q`, `limit`, `offset`, `artistId`

**Ответ (200):**
```
{ "total": 320, "items": [ { "trackId": "y:123", "title": "Song", "mbid": "xxx", "lidarrId": 777 } ] }
```

**GET** `/api/unmatched`
Найдено в Я.Музыке, но без точного соответствия.

**Ответ (200):**
```
{ "total": 238, "items": [ { "trackId": "y:999", "title": "Unknown mix", "hints": ["artist: ...", "album: ..."] } ] }
```

**POST** `/api/unmatched/:trackId/match`
Ручное сопоставление.

**body:**
```
{ "mbid": "a1b2c3-..." }
```

**GET** `/api/export`
Выгрузка текущего состояния (CSV/JSON).
Параметры: `format=csv|json`

**Ответ (CSV)**: файл; **(JSON)**:
```
{ "exportedAt": "2025-08-16T08:45:00Z", "items": [ ... ] }
```

## **Настройки и интеграции**

**GET** `/api/settings`
Текущие настройки интеграций (без секретов).

**Ответ (200):**
```
{
"yandex": { "login": "user@example.com", "authorized": true },
"lidarr": { "url": "http://lidarr:8686", "connected": true }
}
```

**PUT** `/api/settings`
Обновление конфигурации.

**Body (прим.):**
```
{
"yandex": { "token": "ya_cookie_or_token" },
"lidarr": { "url": "http://localhost:8686", "apiKey": "XXXX" }
}
```

**POST** `/api/settings/test/yandex`
Проверка авторизации Яндекс.Музыка.

**Ответ (200):**
```
{ "ok": true, "profile": { "id": 12345, "name": "User" } }
```

**POST** `/api/settings/test/lidarr`
Проверка соединения с Lidarr.

*Ответ (200):*
```
{ "ok": true, "version": "2.3.1", "rootFolders": ["/music"] }
```

*POST* `/api/notify/test`
Тест уведомлений (если настроены).

*Ответ (200):*
```
{ "sent": true }
```

## **Бэкапы**

**POST** `/api/backup`
Создать резервную копию БД/состояния.

**Ответ (202):**
```
{ "runId": "run_01H..." }
```

*GET* `/api/backup`
Список бэкапов.

**Ответ (200):**
```
[
{ "id": "bkp_20250816_030000", "size": 1048576, "createdAt": "2025-08-16T03:00:00Z" }
]
```

**GET** `/api/backup/:id/download`
**Скачать архив бэкапа** (`application/zip`).

## **Поисковые прокси (MusicBrainz / Lidarr)**

**GET** `/api/mb/search`
Прокси по MusicBrainz для ручного матчинга.
**Параметры:** `entity=artist|release|recording`, `q`

**Ответ (200):**
```
{ "count": 3, "items": [ { "id": "mbid", "title": "..." } ] }
```

*GET* `/api/mb/release/:mbid`
Детали релиза MB.

**GET** `/api/lidarr/artists`
Список артистов в Lidarr (для выбора целей).

**Ответ (200):**
```
[ { "id": 777, "name": "Artist", "mbId": "..." } ]
```
## **Логи (общие)**

**GET** `/api/logs/latest?tail=200`

Последние N строк общесистемного лога.

**Ответ (200):**
```
{ "lines": ["[08:40:01] info ...", "..."] }
```
**Код ответа/ошибки (общие правила)**
- 200/201 — успешный ответ с данными.
- 202 — асинхронная задача создана; см. runId и читайте /api/runs/:id/logs.
- 400 — неверные параметры запроса.
- 401/403 — нет доступа (если включена авторизация).
- 404 — ресурс не найден.
- 409 — конфликт состояния (например, уже идёт синхронизация).
- 500 — внутренняя ошибка.

Примечание по «зафиксированным» путям

Эти пути менять нельзя (UI на них завязан):
- **GET** `/api/runs?limit=30`
- **GET** `/api/runs/:id/logs`
- **GET** `/api/stats`

🔐 **Переменные окружения**
| Переменная              | Назначение                                                     | Пример                                   |
|--------------------------|----------------------------------------------------------------|------------------------------------------|
| **PORT_API**             | Порт для запуска API                                          | `PORT_API=4000`                          |
| **YA_PYPROXY_URL**       | URL PyProxy-сервиса для проксирования запросов к Я.Музыке     | `YA_PYPROXY_URL=http://pyproxy:8081`     |
| **YANDEX_MUSIC_TOKEN**   | Основной токен доступа для Яндекс.Музыки                      | `YANDEX_MUSIC_TOKEN=Y0_AgAAA...`         |
| **YM_TOKEN**             | Альтернативное имя токена Яндекс.Музыки                       | `YM_TOKEN=Y0_AgAAA...`                   |
| **MB_RECHECK_HOURS**     | Кол-во часов для перепроверки сопоставлений MusicBrainz       | `MB_RECHECK_HOURS=168`                   |
| **YA_UA**                | Кастомный User-Agent для запросов к Яндекс.Музыке             | `YA_UA=MyApp/1.0 (Linux; x86_64)`        |
| **YA_CLIENT**            | Идентификатор клиента Яндекс.Музыки                           | `YA_CLIENT=Android/240213`               |
| **NEXT_PUBLIC_API_BASE** | Базовый URL API для фронтенда (Next.js, доступно в браузере)  | `NEXT_PUBLIC_API_BASE=https://host/api`  |


`Большинство настроек можно задать уже во фронте (Settings) — они сохраняются в SQLite.`

🧪 **Нотификации**

**Telegram**: сообщение о завершении синка (ok/error) с краткой статистикой.

**Webhook**: POST JSON вида:

```json
{
  "source": "yandex",
  "status": "ok",
  "runId": 123,
  "stats": { "...": "..." }
}
```

Если задан `webhookSecret`, добавляем заголовок `X-Signature: sha256=<HMAC>`.

🧰 **Траблшутинг**

- **403 SmartCaptcha от Яндекса**

      Используйте драйвер pyproxy (рекомендовано) и белый IP (не DC/VPN).

  В native возможны блоки со стороны ЯМ.

- **Next.js ругается на Node**

  Нужен Node ≥ 18.17 (лучше 20.x).

- **Prisma/SQLite/openssl в alpine-образах**

  Мы используем Debian-based образы. Если собираете своё — ставьте совместимый OpenSSL.

- **Пустые списки Found/Unmatched**

  Проверить, что синк прошёл (Overview → Run) и что фронт стучится в правильные роуты /api/found и /api/unmatched.

🤝 **Contributing**

**PR приветствуются**: багфиксы, улучшения UI, новые драйверы, доп. форматы экспорта.
**Перед PR**: `npm i`, `npx prisma generate`, линт, сборка web/api, быстрый прогон в docker compose.

🗺️ **Roadmap**

- Выборочное добавление кандидатов вручную (assign MBID/RG).
- Пакетные исправления/объединение дублей.
- Синх художников/альбомов из Lidarr обратно в ЯМ (идея).
- SSE/WebSocket для live-логов (вместо polling).
- Роли/доступы (если потребуется).
- поиск/фильтр по логам (artist/album/level),
- экспорт текущего лога (NDJSON/CSV),
- автосворачивание debug и переключатель “compact/verbose”,
- ретеншн для старых runs (очистка по количеству/возрасту),
- опционально: добавлю в “Artist skip” название трека — для этого расширю сбор лайков Я.Музыки до треков и буду логировать data.song.
- Онлайн обновление текущей статистики из базе на главной и в логах