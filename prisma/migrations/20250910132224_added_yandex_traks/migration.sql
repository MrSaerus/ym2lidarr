-- CreateTable
CREATE TABLE "YandexTrack" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "YandexTrack_key_key" ON "YandexTrack"("key");
