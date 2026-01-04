// apps/api/src/services/torrents/types.ts
export type TorrentLayout =
  | 'invalid'
  | 'simpleAlbum'
  | 'multiAlbum'
  | 'singleFileCue'
  | 'multiFileCue'
  | 'multiAlbumCue';

// eslint-disable-next-line no-redeclare
export const TorrentLayout = {
  invalid: 'invalid',
  simpleAlbum: 'simpleAlbum',
  multiAlbum: 'multiAlbum',
  singleFileCue: 'singleFileCue',
  multiFileCue: 'multiFileCue',
  multiAlbumCue: 'multiAlbumCue',
} as const;

export type PathTaskInput = {
  artistName?: string | null;
  albumTitle?: string | null;
  albumYear?: number | null;
  title?: string | null;
  query?: string | null;
};

export type CueTrack = {
  track: number;
  title: string;
  index01: string;
  performer?: string;
};

export type ParsedCue = {
  albumTitle?: string | null;
  albumPerformer?: string | null;
  albumGenre?: string | null;
  albumDate?: string | null;
  tracks: CueTrack[];
};
