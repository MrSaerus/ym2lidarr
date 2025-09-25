-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JackettIndexer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowRss" BOOLEAN NOT NULL DEFAULT true,
    "allowAuto" BOOLEAN NOT NULL DEFAULT true,
    "allowInteractive" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "categories" JSONB,
    "tags" TEXT,
    "minSeeders" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "tempDisabledUntil" DATETIME
);
INSERT INTO "new_JackettIndexer" ("allowAuto", "allowInteractive", "allowRss", "apiKey", "baseUrl", "categories", "createdAt", "enabled", "id", "minSeeders", "name", "order", "tags", "updatedAt") SELECT "allowAuto", "allowInteractive", "allowRss", "apiKey", "baseUrl", "categories", "createdAt", "enabled", "id", "minSeeders", "name", "order", "tags", "updatedAt" FROM "JackettIndexer";
DROP TABLE "JackettIndexer";
ALTER TABLE "new_JackettIndexer" RENAME TO "JackettIndexer";
CREATE INDEX "JackettIndexer_enabled_order_idx" ON "JackettIndexer"("enabled", "order");
CREATE INDEX "JackettIndexer_name_idx" ON "JackettIndexer"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
