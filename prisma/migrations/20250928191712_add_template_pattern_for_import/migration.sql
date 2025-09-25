-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "musicAlbumFolderPattern" TEXT DEFAULT '{Year} - {Album}';
ALTER TABLE "Setting" ADD COLUMN "musicArtistFolderPattern" TEXT DEFAULT '{Artist}';
ALTER TABLE "Setting" ADD COLUMN "musicDiscFolderPattern" TEXT DEFAULT 'Disc {Disc}';
ALTER TABLE "Setting" ADD COLUMN "musicTrackFilePattern" TEXT DEFAULT '{Track:2} - {Title}';
ALTER TABLE "Setting" ADD COLUMN "musicVariousArtistsName" TEXT DEFAULT 'Various Artists';

-- AlterTable
ALTER TABLE "TorrentTask" ADD COLUMN "albumTitle" TEXT;
ALTER TABLE "TorrentTask" ADD COLUMN "albumYear" INTEGER;
ALTER TABLE "TorrentTask" ADD COLUMN "artistName" TEXT;
