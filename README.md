**YM → Lidarr**

Сервис, который забирает **лайки из Яндекс.Музыки** и отправляет их в **Lidarr** (кастом-лист артистов или релиз-группы альбомов).
В комплекте: веб-интерфейс, API, Python-прокси для ЯМ, SQLite/Prisma, планировщик, бэкапы, экспорт в JSON/CSV/MD, нотификации и live-логи.

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
│        │
│        ├──> MusicBrainz API
│        └──> Lidarr API
│
└──> PyProxy (FastAPI, 8080) ──> Yandex Music
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

**Пример** `docker-compose.yml` **(укороченный)**

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
Чтобы не долбить MB без смысла, повторный матчинг пропускается в течение MB_RECHECK_HOURS (по умолчанию 168 часов / 7 дней).
Можно принудительно запустить Run (force) — игнорирует cool-down.

🔗 **API (основное)**

- GET /health — healthcheck API.
- GET /api/stats — сводка для Overview (artists/albums + last/active runs).
- GET /api/overview — алиас со схожим содержимым.
- **Списки**
  - GET /api/found?type=artists|albums&limit&offset
  - GET /api/unmatched?type=artists|albums&limit&offset
- **Синхронизация**
  - POST /api/sync/yandex — { force?: boolean }
  - POST /api/sync/lidarr
- **Логи и прогоны**
  - GET /api/runs/:id
  - GET /api/runs/:id/logs?after=0&limit=200
- **Экспорт**
  - GET /api/export/artists.json|csv|md
  - GET /api/export/albums.json|csv|md
- **Backup**
  - POST /api/backup/run
  - GET /api/backup/list
- **Настройки**
  - GET /api/settings
  - POST /api/settings — сохраняет все поля
  - POST /api/settings/test/yandex — проверка токена ЯМ
  - POST /api/settings/test/lidarr — проверка коннекта к Lidarr

🔐 **Переменные окружения**
| Переменная | Назначение | Пример |
| --- | --- | --- |
| DATABASE_URL | путь к SQLite для Prisma | file:/app/data/app.db |
| YA_PYPROXY_URL | URL Python-прокси | http://pyproxy:8080 |
| YANDEX_MUSIC_TOKEN | (опц.) токен ЯМ по умолчанию | y0_AgAAA...|
| YM_TOKEN | (опц.) альтернативное имя токена ЯМ | |
| MB_RECHECK_HOURS | кулдаун рематчинга в часах | 168 |
| NEXT_PUBLIC_API_BASE | базовый URL API для фронта | http://localhost:4000 |

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

🗂️ **Структура репозитория (важное)**

```bash
apps/
  api/        # Node.js API (Express, Prisma)
    src/
      routes/ (settings, sync, export, stats/overview, found, unmatched, runs, backup)
      services/ (yandex, mb, lidarr, notify)
      scheduler.ts
      workers.ts
      log.ts
      prisma.ts
  web/        # Next.js UI (pages: index, found, unmatched, logs, settings)
  pyproxy/    # FastAPI для Яндекс.Музыки
prisma/
  schema.prisma
docker/
  api.Dockerfile
  web.Dockerfile

```

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