// apps/api/src/services/torrents/layout/multiAlbumPick.ts
import { PathTaskInput } from '../types';
import { safe } from '../fs/paths';
import { isAudioFile } from '../fs/copyWithRenaming';
import { dirSeg, firstDir } from './detectLayout';

export function normalizeTitleTokens(str: string): string[] {
  return (str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .split(' ')
    .filter(Boolean);
}
export function pickMultiAlbumRoot(files: { name: string }[], task: PathTaskInput): string | null {
  const roots = Array.from(new Set(
    files.map(f => firstDir(f.name)).filter((x): x is string => !!x),
  ));

  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];

  const title = safe(task.albumTitle, task.title, task.query);
  const year = task.albumYear ? String(task.albumYear) : '';
  const targetTokens = normalizeTitleTokens(`${title} ${year}`);
  if (!targetTokens.length) return roots[0];

  let bestRoot = roots[0];
  let bestScore = -1;

  for (const r of roots) {
    const tokens = normalizeTitleTokens(r);
    let score = 0;
    for (const t of tokens) if (targetTokens.includes(t)) score++;
    if (score > bestScore) { bestScore = score; bestRoot = r; }
  }
  return bestRoot;
}
export function pickMultiAlbumSecondDir(files: { name: string }[], task: PathTaskInput): string | null {
  const audio = files.filter(f => isAudioFile(f.name));
  if (!audio.length) return null;

  const secondDirs = Array.from(new Set(
    audio.map(f => dirSeg(f.name, 1)).filter((x): x is string => !!x),
  ));

  if (!secondDirs.length) return null;
  if (secondDirs.length === 1) return secondDirs[0];

  const title = safe(task.albumTitle, task.title, task.query);
  const year  = task.albumYear ? String(task.albumYear) : '';
  const targetTokens = normalizeTitleTokens(`${title} ${year}`);
  if (!targetTokens.length) return secondDirs[0];

  let best = secondDirs[0];
  let bestScore = -1;

  for (const d of secondDirs) {
    const tokens = normalizeTitleTokens(d);
    let score = 0;
    for (const t of tokens) if (targetTokens.includes(t)) score++;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
