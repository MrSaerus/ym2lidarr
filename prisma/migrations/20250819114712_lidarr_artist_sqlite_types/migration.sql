-- CreateTable
CREATE TABLE "LidarrArtist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mbid" TEXT,
    "name" TEXT NOT NULL,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "path" TEXT,
    "added" DATETIME,
    "albums" INTEGER,
    "tracks" INTEGER,
    "sizeOnDisk" REAL,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LidarrArtist_name_idx" ON "LidarrArtist"("name");

-- CreateIndex
CREATE INDEX "LidarrArtist_mbid_idx" ON "LidarrArtist"("mbid");

-- CreateIndex
CREATE INDEX "LidarrArtist_monitored_idx" ON "LidarrArtist"("monitored");

-- CreateIndex
CREATE INDEX "LidarrArtist_added_idx" ON "LidarrArtist"("added");

-- CreateIndex
CREATE INDEX "LidarrArtist_sizeOnDisk_idx" ON "LidarrArtist"("sizeOnDisk");
