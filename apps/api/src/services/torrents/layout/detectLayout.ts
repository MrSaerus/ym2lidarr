// apps/api/src/services/torrents/layout/detectLayout.ts
import { TorrentLayout } from '../types';
import { isAudioFile } from '../fs/copyWithRenaming';

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function isDiscRootName(root: string): boolean {
  const r = norm(root)
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /^cd\s*\d{1,2}$/.test(r) ||
    /^disc\s*\d{1,2}$/.test(r) ||
    /^disk\s*\d{1,2}$/.test(r) ||
    /^disс\s*\d{1,2}$/.test(r) ||
    /^диск\s*\d{1,2}$/.test(r) ||
    /^cd\s*\d{1,2}\s*-\s*.*$/.test(r) ||
    /^disc\s*\d{1,2}\s*-\s*.*$/.test(r)
  );
}
function allDiscRoots(roots: string[]): boolean {
  return roots.length > 0 && roots.every(isDiscRootName);
}
export function pathParts(p: string): string[] {
  return (p || '')
    .replace(/^[/\\]+/, '')
    .split(/[\\/]/)
    .filter(Boolean);
}
export function dirSeg(p: string, idx: number): string | null {
  const parts = pathParts(p);
  if (parts.length <= 1) return null;
  const dirs = parts.slice(0, -1);
  return dirs[idx] ?? null;
}
export function firstDir(p: string): string | null {
  return dirSeg(p, 0);
}
export function isCueFile(name: string): boolean {
  return name.toLowerCase().endsWith('.cue');
}
export function detectTorrentLayout(files: { name: string; size: number }[]): TorrentLayout {
  if (!files.length) return TorrentLayout.invalid;

  const audio = files.filter(f => isAudioFile(f.name));
  const cues  = files.filter(f => isCueFile(f.name));
  if (!audio.length) return TorrentLayout.invalid;

  const hasCue = cues.length > 0;

  const rootDirs = Array.from(new Set(
    files.map(f => firstDir(f.name)).filter((x): x is string => !!x),
  ));
  const rootCount = rootDirs.length;

  const rootsAreDiscs = allDiscRoots(rootDirs);

  const audioSecondDirsAll = Array.from(new Set(
    audio.map(f => dirSeg(f.name, 1)).filter((x): x is string => !!x),
  ));
  const audioSecondDirsNonDisc = audioSecondDirsAll.filter(d => !isDiscRootName(d));

  const hasNestedMultiAlbum = (rootCount === 1 && audioSecondDirsNonDisc.length > 1);

  if (!hasCue) {
    if (hasNestedMultiAlbum) return TorrentLayout.multiAlbum;
    if (rootCount <= 1) return TorrentLayout.simpleAlbum;
    if (rootsAreDiscs) return TorrentLayout.simpleAlbum;
    return TorrentLayout.multiAlbum;
  }

  if (hasNestedMultiAlbum) return TorrentLayout.multiAlbumCue;

  if (rootCount <= 1) {
    if (audio.length === 1) return TorrentLayout.singleFileCue;
    return TorrentLayout.multiFileCue;
  }

  if (rootsAreDiscs) return TorrentLayout.multiFileCue;

  return TorrentLayout.multiAlbumCue;
}
