## Настройки (во фронте)
### [К оглавлению](index.md)

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