// apps/api/src/types/torrents.ts
export type TorrentTaskKind = 'artist' | 'album';
export type TorrentTaskStatus = 'pending' | 'searching' | 'downloading' | 'importing' | 'done' | 'failed' | 'canceled';
export type CollisionPolicy = 'ask' | 'replace' | 'skip';
export type TorrentReleaseStatus = 'new' | 'chosen' | 'queued' | 'downloading' | 'downloaded' | 'imported' | 'rejected' | 'failed';

export const isTaskKind = (x: any): x is TorrentTaskKind =>
  x === 'artist' || x === 'album';

export const isTaskStatus = (x: any): x is TorrentTaskStatus =>
  ['pending','searching','downloading','importing','done','failed','canceled'].includes(String(x));

export const isReleaseStatus = (x: any): x is TorrentReleaseStatus =>
  ['new','queued','downloading','downloaded','imported','rejected','failed'].includes(String(x));

export const isCollisionPolicy = (x: any): x is CollisionPolicy =>
  ['ask','replace','skip'].includes(String(x));
