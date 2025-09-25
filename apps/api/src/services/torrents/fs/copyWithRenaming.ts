// apps/api/src/services/torrents/fs/copyWithRenaming.ts
import { prisma } from '../../../prisma';
import path from 'node:path';
import { applyPattern, safe } from './paths';
import { pathExists, placeFile } from './fileOps';

export function extnameLower(f: string) { return path.extname(f).toLowerCase(); }
export function isAudioFile(f: string) {
  return ['.flac','.mp3','.m4a','.wav','.ogg','.opus','.aiff','.alac','.aac'].includes(extnameLower(f));
}
export function isCoverImage(f: string) {
  return ['cover','folder','front'].includes(path.basename(f, path.extname(f)).toLowerCase());
}
export function guessTrackMeta(relPath: string): { disc?: number; track?: number; title?: string } {
  const parts = relPath.split(/[\\/]/g).filter(Boolean);
  const file = parts.pop() || '';

  // Нормализация сегмента пути для более стабильного матчинга
  const norm = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Диск берём из директорий: CD1 / CD 1 / Disc 2 / Disk 01 / Диск 1 / "Disc 2 (Bonus ...)" / "CD 1 - Extra" и т.п.
  const disc = (() => {
    for (const raw of parts) {
      const s = norm(raw);

      // cd1, disc2, disk01, "disc 2 (bonus...)" и т.д.
      const m =
        s.match(/\b(cd|disc|disk|диск)\s*0*(\d{1,2})\b/) ||
        s.match(/\b(cd|disc|disk|диск)0*(\d{1,2})\b/);

      if (m) {
        const n = Number(m[2]);
        if (Number.isFinite(n) && n > 0 && n < 100) return n;
      }
    }
    return undefined;
  })();

  // номер трека в начале имени: "01 - Title", "1. Title", "01 Title"
  const base = file.replace(extnameLower(file), '');
  const m = /^(\d{1,3})[.\-\s_]+(.+)$/.exec(base);
  const track = m ? parseInt(m[1], 10) : undefined;
  const title = m ? m[2] : base;

  return {
    disc: Number.isFinite(disc as any) ? disc : undefined,
    track: Number.isFinite(track as any) ? track : undefined,
    title: title?.trim(),
  };
}
export async function copyWithRenaming(fileList: { name: string }[], srcBase: string, dstAlbumDir: string, trackPattern: string, discTpl: string, policy: 'replace'|'skip'|'merge'|'ask' = 'replace') {
  const settings = await prisma.setting.findFirst({ where: { id: 1 } });
  const opMode = (settings?.fileOpMode as 'copy'|'hardlink'|'move') || 'copy';
  const force = policy === 'replace';

  for (const f of fileList) {
    const rel = f.name.replace(/^[/\\]+/, '');
    const absSrc = path.join(srcBase, rel);
    const { disc, track, title } = guessTrackMeta(rel);

    let dstRel = rel;
    if (isAudioFile(rel)) {
      const ctx = { Track: track ?? 0, Title: safe(title, path.basename(rel, extnameLower(rel))) } as any;
      const baseName = applyPattern(trackPattern || '{Track:2} - {Title}', ctx) + extnameLower(rel);
      dstRel = disc ? path.join(applyPattern(discTpl || 'Disc {Disc}', { Disc: disc }), baseName) : baseName;
    } else if (isCoverImage(rel)) {
      dstRel = 'cover' + extnameLower(rel);
    }

    const absDst = path.join(dstAlbumDir, dstRel);
    const exists = await pathExists(absDst);

    if (exists) {
      if (policy === 'skip') continue;
      if (policy === 'ask') throw new Error(`Destination exists: ${absDst}`);
      // merge/replace перейдут к placeFile с нужным force
    }

    await placeFile(absSrc, absDst, opMode, force);
  }
}
