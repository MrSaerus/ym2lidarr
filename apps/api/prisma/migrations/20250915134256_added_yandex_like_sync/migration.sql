-- CreateTable
CREATE TABLE "YandexLikeSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "ymId" TEXT,
    "key" TEXT,
    "ndId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'yandex',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTriedAt" DATETIME,
    "lastError" TEXT,
    "starredAt" DATETIME,
    "unstarredAt" DATETIME,
    "starRunId" INTEGER,
    "unstarRunId" INTEGER,
    CONSTRAINT "YandexLikeSync_ymId_fkey" FOREIGN KEY ("ymId") REFERENCES "YandexTrack" ("ymId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "YandexLikeSync_status_lastTriedAt_idx" ON "YandexLikeSync"("status", "lastTriedAt");

-- CreateIndex
CREATE INDEX "YandexLikeSync_kind_ymId_idx" ON "YandexLikeSync"("kind", "ymId");
