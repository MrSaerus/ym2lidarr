/*
  Warnings:

  - A unique constraint covering the columns `[taskKey]` on the table `TorrentTask` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CustomArtist" ADD COLUMN "mbAlbumsCount" INTEGER;

-- AlterTable
ALTER TABLE "TorrentTask" ADD COLUMN "albumTitle" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "albumYear" INTEGER;
ALTER TABLE "TorrentTask" ADD COLUMN "artistName" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "layout" TEXT DEFAULT 'unknown';
ALTER TABLE "TorrentTask" ADD COLUMN "taskKey" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "ymAlbumId" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "ymArtistId" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "ymTrackId" TEXT;

-- AlterTable
ALTER TABLE "YandexArtist" ADD COLUMN "mbAlbumsCount" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JackettIndexer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowRss" BOOLEAN NOT NULL DEFAULT true,
    "allowAuto" BOOLEAN NOT NULL DEFAULT true,
    "allowInteractive" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "categories" JSONB,
    "tags" TEXT,
    "minSeeders" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "tempDisabledUntil" DATETIME
);
INSERT INTO "new_JackettIndexer" ("allowAuto", "allowInteractive", "allowRss", "apiKey", "baseUrl", "categories", "createdAt", "enabled", "id", "minSeeders", "name", "order", "tags", "updatedAt") SELECT "allowAuto", "allowInteractive", "allowRss", "apiKey", "baseUrl", "categories", "createdAt", "enabled", "id", "minSeeders", "name", "order", "tags", "updatedAt" FROM "JackettIndexer";
DROP TABLE "JackettIndexer";
ALTER TABLE "new_JackettIndexer" RENAME TO "JackettIndexer";
CREATE INDEX "JackettIndexer_enabled_order_idx" ON "JackettIndexer"("enabled", "order");
CREATE INDEX "JackettIndexer_name_idx" ON "JackettIndexer"("name");
CREATE TABLE "new_Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lidarrAllowNoMetadata" BOOLEAN NOT NULL DEFAULT false,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCron" TEXT,
    "backupRetention" INTEGER DEFAULT 14,
    "backupDir" TEXT,
    "notifyType" TEXT NOT NULL DEFAULT 'none',
    "telegramBot" TEXT,
    "telegramChatId" TEXT,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "yandexDriver" TEXT NOT NULL DEFAULT 'pyproxy',
    "pyproxyUrl" TEXT,
    "yandexToken" TEXT,
    "lidarrUrl" TEXT,
    "lidarrApiKey" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'artists',
    "pushTarget" TEXT NOT NULL DEFAULT 'artists',
    "enableExport" BOOLEAN NOT NULL DEFAULT true,
    "enablePush" BOOLEAN NOT NULL DEFAULT false,
    "exportPath" TEXT,
    "rootFolderPath" TEXT,
    "qualityProfileId" INTEGER,
    "metadataProfileId" INTEGER,
    "monitor" TEXT,
    "cronYandex" TEXT NOT NULL DEFAULT '0 */6 * * *',
    "cronLidarr" TEXT NOT NULL DEFAULT '0 3 * * *',
    "yandexCron" TEXT,
    "lidarrCron" TEXT,
    "cronCustomMatch" TEXT NOT NULL DEFAULT '0 0 * * *',
    "cronCustomPush" TEXT NOT NULL DEFAULT '0 12 * * *',
    "cronYandexPull" TEXT NOT NULL DEFAULT '0 */6 * * *',
    "cronYandexMatch" TEXT NOT NULL DEFAULT '10 */6 * * *',
    "cronYandexPush" TEXT NOT NULL DEFAULT '45 */6 * * *',
    "yandexMatchTarget" TEXT NOT NULL DEFAULT 'both',
    "yandexPushTarget" TEXT NOT NULL DEFAULT 'both',
    "cronLidarrPull" TEXT NOT NULL DEFAULT '0 3 * * *',
    "lidarrPullTarget" TEXT NOT NULL DEFAULT 'both',
    "cronTorrentRunUnmatched" TEXT NOT NULL DEFAULT '*/15 * * * *',
    "cronTorrentQbtPoll" TEXT NOT NULL DEFAULT '*/5 * * * *',
    "cronTorrentCopyDownloaded" TEXT NOT NULL DEFAULT '*/5 * * * *',
    "enableCronTorrentRunUnmatched" BOOLEAN NOT NULL DEFAULT false,
    "enableCronTorrentQbtPoll" BOOLEAN NOT NULL DEFAULT false,
    "enableCronTorrentCopyDownloaded" BOOLEAN NOT NULL DEFAULT false,
    "enableCronYandexPull" BOOLEAN NOT NULL DEFAULT false,
    "enableCronYandexMatch" BOOLEAN NOT NULL DEFAULT false,
    "enableCronYandexPush" BOOLEAN NOT NULL DEFAULT false,
    "enableCronCustomMatch" BOOLEAN NOT NULL DEFAULT false,
    "enableCronCustomPush" BOOLEAN NOT NULL DEFAULT false,
    "enableCronLidarrPull" BOOLEAN NOT NULL DEFAULT false,
    "enableCronNavidromePush" BOOLEAN NOT NULL DEFAULT false,
    "torrentRunUnmatchedLimit" INTEGER,
    "torrentRunUnmatchedMinSeeders" INTEGER,
    "torrentRunUnmatchedLimitPerIndexer" INTEGER,
    "torrentRunUnmatchedAutoStart" BOOLEAN DEFAULT false,
    "torrentRunUnmatchedParallelSearches" INTEGER,
    "torrentQbtPollBatchSize" INTEGER,
    "torrentCopyBatchSize" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "matchRetryDays" INTEGER NOT NULL DEFAULT 3,
    "allowRepush" BOOLEAN NOT NULL DEFAULT false,
    "torrentJackettQbtBaseUrl" TEXT,
    "torrentQbtCategory" TEXT NOT NULL DEFAULT 'YM2LIDARR',
    "qbtUrl" TEXT,
    "qbtUser" TEXT,
    "qbtPass" TEXT,
    "qbtDeleteFiles" BOOLEAN NOT NULL DEFAULT true,
    "qbtWebhookSecret" TEXT,
    "navidromeUrl" TEXT,
    "navidromeUser" TEXT,
    "navidromePass" TEXT,
    "navidromeToken" TEXT,
    "navidromeSalt" TEXT,
    "navidromeSyncTarget" TEXT,
    "likesPolicySourcePriority" TEXT,
    "cronNavidromePush" TEXT,
    "yandexMatchForce" BOOLEAN DEFAULT false,
    "customMatchForce" BOOLEAN DEFAULT false,
    "mbMatchForce" BOOLEAN DEFAULT false,
    "torrentDownloadsDir" TEXT DEFAULT '/home/Downloads',
    "musicLibraryDir" TEXT DEFAULT '/home/Music',
    "musicArtistFolderPattern" TEXT DEFAULT '{Artist}',
    "musicAlbumFolderPattern" TEXT DEFAULT '{Year} - {Album}',
    "musicTrackFilePattern" TEXT DEFAULT '{Track:2} - {Title}',
    "musicVariousArtistsName" TEXT DEFAULT 'Various Artists',
    "musicDiscFolderPattern" TEXT DEFAULT 'Disc {Disc}',
    "fileOpMode" TEXT DEFAULT 'copy',
    "copyInProgress" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Setting" ("allowRepush", "backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronCustomMatch", "cronCustomPush", "cronLidarr", "cronLidarrPull", "cronNavidromePush", "cronYandex", "cronYandexMatch", "cronYandexPull", "cronYandexPush", "enableCronCustomMatch", "enableCronCustomPush", "enableCronLidarrPull", "enableCronNavidromePush", "enableCronYandexMatch", "enableCronYandexPull", "enableCronYandexPush", "enableExport", "enablePush", "exportPath", "id", "lidarrAllowNoMetadata", "lidarrApiKey", "lidarrCron", "lidarrPullTarget", "lidarrUrl", "likesPolicySourcePriority", "matchRetryDays", "metadataProfileId", "mode", "monitor", "navidromePass", "navidromeSalt", "navidromeSyncTarget", "navidromeToken", "navidromeUrl", "navidromeUser", "notifyType", "pushTarget", "pyproxyUrl", "qbtDeleteFiles", "qbtPass", "qbtUrl", "qbtUser", "qbtWebhookSecret", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexMatchTarget", "yandexPushTarget", "yandexToken") SELECT "allowRepush", "backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronCustomMatch", "cronCustomPush", "cronLidarr", "cronLidarrPull", "cronNavidromePush", "cronYandex", "cronYandexMatch", "cronYandexPull", "cronYandexPush", "enableCronCustomMatch", "enableCronCustomPush", "enableCronLidarrPull", "enableCronNavidromePush", "enableCronYandexMatch", "enableCronYandexPull", "enableCronYandexPush", "enableExport", "enablePush", "exportPath", "id", "lidarrAllowNoMetadata", "lidarrApiKey", "lidarrCron", "lidarrPullTarget", "lidarrUrl", "likesPolicySourcePriority", "matchRetryDays", "metadataProfileId", "mode", "monitor", "navidromePass", "navidromeSalt", "navidromeSyncTarget", "navidromeToken", "navidromeUrl", "navidromeUser", "notifyType", "pushTarget", "pyproxyUrl", "qbtDeleteFiles", "qbtPass", "qbtUrl", "qbtUser", "qbtWebhookSecret", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexMatchTarget", "yandexPushTarget", "yandexToken" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE TABLE "new_TorrentRelease" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "indexerId" INTEGER,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "magnet" TEXT,
    "size" BIGINT,
    "seeders" INTEGER,
    "leechers" INTEGER,
    "pubDate" DATETIME,
    "quality" TEXT,
    "score" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    CONSTRAINT "TorrentRelease_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TorrentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorrentRelease_indexerId_fkey" FOREIGN KEY ("indexerId") REFERENCES "JackettIndexer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TorrentRelease" ("createdAt", "id", "indexerId", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title", "updatedAt") SELECT "createdAt", "id", "indexerId", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title", "updatedAt" FROM "TorrentRelease";
DROP TABLE "TorrentRelease";
ALTER TABLE "new_TorrentRelease" RENAME TO "TorrentRelease";
CREATE INDEX "TorrentRelease_taskId_idx" ON "TorrentRelease"("taskId");
CREATE INDEX "TorrentRelease_indexerId_idx" ON "TorrentRelease"("indexerId");
CREATE INDEX "TorrentRelease_seeders_score_idx" ON "TorrentRelease"("seeders", "score");
CREATE INDEX "TorrentRelease_pubDate_idx" ON "TorrentRelease"("pubDate");
CREATE UNIQUE INDEX "TorrentRelease_taskId_magnet_key" ON "TorrentRelease"("taskId", "magnet");
CREATE TABLE "new_YandexAlbum" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "year" INTEGER,
    "key" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" DATETIME,
    "yGone" BOOLEAN NOT NULL DEFAULT false,
    "yGoneAt" DATETIME,
    "raw" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mbLastCheckedAt" DATETIME,
    "torrentState" TEXT NOT NULL DEFAULT 'none',
    "genresJson" TEXT,
    "yandexArtistId" TEXT,
    "rgMbid" TEXT,
    "ndId" TEXT,
    CONSTRAINT "YandexAlbum_yandexArtistId_fkey" FOREIGN KEY ("yandexArtistId") REFERENCES "YandexArtist" ("ymId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_YandexAlbum" ("artist", "createdAt", "id", "key", "lastSeenAt", "ndId", "present", "raw", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "yandexArtistId", "year", "ymId") SELECT "artist", "createdAt", "id", "key", "lastSeenAt", "ndId", "present", "raw", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "yandexArtistId", "year", "ymId" FROM "YandexAlbum";
DROP TABLE "YandexAlbum";
ALTER TABLE "new_YandexAlbum" RENAME TO "YandexAlbum";
CREATE UNIQUE INDEX "YandexAlbum_ymId_key" ON "YandexAlbum"("ymId");
CREATE INDEX "YandexAlbum_title_idx" ON "YandexAlbum"("title");
CREATE INDEX "YandexAlbum_present_idx" ON "YandexAlbum"("present");
CREATE INDEX "YandexAlbum_yandexArtistId_idx" ON "YandexAlbum"("yandexArtistId");
CREATE INDEX "YandexAlbum_rgMbid_idx" ON "YandexAlbum"("rgMbid");
CREATE INDEX "YandexAlbum_ndId_idx" ON "YandexAlbum"("ndId");
CREATE TABLE "new_YandexTrack" (
    "ymId" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "durationSec" INTEGER,
    "key" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" DATETIME,
    "yGone" BOOLEAN NOT NULL DEFAULT false,
    "yGoneAt" DATETIME,
    "genresJson" TEXT,
    "ymAlbumId" TEXT,
    "ymArtistId" TEXT,
    "recMbid" TEXT,
    "rgMbid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YandexTrack_ymAlbumId_fkey" FOREIGN KEY ("ymAlbumId") REFERENCES "YandexAlbum" ("ymId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_YandexTrack" ("album", "artist", "createdAt", "durationSec", "key", "lastSeenAt", "present", "recMbid", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "ymAlbumId", "ymArtistId", "ymId") SELECT "album", "artist", "createdAt", "durationSec", "key", "lastSeenAt", "present", "recMbid", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "ymAlbumId", "ymArtistId", "ymId" FROM "YandexTrack";
DROP TABLE "YandexTrack";
ALTER TABLE "new_YandexTrack" RENAME TO "YandexTrack";
CREATE UNIQUE INDEX "YandexTrack_key_key" ON "YandexTrack"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TorrentTask_taskKey_key" ON "TorrentTask"("taskKey");

-- CreateIndex
CREATE INDEX "TorrentTask_ymArtistId_idx" ON "TorrentTask"("ymArtistId");

-- CreateIndex
CREATE INDEX "TorrentTask_ymAlbumId_idx" ON "TorrentTask"("ymAlbumId");

-- CreateIndex
CREATE INDEX "TorrentTask_ymTrackId_idx" ON "TorrentTask"("ymTrackId");
