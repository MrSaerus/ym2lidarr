-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Album" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "rgMbid" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mbCheckedAt" DATETIME,
    "mbAttempts" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Album" ("artist", "createdAt", "id", "key", "matched", "rgMbid", "title", "updatedAt", "year") SELECT "artist", "createdAt", "id", "key", "matched", "rgMbid", "title", "updatedAt", "year" FROM "Album";
DROP TABLE "Album";
ALTER TABLE "new_Album" RENAME TO "Album";
CREATE UNIQUE INDEX "Album_key_key" ON "Album"("key");
CREATE TABLE "new_Artist" (
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
INSERT INTO "new_Artist" ("createdAt", "id", "key", "matched", "mbid", "name", "updatedAt") SELECT "createdAt", "id", "key", "matched", "mbid", "name", "updatedAt" FROM "Artist";
DROP TABLE "Artist";
ALTER TABLE "new_Artist" RENAME TO "Artist";
CREATE UNIQUE INDEX "Artist_key_key" ON "Artist"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
