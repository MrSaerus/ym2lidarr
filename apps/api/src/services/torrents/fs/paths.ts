// apps/api/src/services/torrents/fs/paths.ts
import { prisma } from '../../../prisma';
import path from 'node:path';
import {PathTaskInput} from '../types'

function sanitizeName(s: string): string {
  return s
    .replace(/[\/\\:*?"<>|]+/g, ' ') // запрещённые/проблемные
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, ''); // убираем хвостовые точки/пробелы
}
function tidy(p: string) {
  return p.replace(/\s{2,}/g,' ').replace(/\s*-\s*/g, ' - ').replace(/^-\s+|\s+-$/g,'').trim();
}
export function applyPattern(pattern: string, ctx: Record<string,string|number>) {
  const out = pattern.replace(/\{([A-Za-z]+)(?::(\d+))?\}/g, (_, key, pad) => {
    let v = ctx[key] ?? '';
    if (typeof v === 'number' && pad) v = String(v).padStart(parseInt(pad,10), '0');
    return sanitizeName(String(v));
  });
  return tidy(out);
}
export function safe(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    const s = sanitizeName(String(v ?? '').trim());
    if (s) return s;
  }
  return '';
}
async function buildMusicPaths(task: PathTaskInput) {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const artistTpl = s?.musicArtistFolderPattern || '{Artist}';
  const albumTpl  = s?.musicAlbumFolderPattern  || '{Year} - {Album}';
  const discTpl   = s?.musicDiscFolderPattern   || 'Disc {Disc}';
  const vaName    = s?.musicVariousArtistsName  || 'Various Artists';
  const album  = safe(task.albumTitle, task.title, task.query, 'Unsorted');
  const artist = safe(task.artistName, '_Unsorted');

  const year   = task.albumYear || '';

  const artistFolder = applyPattern(artistTpl, { Artist: artist, Year: year, Album: album, Disc: '' });
  const albumFolder  = applyPattern(albumTpl,  { Artist: artist, Year: year, Album: album, Disc: '' });

  return { artistFolder, albumFolder, discTpl, vaName };
}
export async function resolveAlbumTargetDir(baseMusicDir: string, task: PathTaskInput) {
  const { artistFolder, albumFolder } = await buildMusicPaths(task);
  return path.join(baseMusicDir, artistFolder, albumFolder);
}
