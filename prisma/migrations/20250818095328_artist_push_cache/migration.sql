-- CreateTable
CREATE TABLE "ArtistPush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mbid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "lidarrArtistId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "firstPushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL,
    "source" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistPush_mbid_key" ON "ArtistPush"("mbid");
