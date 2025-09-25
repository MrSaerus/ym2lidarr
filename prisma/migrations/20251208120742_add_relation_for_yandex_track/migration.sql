-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
