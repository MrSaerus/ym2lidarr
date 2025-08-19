-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lidarrAllowNoMetadata" BOOLEAN NOT NULL DEFAULT false,
    "yandexCron" TEXT,
    "lidarrCron" TEXT,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCron" TEXT,
    "backupRetention" INTEGER DEFAULT 14,
    "backupDir" TEXT,
    "notifyType" TEXT,
    "telegramBot" TEXT,
    "telegramChatId" TEXT,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "yandexDriver" TEXT DEFAULT 'pyproxy',
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronLidarr", "cronYandex", "enableExport", "enablePush", "exportPath", "id", "lidarrApiKey", "lidarrCron", "lidarrUrl", "metadataProfileId", "mode", "monitor", "notifyType", "pushTarget", "pyproxyUrl", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexToken") SELECT "backupCron", "backupDir", "backupEnabled", "backupRetention", "createdAt", "cronLidarr", "cronYandex", "enableExport", "enablePush", "exportPath", "id", "lidarrApiKey", "lidarrCron", "lidarrUrl", "metadataProfileId", "mode", "monitor", "notifyType", "pushTarget", "pyproxyUrl", "qualityProfileId", "rootFolderPath", "telegramBot", "telegramChatId", "updatedAt", "webhookSecret", "webhookUrl", "yandexCron", "yandexDriver", "yandexToken" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
