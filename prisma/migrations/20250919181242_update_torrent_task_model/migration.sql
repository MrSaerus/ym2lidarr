/*
  Warnings:

  - You are about to drop the column `indexer` on the `TorrentRelease` table. All the data in the column will be lost.
  - You are about to drop the column `indexer` on the `TorrentTask` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `TorrentRelease` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `TorrentTask` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TorrentRelease" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "indexerId" INTEGER,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "magnet" TEXT,
    "size" BIGINT,
    "seeders" INTEGER,
    "leechers" INTEGER,
    "pubDate" DATETIME,
    "quality" TEXT,
    "score" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TorrentRelease_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TorrentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorrentRelease_indexerId_fkey" FOREIGN KEY ("indexerId") REFERENCES "JackettIndexer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TorrentRelease" ("id", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title") SELECT "id", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title" FROM "TorrentRelease";
DROP TABLE "TorrentRelease";
ALTER TABLE "new_TorrentRelease" RENAME TO "TorrentRelease";
CREATE INDEX "TorrentRelease_taskId_idx" ON "TorrentRelease"("taskId");
CREATE INDEX "TorrentRelease_indexerId_idx" ON "TorrentRelease"("indexerId");
CREATE INDEX "TorrentRelease_seeders_score_idx" ON "TorrentRelease"("seeders", "score");
CREATE INDEX "TorrentRelease_pubDate_idx" ON "TorrentRelease"("pubDate");
CREATE UNIQUE INDEX "TorrentRelease_taskId_magnet_key" ON "TorrentRelease"("taskId", "magnet");
CREATE TABLE "new_TorrentTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "artistId" INTEGER,
    "albumId" INTEGER,
    "query" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "qbitHash" TEXT,
    "indexerId" INTEGER,
    "title" TEXT,
    "size" BIGINT,
    "seeders" INTEGER,
    "quality" TEXT,
    "finalPath" TEXT,
    "movePolicy" TEXT DEFAULT 'replace',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "minSeeders" INTEGER,
    "limitReleases" INTEGER,
    "scheduledAt" DATETIME,
    "lastTriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TorrentTask_indexerId_fkey" FOREIGN KEY ("indexerId") REFERENCES "JackettIndexer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TorrentTask" ("albumId", "artistId", "finalPath", "finishedAt", "id", "lastError", "movePolicy", "qbitHash", "quality", "query", "retries", "scope", "seeders", "size", "startedAt", "status", "title") SELECT "albumId", "artistId", "finalPath", "finishedAt", "id", "lastError", "movePolicy", "qbitHash", "quality", "query", "retries", "scope", "seeders", "size", "startedAt", "status", "title" FROM "TorrentTask";
DROP TABLE "TorrentTask";
ALTER TABLE "new_TorrentTask" RENAME TO "TorrentTask";
CREATE UNIQUE INDEX "TorrentTask_qbitHash_key" ON "TorrentTask"("qbitHash");
CREATE INDEX "TorrentTask_status_idx" ON "TorrentTask"("status");
CREATE INDEX "TorrentTask_artistId_idx" ON "TorrentTask"("artistId");
CREATE INDEX "TorrentTask_albumId_idx" ON "TorrentTask"("albumId");
CREATE INDEX "TorrentTask_indexerId_idx" ON "TorrentTask"("indexerId");
CREATE INDEX "TorrentTask_scheduledAt_idx" ON "TorrentTask"("scheduledAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
