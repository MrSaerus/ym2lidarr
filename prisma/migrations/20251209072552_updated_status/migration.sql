-- AlterTable
ALTER TABLE "TorrentTask" ADD COLUMN "layout" TEXT DEFAULT 'unknown';

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
    "status" TEXT NOT NULL DEFAULT 'new',
    CONSTRAINT "TorrentRelease_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TorrentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorrentRelease_indexerId_fkey" FOREIGN KEY ("indexerId") REFERENCES "JackettIndexer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TorrentRelease" ("createdAt", "id", "indexerId", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title", "updatedAt") SELECT "createdAt", "id", "indexerId", "leechers", "link", "magnet", "pubDate", "quality", "score", "seeders", "size", "taskId", "title", "updatedAt" FROM "TorrentRelease";
DROP TABLE "TorrentRelease";
ALTER TABLE "new_TorrentRelease" RENAME TO "TorrentRelease";
CREATE INDEX "TorrentRelease_taskId_idx" ON "TorrentRelease"("taskId");
CREATE INDEX "TorrentRelease_indexerId_idx" ON "TorrentRelease"("indexerId");
CREATE INDEX "TorrentRelease_seeders_score_idx" ON "TorrentRelease"("seeders", "score");
CREATE INDEX "TorrentRelease_pubDate_idx" ON "TorrentRelease"("pubDate");
CREATE UNIQUE INDEX "TorrentRelease_taskId_magnet_key" ON "TorrentRelease"("taskId", "magnet");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
