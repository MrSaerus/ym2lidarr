/*
  Warnings:

  - A unique constraint covering the columns `[kind,ymId]` on the table `YandexLikeSync` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "YandexLikeSync_kind_ymId_key" ON "YandexLikeSync"("kind", "ymId");
