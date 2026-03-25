**YM2LIDARR**

[![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/11085/badge)](https://bestpractices.coreinfrastructure.org/projects/11085)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/MrSaerus/ym2lidarr/badge)](https://securityscorecards.dev/viewer/?uri=github.com/MrSaerus/ym2lidarr)
[![GitHub Release](https://img.shields.io/github/v/release/MrSaerus/ym2lidarr?sort=semver&label=Release%20latest)](https://github.com/MrSaerus/ym2lidarr/releases)
[![Release](https://github.com/MrSaerus/ym2lidarr/actions/workflows/release.yml/badge.svg)](https://github.com/MrSaerus/ym2lidarr/actions/workflows/release.yml)
[![Tests (unit)](https://github.com/MrSaerus/ym2lidarr/actions/workflows/tests-unit.yml/badge.svg?branch=main)](https://github.com/MrSaerus/ym2lidarr/actions/workflows/tests-unit.yml)

## Docker
[![YM2LIDARR-API](https://badgen.net/docker/size/saerus/ym2lidarr-api?icon=docker&label=API)](https://hub.docker.com/r/saerus/ym2lidarr-api/)
[![YM2LIDARR-WEB](https://badgen.net/docker/size/saerus/ym2lidarr-web?icon=docker&label=WEB)](https://hub.docker.com/r/saerus/ym2lidarr-web/)
[![YM2LIDARR-PyPROXY](https://badgen.net/docker/size/saerus/ym2lidarr-pyproxy?icon=docker&label=PyPROXY)](https://hub.docker.com/r/saerus/ym2lidarr-pyproxy/)
[![YM2LIDARR-SINGLE](https://badgen.net/docker/size/saerus/ym2lidarr-single?icon=docker&label=SINGLE)](https://hub.docker.com/r/saerus/ym2lidarr-single/)

## Описание:
Сервис YM2Lidarr автоматизирует наполнение и сопровождение музыкальной библиотеки, связывая Yandex Music, Lidarr и загрузку через торрент-пайплайн.

## Ключевые возможности:

* Синхронизация каталога: загрузка списков артистов и альбомов из Yandex Music в Lidarr.
* Хранение локального кэша и актуализация данных по расписанию.
* Сопоставление сущностей между Yandex и Lidarr.
* Отправка подобранных артистов и альбомов в Lidarr. 
* Синхронизация лайков из Yandex Music в Navidrome.
* beta Создание задач для артистов и альбомов для поиск релизов через Jackett/torznab, выбор релиза, добавление в qBittorrent, обновление статусов, копирование скачанного.
* beta Нарезка скачанных альбомов через CUE.

![Index](DOC/images/main_short.png)


## Архитектура

- **web** — Next.js 14, UI и настройка.
- **api** — Express + Prisma, вся логика, cron, экспорт, нотификации.
- **pyproxy** — FastAPI, безопасная работа с ЯМ (обходит SmartCaptcha).

## Интерфейс
- **Overview** — общая статистика, запуск синка/пуша.
- **Found** — сматченные артисты/альбомы (ссылки на MB и YM).
- **Unmatched** — не сматченные, кандидаты c подсветкой, ссылки на MB/YM.
- **Live Logs** — логи текущего/последнего запуска, онлайн-обновление.
- **Settings** — все настройки, тесты коннектов, запуск бэкапа, ссылки на экспорт.

## Подробная документация

[Оглавление документации](DOC/index.md)

## Быстрый старт (Docker)
Требуется Docker и docker compose v2.

```bash

# Склонировать
git clone https://github.com/MrSaerus/ym2lidarr.git
cd ym2lidarr

# Есть 4 врианта запуска

# 1.Сборка и запуск 3 микросервисов
docker compose -f docker-compose.build.yml build && \
docker compose -f docker-compose.build.yml up -d

# 2. Запуск уже собранных образов
docker compose up -d

# 3.Сборка и запуск 3 микросервисов в одном контейнере
docker compose -f docker-compose.build.single.yml build && \
docker compose -f docker-compose.build.single.yml up -d

# 4.Запуск уже собранного образа
docker compose -f docker-compose.single.yml -d


# web: http://localhost:3000
# api: http://localhost:4000/health
# pyproxy: http://localhost:8080/health
```


Основные переменные прописаны в docker-compose, а все остальные задаются в разделе настроек


## Contributing

- **PR приветствуются**: багфиксы, улучшения UI, новые драйверы, доп. форматы экспорта.
- **Перед PR**: `npm i`, `npx prisma generate`, линт, сборка web/api, быстрый прогон в docker compose.