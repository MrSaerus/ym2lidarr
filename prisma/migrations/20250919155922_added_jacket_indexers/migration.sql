-- CreateTable
CREATE TABLE "JackettIndexer" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "JackettIndexer_enabled_order_idx" ON "JackettIndexer"("enabled", "order");

-- CreateIndex
CREATE INDEX "JackettIndexer_name_idx" ON "JackettIndexer"("name");
