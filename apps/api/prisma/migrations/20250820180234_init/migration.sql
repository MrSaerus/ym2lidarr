-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mbid" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mbCheckedAt" DATETIME,
    "mbAttempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Album" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "artist" TEXT,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "rgMbid" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mbCheckedAt" DATETIME,
    "mbAttempts" INTEGER NOT NULL DEFAULT 0,
    "artistId" INTEGER,
    CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YandexArtist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "raw" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mbid" TEXT
);

-- CreateTable
CREATE TABLE "YandexAlbum" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "year" INTEGER,
    "key" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "raw" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "yandexArtistId" TEXT,
    "rgMbid" TEXT,
    CONSTRAINT "YandexAlbum_yandexArtistId_fkey" FOREIGN KEY ("yandexArtistId") REFERENCES "YandexArtist" ("ymId") ON DELETE SET NULL ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "LidarrAlbum" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mbid" TEXT,
    "title" TEXT NOT NULL,
    "artistName" TEXT,
    "path" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "added" DATETIME,
    "sizeOnDisk" REAL,
    "tracks" INTEGER,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artistId" INTEGER,
    CONSTRAINT "LidarrAlbum_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "LidarrArtist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtistSourceLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT,
    "displayName" TEXT,
    "raw" TEXT,
    CONSTRAINT "ArtistSourceLink_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlbumSourceLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "albumId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT,
    "displayName" TEXT,
    "raw" TEXT,
    CONSTRAINT "AlbumSourceLink_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtistCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER,
    "normKey" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER,
    "kind" TEXT,
    "url" TEXT,
    "country" TEXT,
    "type" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ArtistCandidate_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlbumCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "albumId" INTEGER,
    "normKey" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "primaryType" TEXT,
    "firstReleaseDate" TEXT,
    "primaryArtist" TEXT,
    "score" INTEGER,
    "url" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AlbumCandidate_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MbSyncItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "targetId" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "ArtistPush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER,
    "mbid" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "lidarrArtistId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "firstPushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL,
    "source" TEXT
);

-- CreateTable
CREATE TABLE "AlbumPush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "albumId" INTEGER,
    "mbid" TEXT,
    "title" TEXT NOT NULL,
    "artistName" TEXT,
    "path" TEXT,
    "lidarrAlbumId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "firstPushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL,
    "source" TEXT
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" DATETIME,
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

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    CONSTRAINT "SyncLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_key_key" ON "Artist"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Album_key_key" ON "Album"("key");

-- CreateIndex
CREATE INDEX "Album_artistId_title_idx" ON "Album"("artistId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "YandexArtist_ymId_key" ON "YandexArtist"("ymId");

-- CreateIndex
CREATE INDEX "YandexArtist_name_idx" ON "YandexArtist"("name");

-- CreateIndex
CREATE INDEX "YandexArtist_present_idx" ON "YandexArtist"("present");

-- CreateIndex
CREATE INDEX "YandexArtist_mbid_idx" ON "YandexArtist"("mbid");

-- CreateIndex
CREATE UNIQUE INDEX "YandexAlbum_ymId_key" ON "YandexAlbum"("ymId");

-- CreateIndex
CREATE INDEX "YandexAlbum_title_idx" ON "YandexAlbum"("title");

-- CreateIndex
CREATE INDEX "YandexAlbum_present_idx" ON "YandexAlbum"("present");

-- CreateIndex
CREATE INDEX "YandexAlbum_yandexArtistId_idx" ON "YandexAlbum"("yandexArtistId");

-- CreateIndex
CREATE INDEX "YandexAlbum_rgMbid_idx" ON "YandexAlbum"("rgMbid");

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

-- CreateIndex
CREATE INDEX "LidarrArtist_removed_idx" ON "LidarrArtist"("removed");

-- CreateIndex
CREATE INDEX "LidarrAlbum_title_idx" ON "LidarrAlbum"("title");

-- CreateIndex
CREATE INDEX "LidarrAlbum_artistName_idx" ON "LidarrAlbum"("artistName");

-- CreateIndex
CREATE INDEX "LidarrAlbum_mbid_idx" ON "LidarrAlbum"("mbid");

-- CreateIndex
CREATE INDEX "LidarrAlbum_removed_idx" ON "LidarrAlbum"("removed");

-- CreateIndex
CREATE INDEX "LidarrAlbum_artistId_idx" ON "LidarrAlbum"("artistId");

-- CreateIndex
CREATE INDEX "ArtistSourceLink_artistId_source_idx" ON "ArtistSourceLink"("artistId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistSourceLink_source_externalId_key" ON "ArtistSourceLink"("source", "externalId");

-- CreateIndex
CREATE INDEX "AlbumSourceLink_albumId_source_idx" ON "AlbumSourceLink"("albumId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumSourceLink_source_externalId_key" ON "AlbumSourceLink"("source", "externalId");

-- CreateIndex
CREATE INDEX "ArtistCandidate_artistId_idx" ON "ArtistCandidate"("artistId");

-- CreateIndex
CREATE INDEX "ArtistCandidate_source_score_idx" ON "ArtistCandidate"("source", "score");

-- CreateIndex
CREATE INDEX "ArtistCandidate_externalId_idx" ON "ArtistCandidate"("externalId");

-- CreateIndex
CREATE INDEX "AlbumCandidate_albumId_idx" ON "AlbumCandidate"("albumId");

-- CreateIndex
CREATE INDEX "AlbumCandidate_source_score_idx" ON "AlbumCandidate"("source", "score");

-- CreateIndex
CREATE INDEX "AlbumCandidate_externalId_idx" ON "AlbumCandidate"("externalId");

-- CreateIndex
CREATE INDEX "MbSyncItem_kind_lastCheckedAt_idx" ON "MbSyncItem"("kind", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MbSyncItem_kind_targetId_key" ON "MbSyncItem"("kind", "targetId");

-- CreateIndex
CREATE INDEX "ArtistPush_status_lastCheckedAt_idx" ON "ArtistPush"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "ArtistPush_lidarrArtistId_idx" ON "ArtistPush"("lidarrArtistId");

-- CreateIndex
CREATE INDEX "ArtistPush_artistId_idx" ON "ArtistPush"("artistId");

-- CreateIndex
CREATE INDEX "AlbumPush_status_lastCheckedAt_idx" ON "AlbumPush"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "AlbumPush_lidarrAlbumId_idx" ON "AlbumPush"("lidarrAlbumId");

-- CreateIndex
CREATE INDEX "AlbumPush_albumId_idx" ON "AlbumPush"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "CacheEntry_key_key" ON "CacheEntry"("key");

-- CreateIndex
CREATE INDEX "CacheEntry_scope_idx" ON "CacheEntry"("scope");

-- CreateIndex
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "SyncRun_kind_status_startedAt_idx" ON "SyncRun"("kind", "status", "startedAt");

-- CreateIndex
CREATE INDEX "SyncLog_runId_ts_idx" ON "SyncLog"("runId", "ts");

-- CreateIndex
CREATE INDEX "SyncLog_level_ts_idx" ON "SyncLog"("level", "ts");
