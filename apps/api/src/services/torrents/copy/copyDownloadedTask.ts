// apps/api/src/services/torrents/copy/copyDownloadedTask.ts
import { prisma } from '../../../prisma';
import { QbtClient } from '../../qbittorrent';
import path from 'node:path';
import { TorrentStatus } from '@prisma/client';
import fs from 'node:fs/promises';
import { resolveAlbumTargetDir, safe } from '../fs/paths';
import { pathExists, rmrf } from '../fs/fileOps';
import { TorrentLayout } from '../types';
import { copyWithRenaming, isAudioFile } from '../fs/copyWithRenaming';
import { log } from '../index';
import { splitSingleFileCueAlbum } from '../cue/cueSplitSingle';
import { pickMultiAlbumRoot, pickMultiAlbumSecondDir } from '../layout/multiAlbumPick';

function commonRootDir(files: { name: string }[]): string | null {
  if (!files.length) return null;
  const firstSeg = (p: string) => (p.replace(/^[/\\]+/, '').split(/[\\/]/)[0] || '').trim();
  const roots = new Set(files.map(f => firstSeg(f.name || '')));
  if (roots.size === 1) {
    const [root] = Array.from(roots.values());
    return root || null;
  }
  return null;
}
export async function getPathConfig() {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  // допускаем использование rootFolderPath как запасного варианта для медиатеки
  const downloadsDir = s?.torrentDownloadsDir || null;
  const musicDir = s?.musicLibraryDir || s?.rootFolderPath || null;

  if (!downloadsDir || !musicDir) {
    throw new Error('Paths not configured in Setting: set torrentDownloadsDir and musicLibraryDir/rootFolderPath');
  }
  return { downloadsDir, musicDir };
}
export async function copyDownloadedTask(taskId: number) {
  const task = await prisma.torrentTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  const { downloadsDir, musicDir } = await getPathConfig();
  const { client } = await QbtClient.fromDb();

  let srcBase: string | null = null;
  let files: { name: string }[] = [];

  if (task.qbitHash) {
    const info = await client.infoByHash(task.qbitHash);
    if (info?.save_path) {
      try {
        files = await client.filesByHash(task.qbitHash);
        function escapeRe(s: string) {
          return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        const root = commonRootDir(files);
        if (root) {
          srcBase = path.join(info.save_path, root); // тут без sanitize!
          // перепишем относительные имена относительно root
          const rx = new RegExp(`^${escapeRe(root)}[\\\\/]?`, 'i'); // <-- было без escape
          files = files.map((f) => ({ name: f.name.replace(rx, '') }));
        } else {
          srcBase = info.save_path;
        }
      } catch {
        /* fallback ниже */
      }
    }
  }
  if (!srcBase) {
    const fallback = safe(task.title, task.query, `task-${task.id}`);
    srcBase = path.join(downloadsDir, fallback);
  }
  if (!(await pathExists(srcBase))) throw new Error(`Source not found: ${srcBase}`);

  const dstAlbumDir = await resolveAlbumTargetDir(musicDir, task);
  const settings = await prisma.setting.findFirst({ where: { id: 1 } });
  const trackTpl = settings?.musicTrackFilePattern || '{Track:2} - {Title}';
  const opMode = (settings?.fileOpMode as 'copy' | 'hardlink' | 'move') || 'copy';
  const policy = (task.movePolicy || 'replace') as 'replace' | 'skip' | 'merge' | 'ask';
  const force = policy === 'replace';
  const layout = (task as any).layout as
    | TorrentLayout
    | 'unknown'
    | null
    | undefined;

  await prisma.torrentTask.update({
    where: { id: taskId },
    data: { status: TorrentStatus.moving },
  });

  try {
    if (!files.length) {
      // TO:DO нет списка файлов — копируем как есть папку CHANGE
      const policy = (task.movePolicy || 'replace') as 'replace' | 'skip' | 'merge' | 'ask';
      await fs.mkdir(dstAlbumDir, { recursive: true });
      // Если в целевом уже что-то есть — применяем политику
      const dstExists = await pathExists(dstAlbumDir);
      if (dstExists) {
        if (policy === 'skip') {
          // ничего не делаем
        } else if (policy === 'ask') {
          throw new Error(`Destination exists: ${dstAlbumDir}`);
        } else if (policy === 'replace') {
          await rmrf(dstAlbumDir);
          await fs.cp(srcBase, dstAlbumDir, { recursive: true, force: true });
        } else {
          // merge
          await fs.cp(srcBase, dstAlbumDir, { recursive: true, force: false });
        }
      } else {
        await fs.cp(srcBase, dstAlbumDir, { recursive: true, force: false });
      }

      if (opMode === 'move') {
        try {
          // Попытка атомарного переноса папки
          await fs.rename(srcBase, dstAlbumDir);
        } catch {
          // Cross-device или busy — копируем и чистим исходник
          await fs.cp(srcBase, dstAlbumDir, { recursive: true, force });
          try {
            await rmrf(srcBase);
          } catch {}
        }
      } else {
        // copy / hardlink (для директории в целом — фактически копия)
        await fs.cp(srcBase, dstAlbumDir, { recursive: true, force });
      }
    } else {
      // Есть список файлов — работаем по layout
      await fs.mkdir(dstAlbumDir, { recursive: true });

      // Общий список аудио-файлов (для простых кейсов)
      const audioFiles = files.filter((f) => isAudioFile(f.name));

      if (layout === TorrentLayout.singleFileCue) {
        // 1) Один большой файл + CUE → режем на треки с проставлением тегов
        log.info('processing singleFileCue layout', 'torrents.copy.cue.start', {
          taskId,
          srcBase,
          dstAlbumDir,
        });

        await splitSingleFileCueAlbum({
          srcBase,
          files,
          dstAlbumDir,
          trackTpl,
          discTpl: settings?.musicDiscFolderPattern || 'Disc {Disc}',
          policy,
          meta: {
            artistName: task.artistName,
            albumTitle: task.albumTitle,
            albumYear: task.albumYear,
            ymAlbumId: (task as any).ymAlbumId ?? null,
          },
        });
      } else if (layout === TorrentLayout.simpleAlbum || !layout || layout === 'unknown') {
        // 2) Обычный альбом: просто копируем треки (ТОЛЬКО музыку)
        await copyWithRenaming(
          audioFiles,
          srcBase,
          dstAlbumDir,
          trackTpl,
          settings?.musicDiscFolderPattern || 'Disc {Disc}',
          policy,
        );
      } else if (layout === TorrentLayout.multiAlbum) {
        // 3) Один торрент с несколькими альбомами → берём только нужный альбом (root или nested second dir)
        const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const firstSeg = (p: string) => (p || '').replace(/^[/\\]+/, '').split(/[\\/]/)[0] || '';
        const secondSeg = (p: string) => {
          const parts = (p || '').replace(/^[/\\]+/, '').split(/[\\/]/).filter(Boolean);
          return parts[1] || '';
        };

        const roots = Array.from(new Set(files.map(f => firstSeg(f.name)).filter(Boolean)));

        const rootDir = pickMultiAlbumRoot(files, task); // работает хорошо, если roots > 1
        const nestedSecondDir =
          (roots.length <= 1) ? pickMultiAlbumSecondDir(files, task) : null;

        log.info('processing multiAlbum layout', 'torrents.copy.multialbum.start', {
          taskId,
          srcBase,
          dstAlbumDir,
          rootsCount: roots.length,
          rootDir,
          nestedSecondDir,
        });

        let albumFiles = files;
        let albumSrcBase = srcBase;

        if (roots.length > 1 && rootDir) {
          // Кейс: несколько корневых папок (или после strip wrapper root) — как было
          const prefixRe = new RegExp(`^${escapeRe(rootDir)}[\\\\/]*`, 'i');

          albumFiles = files
            .filter((f) => (firstSeg(f.name).toLowerCase() === rootDir.toLowerCase()))
            .map((f) => ({ name: f.name.replace(prefixRe, '') }));

          albumSrcBase = path.join(srcBase, rootDir);
        } else if (nestedSecondDir) {
          // Кейс: один корень-обёртка, а альбомы лежат во 2-м сегменте (2015 - Vol. 1 / 2016 - Vol. 2)
          // Оставляем только выбранную подпапку второго сегмента, пути делаем относительными к ней
          const prefixRe = new RegExp(
            `^${escapeRe(firstSeg(files[0]?.name || ''))}[\\\\/]+${escapeRe(nestedSecondDir)}[\\\\/]*`,
            'i',
          );

          // Если wrapper root уже был "отрезан" выше (commonRootDir), то firstSeg(files[0]) == nestedSecondDir.
          // Поэтому добавляем второй вариант фильтра/префикса.
          const wrapper = commonRootDir(files); // null либо "единственный root" в текущем списке
          const hasWrapper = !!wrapper;

          if (hasWrapper) {
            // wrapper есть в текущих относительных путях: wrapper/second/...
            albumFiles = files
              .filter((f) => secondSeg(f.name).toLowerCase() === nestedSecondDir.toLowerCase())
              .map((f) => ({ name: f.name.replace(prefixRe, '') }));

            albumSrcBase = srcBase; // srcBase уже указывает на wrapper (вы его join’или выше)
          } else {
            // wrapper уже отрезан ранее, и roots = ['2015 - Vol. 1','2016 - Vol. 2']
            // Тогда nestedSecondDir фактически является "root"
            const rootLike = nestedSecondDir;
            const prefixRe2 = new RegExp(`^${escapeRe(rootLike)}[\\\\/]*`, 'i');

            albumFiles = files
              .filter((f) => firstSeg(f.name).toLowerCase() === rootLike.toLowerCase())
              .map((f) => ({ name: f.name.replace(prefixRe2, '') }));

            albumSrcBase = path.join(srcBase, rootLike);
          }
        } else {
          // Fallback: если не смогли выбрать ни root, ни secondDir — безопасно НЕ флаттеним всё.
          // Берём только аудио как есть (иначе снова смешаем два альбома).
          log.warn('multiAlbum pick failed, copying audio only as-is', 'torrents.copy.multialbum.pick_failed', {
            taskId,
            rootsCount: roots.length,
          });
          albumFiles = files.filter(f => isAudioFile(f.name));
          albumSrcBase = srcBase;
        }

        const albumAudioFiles = albumFiles.filter((f) => isAudioFile(f.name));

        await copyWithRenaming(
          albumAudioFiles,
          albumSrcBase,
          dstAlbumDir,
          trackTpl,
          settings?.musicDiscFolderPattern || 'Disc {Disc}',
          policy,
        );
      } else if (layout === TorrentLayout.multiFileCue) {
        // 4) multiFileCue: один альбом, несколько аудио-файлов, возможно multi-disc (CD1/CD2 или Disc 1/Disc 2)
        // Копируем только аудио. Разбиение по Disc {Disc} сделает copyWithRenaming(),
        // т.к. он извлекает номер диска из сегментов пути (CD1/Disc 2/...).
        log.info('processing multiFileCue layout', 'torrents.copy.multifilecue.start', {
          taskId,
          srcBase,
          dstAlbumDir,
        });

        await copyWithRenaming(
          audioFiles,
          srcBase,
          dstAlbumDir,
          trackTpl,
          settings?.musicDiscFolderPattern || 'Disc {Disc}',
          policy,
        );
      } else if (layout === TorrentLayout.multiAlbumCue) {
        // Пока не поддерживаем: нужен выбор конкретного альбомного subdir + обработка cue внутри него
        const msg = `Torrent layout ${layout} is not implemented yet`;
        log.warn(msg, 'torrents.copy.cue.unsupported', {
          taskId,
          layout,
          srcBase,
        });
        throw new Error(msg);
      } else {
        // 5) Fallback для всего остального (включая 'invalid'):
        // безопасно копируем только музыку как простой альбом
        await copyWithRenaming(
          audioFiles,
          srcBase,
          dstAlbumDir,
          trackTpl,
          settings?.musicDiscFolderPattern || 'Disc {Disc}',
          policy,
        );
      }
    }


    const t = await prisma.torrentTask.update({
      where: { id: taskId },
      data: {
        status: TorrentStatus.moved,
        finalPath: dstAlbumDir,
        finishedAt: new Date(),
        lastError: null,
      },
    });
    return {
      ok: true as const,
      task: t,
      srcDir: srcBase,
      dstDir: dstAlbumDir,
    };
  } catch (e: any) {
    const t = await prisma.torrentTask.update({
      where: { id: taskId },
      data: {
        status: TorrentStatus.failed,
        lastError: e?.message || String(e),
      },
    });
    return {
      ok: false as const,
      task: t,
      error: e?.message || String(e),
    };
  }
}
