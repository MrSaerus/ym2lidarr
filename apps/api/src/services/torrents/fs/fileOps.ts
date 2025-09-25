// apps/api/src/services/torrents/fs/fileOps.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export async function pathExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}
export async function rmrf(p: string) {
  await fs.rm(p, { recursive: true, force: true });
}
export async function placeFile(src: string, dst: string, mode: 'copy'|'hardlink'|'move', force: boolean) {
  await fs.mkdir(path.dirname(dst), { recursive: true });

  if (mode === 'hardlink') {
    try {
      // если файл уже есть и force=false — просто выходим
      if (!force && await pathExists(dst)) return;
      // если force=true и существует — удалим
      if (force && await pathExists(dst)) await fs.rm(dst, { force: true });
      await fs.link(src, dst);
      return;
    } catch {
      // если линк не удаётся (другой файловый том и т.п.) — fallback на копию
      await fs.cp(src, dst, { force });
      return;
    }
  }

  if (mode === 'move') {
    try {
      if (!force && await pathExists(dst)) return;
      if (force && await pathExists(dst)) await fs.rm(dst, { force: true });
      await fs.rename(src, dst);
      return;
    } catch {
      // если move между разными томами — fallback на копирование + удаление
      await fs.cp(src, dst, { force });
      try { await fs.rm(src, { force: true }); } catch {}
      return;
    }
  }

  // copy (по умолчанию)
  await fs.cp(src, dst, { force });
}
