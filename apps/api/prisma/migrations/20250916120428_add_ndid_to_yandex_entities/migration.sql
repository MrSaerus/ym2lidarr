-- AlterTable
ALTER TABLE "YandexAlbum" ADD COLUMN "ndId" TEXT;

-- AlterTable
ALTER TABLE "YandexArtist" ADD COLUMN "ndId" TEXT;

-- CreateIndex
CREATE INDEX "YandexAlbum_ndId_idx" ON "YandexAlbum"("ndId");

-- CreateIndex
CREATE INDEX "YandexArtist_ndId_idx" ON "YandexArtist"("ndId");
