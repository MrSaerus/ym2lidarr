-- AlterTable
ALTER TABLE "TorrentTask" ADD COLUMN "ymAlbumId" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "ymArtistId" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "ymTrackId" TEXT;

-- CreateIndex
CREATE INDEX "TorrentTask_ymArtistId_idx" ON "TorrentTask"("ymArtistId");

-- CreateIndex
CREATE INDEX "TorrentTask_ymAlbumId_idx" ON "TorrentTask"("ymAlbumId");

-- CreateIndex
CREATE INDEX "TorrentTask_ymTrackId_idx" ON "TorrentTask"("ymTrackId");
