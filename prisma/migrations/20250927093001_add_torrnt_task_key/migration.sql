/*
  Warnings:

  - A unique constraint covering the columns `[taskKey]` on the table `TorrentTask` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "TorrentTask" ADD COLUMN "taskKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TorrentTask_taskKey_key" ON "TorrentTask"("taskKey");
