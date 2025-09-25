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
    /^disс\s*\d{1,2}$/.test(r) || // кириллическая "с"
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
  if (parts.length <= 1) return null;        // нет директорий, только имя файла
  const dirs = parts.slice(0, -1);           // все директории, без имени файла
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

  // корни — только директории верхнего уровня
  const rootDirs = Array.from(new Set(
    files.map(f => firstDir(f.name)).filter((x): x is string => !!x),
  ));
  const rootCount = rootDirs.length;

  // multi-disc в корне (CD1/CD2) — это НЕ multiAlbum
  const rootsAreDiscs = allDiscRoots(rootDirs);

  // nested структура: 1 rootDir (папка альбома), внутри могут быть:
  // - Disc 1 / Disc 2 (multi-disc одного альбома)
  // - AlbumA / AlbumB (multi-album)
  //
  // Поэтому "несколько second-level" считаем multi-album ТОЛЬКО если среди них есть
  // хотя бы 2 НЕ-дисковых имени.
  const audioSecondDirsAll = Array.from(new Set(
    audio.map(f => dirSeg(f.name, 1)).filter((x): x is string => !!x),
  ));
  const audioSecondDirsNonDisc = audioSecondDirsAll.filter(d => !isDiscRootName(d));

  const hasNestedMultiAlbum = (rootCount === 1 && audioSecondDirsNonDisc.length > 1);

  if (!hasCue) {
    if (hasNestedMultiAlbum) return TorrentLayout.multiAlbum;
    if (rootCount <= 1) return TorrentLayout.simpleAlbum;
    if (rootsAreDiscs) return TorrentLayout.simpleAlbum; // CD1/CD2 без cue
    return TorrentLayout.multiAlbum;
  }

  // Есть CUE
  if (hasNestedMultiAlbum) return TorrentLayout.multiAlbumCue;

  if (rootCount <= 1) {
    if (audio.length === 1) return TorrentLayout.singleFileCue;
    return TorrentLayout.multiFileCue;
  }

  // несколько корней, но это диски => multiFileCue (один альбом, multi-disc)
  if (rootsAreDiscs) return TorrentLayout.multiFileCue;

  return TorrentLayout.multiAlbumCue;
}
