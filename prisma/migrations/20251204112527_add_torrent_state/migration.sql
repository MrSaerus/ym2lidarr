-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "yandexArtistId" TEXT,
    "rgMbid" TEXT,
    "ndId" TEXT,
    CONSTRAINT "YandexAlbum_yandexArtistId_fkey" FOREIGN KEY ("yandexArtistId") REFERENCES "YandexArtist" ("ymId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_YandexAlbum" ("artist", "createdAt", "id", "key", "lastSeenAt", "mbLastCheckedAt", "ndId", "present", "raw", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "yandexArtistId", "year", "ymId") SELECT "artist", "createdAt", "id", "key", "lastSeenAt", "mbLastCheckedAt", "ndId", "present", "raw", "rgMbid", "title", "updatedAt", "yGone", "yGoneAt", "yandexArtistId", "year", "ymId" FROM "YandexAlbum";
DROP TABLE "YandexAlbum";
ALTER TABLE "new_YandexAlbum" RENAME TO "YandexAlbum";
CREATE UNIQUE INDEX "YandexAlbum_ymId_key" ON "YandexAlbum"("ymId");
CREATE INDEX "YandexAlbum_title_idx" ON "YandexAlbum"("title");
CREATE INDEX "YandexAlbum_present_idx" ON "YandexAlbum"("present");
CREATE INDEX "YandexAlbum_yandexArtistId_idx" ON "YandexAlbum"("yandexArtistId");
CREATE INDEX "YandexAlbum_rgMbid_idx" ON "YandexAlbum"("rgMbid");
CREATE INDEX "YandexAlbum_ndId_idx" ON "YandexAlbum"("ndId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
