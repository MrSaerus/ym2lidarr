-- CreateTable
CREATE TABLE "AlbumPush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mbid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistName" TEXT,
    "path" TEXT,
    "lidarrAlbumId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "firstPushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL,
    "source" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "AlbumPush_mbid_key" ON "AlbumPush"("mbid");
