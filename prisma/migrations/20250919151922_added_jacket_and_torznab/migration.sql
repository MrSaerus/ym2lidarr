-- CreateTable
CREATE TABLE "TorrentTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "artistId" INTEGER,
    "albumId" INTEGER,
    "query" TEXT,
    "status" TEXT NOT NULL,
    "qbitHash" TEXT,
    "indexer" TEXT,
    "title" TEXT,
    "size" BIGINT,
    "seeders" INTEGER,
    "quality" TEXT,
    "finalPath" TEXT,
    "movePolicy" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "TorrentRelease" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "indexer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "magnet" TEXT,
    "size" BIGINT,
    "seeders" INTEGER,
    "leechers" INTEGER,
    "pubDate" DATETIME,
    "quality" TEXT,
    "score" REAL NOT NULL,
    CONSTRAINT "TorrentRelease_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TorrentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "enableCronYandexPull" BOOLEAN NOT NULL DEFAULT false,
    "enableCronYandexMatch" BOOLEAN NOT NULL DEFAULT false,
    "enableCronYandexPush" BOOLEAN NOT NULL DEFAULT false,
    "enableCronCustomMatch" BOOLEAN NOT NULL DEFAULT false,
    "enableCronCustomPush" BOOLEAN NOT NULL DEFAULT false,
    "enableCronLidarrPull" BOOLEAN NOT NULL DEFAULT false,
    "enableCronNavidromePush" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "matchRetryDays" INTEGER NOT NULL DEFAULT 3,
    "allowRepush" BOOLEAN NOT NULL DEFAULT false,
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
    "jackettEnabled" BOOLEAN NOT NULL DEFAULT false,
    "jackettBaseUrl" TEXT,
    "jackettApiKey" TEXT,
    "jackettCategories" JSONB,
    "jackettTimeoutMs" INTEGER DEFAULT 15000,
    "jackettRateLimitPerIndexer" REAL DEFAULT 1.0
);
INSERT INTO "new_Setting" ("allowRepush", "backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronCustomMatch", "cronCustomPush", "cronLidarr", "cronLidarrPull", "cronNavidromePush", "cronYandex", "cronYandexMatch", "cronYandexPull", "cronYandexPush", "enableCronCustomMatch", "enableCronCustomPush", "enableCronLidarrPull", "enableCronNavidromePush", "enableCronYandexMatch", "enableCronYandexPull", "enableCronYandexPush", "enableExport", "enablePush", "exportPath", "id", "lidarrAllowNoMetadata", "lidarrApiKey", "lidarrCron", "lidarrPullTarget", "lidarrUrl", "likesPolicySourcePriority", "matchRetryDays", "metadataProfileId", "mode", "monitor", "navidromePass", "navidromeSalt", "navidromeSyncTarget", "navidromeToken", "navidromeUrl", "navidromeUser", "notifyType", "pushTarget", "pyproxyUrl", "qbtDeleteFiles", "qbtPass", "qbtUrl", "qbtUser", "qbtWebhookSecret", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexMatchTarget", "yandexPushTarget", "yandexToken") SELECT "allowRepush", "backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronCustomMatch", "cronCustomPush", "cronLidarr", "cronLidarrPull", "cronNavidromePush", "cronYandex", "cronYandexMatch", "cronYandexPull", "cronYandexPush", "enableCronCustomMatch", "enableCronCustomPush", "enableCronLidarrPull", "enableCronNavidromePush", "enableCronYandexMatch", "enableCronYandexPull", "enableCronYandexPush", "enableExport", "enablePush", "exportPath", "id", "lidarrAllowNoMetadata", "lidarrApiKey", "lidarrCron", "lidarrPullTarget", "lidarrUrl", "likesPolicySourcePriority", "matchRetryDays", "metadataProfileId", "mode", "monitor", "navidromePass", "navidromeSalt", "navidromeSyncTarget", "navidromeToken", "navidromeUrl", "navidromeUser", "notifyType", "pushTarget", "pyproxyUrl", "qbtDeleteFiles", "qbtPass", "qbtUrl", "qbtUser", "qbtWebhookSecret", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexMatchTarget", "yandexPushTarget", "yandexToken" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TorrentTask_qbitHash_key" ON "TorrentTask"("qbitHash");

-- CreateIndex
CREATE INDEX "TorrentTask_status_idx" ON "TorrentTask"("status");

-- CreateIndex
CREATE INDEX "TorrentTask_artistId_idx" ON "TorrentTask"("artistId");

-- CreateIndex
CREATE INDEX "TorrentTask_albumId_idx" ON "TorrentTask"("albumId");

-- CreateIndex
CREATE INDEX "TorrentRelease_taskId_idx" ON "TorrentRelease"("taskId");
