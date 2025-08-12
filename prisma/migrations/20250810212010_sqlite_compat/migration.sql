-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
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

-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mbid" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ArtistCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "mbid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER,
    "type" TEXT,
    "country" TEXT,
    "url" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ArtistCandidate_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Album" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "key" TEXT NOT NULL,
    "rgMbid" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AlbumCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "albumId" INTEGER NOT NULL,
    "rgMbid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "primaryType" TEXT,
    "firstReleaseDate" TEXT,
    "primaryArtist" TEXT,
    "score" INTEGER,
    "url" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AlbumCandidate_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "stats" TEXT,
    "message" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_key_key" ON "Artist"("key");

-- CreateIndex
CREATE INDEX "ArtistCandidate_artistId_idx" ON "ArtistCandidate"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_key_key" ON "Album"("key");

-- CreateIndex
CREATE INDEX "AlbumCandidate_albumId_idx" ON "AlbumCandidate"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "CacheEntry_key_key" ON "CacheEntry"("key");
