// apps/api/src/services/torrents/cue/cueSplitSingle.ts
import path from 'node:path';
import { prisma } from '../../../prisma';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {parseCueFile} from './cueParse'
import {resolveCueAlbumMeta} from "./cueMeta"
import {buildFfmpegMetadataArgs} from './cueMeta'
import {log} from '../index'
import { extnameLower, isAudioFile } from '../fs/copyWithRenaming';
import { isCueFile } from '../layout/detectLayout';
import { applyPattern, safe } from '../fs/paths';
import { pathExists, rmrf } from '../fs/fileOps';

function cueTimeToSeconds(t: string): number {
  // Формат "MM:SS:FF", где FF — кадры (0–74) при 75 fps
  const parts = t.trim().split(':').map((x) => parseInt(x, 10) || 0);
  const mm = parts[0] ?? 0;
  const ss = parts[1] ?? 0;
  const ff = parts[2] ?? 0;
  return mm * 60 + ss + ff / 75;
}
function secondsToFfmpegTime(sec: number): string {
  const totalMs = Math.round(sec * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = (totalMs % 60000) / 1000;
  // HH:MM:SS.mmm
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    s.toFixed(3).padStart(6, '0'), // "SS.mmm"
  ].join(':');
}
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = stderr.trim() || `ffmpeg exited with code ${code}`;
        reject(new Error(msg));
      }
    });
  });
}
function decideSplitAudioCodec(ext: string): { codec: 'copy' | 'flac'; outExt: string } {
  const e = ext.toLowerCase();
  switch (e) {
    case '.flac':
    case '.fla':
      return { codec: 'flac', outExt: '.flac' };
    default:
      // всё остальное пока просто копируем в исходном контейнере
      return { codec: 'copy', outExt: e || '.flac' };
  }
}


export async function splitSingleFileCueAlbum(params: {
  srcBase: string;
  files: { name: string }[];
  dstAlbumDir: string;
  trackTpl: string;
  discTpl: string;
  policy: 'replace' | 'skip' | 'merge' | 'ask';
  meta?: {
    artistName?: string | null;
    albumTitle?: string | null;
    albumYear?: number | null;
    ymAlbumId?: string | null;
  };
}) {

  const { srcBase, files, dstAlbumDir, trackTpl, discTpl, policy, meta } = params;

  const audioFiles = files.filter((f) => isAudioFile(f.name));
  const cueFiles = files.filter((f) => isCueFile(f.name));

  if (audioFiles.length !== 1 || cueFiles.length === 0) {
    throw new Error('singleFileCue layout mismatch: expected 1 audio and >=1 CUE');
  }

  const cueRel = cueFiles[0].name.replace(/^[/\\]+/, '');
  const cueAbs = path.join(srcBase, cueRel);

  const parsed = await parseCueFile(cueAbs);
  const tracks = parsed.tracks;
  if (!tracks.length) {
    throw new Error('CUE has no usable tracks');
  }

  const totalTracks = tracks.length;

  const albumMeta = await resolveCueAlbumMeta(
    {
      artistName: meta?.artistName ?? null,
      albumTitle: meta?.albumTitle ?? null,
      albumYear: meta?.albumYear ?? null,
      ymAlbumId: meta?.ymAlbumId ?? null,
    },
    parsed,
  );


  const audioRel = audioFiles[0].name.replace(/^[/\\]+/, '');
  const audioAbs = path.join(srcBase, audioRel);
  const audioExt = extnameLower(audioRel) || '.flac';
  const { codec: audioCodec, outExt } = decideSplitAudioCodec(audioExt);

  const opSettings = await prisma.setting.findFirst({ where: { id: 1 } });
  const opMode = (opSettings?.fileOpMode as 'copy' | 'hardlink' | 'move') || 'copy';
  const force = policy === 'replace';

  // Нарезаем треки
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const next = tracks[i + 1];

    const startSec = cueTimeToSeconds(t.index01);
    const endSec = next ? cueTimeToSeconds(next.index01) : null;
    const durationSec = endSec != null ? Math.max(0, endSec - startSec) : null;

    const trackNumber = t.track || i + 1;
    const titleTag = t.title || `Track ${trackNumber}`;
    const titleForFile = safe(titleTag, `Track ${trackNumber}`);

    const performer = t.performer || albumMeta.albumArtist || null;

    const ctx: any = {
      Track: trackNumber,
      Title: titleForFile,
    };

    const baseName =
      applyPattern(trackTpl || '{Track:2} - {Title}', ctx) + audioExt;
    const dstRel = baseName; // диск считаем 1, без вложенных папок
    const dstAbs = path.join(dstAlbumDir, dstRel);

    const exists = await pathExists(dstAbs);
    if (exists) {
      if (policy === 'skip') continue;
      if (policy === 'ask') {
        throw new Error(`Destination exists: ${dstAbs}`);
      }
      if (force) {
        try {
          await fs.rm(dstAbs, { force: true });
        } catch {}
      }
    }

    const args: string[] = ['-hide_banner', '-loglevel', 'error'];

    const metaArgs = buildFfmpegMetadataArgs({
      trackNumber,
      totalTracks,
      title: titleTag,
      albumTitle: albumMeta.albumTitle || undefined,
      albumArtist: performer || undefined,
      year: albumMeta.year ?? undefined,
      genre: albumMeta.genre || undefined,
    });

    if (audioCodec === 'copy') {
      // быстрый seek по входу, без перекодирования
      args.push('-ss', secondsToFfmpegTime(startSec));
      args.push('-i', audioAbs);
      if (durationSec != null && durationSec > 0.1) {
        args.push('-t', secondsToFfmpegTime(durationSec));
      }
      args.push('-acodec', 'copy');
      args.push(...metaArgs);
      args.push('-vn', '-y', dstAbs);
    } else {
      // FLAC: точный cut + перекодирование, чтобы duration в заголовке был правильный
      args.push('-i', audioAbs);
      args.push('-ss', secondsToFfmpegTime(startSec));
      if (durationSec != null && durationSec > 0.1) {
        args.push('-t', secondsToFfmpegTime(durationSec));
      }
      args.push('-acodec', 'flac');
      args.push(...metaArgs);
      args.push('-vn', '-y', dstAbs);
    }

    log.debug('ffmpeg split track', 'torrents.cue.split.track', {
      src: audioAbs,
      dst: dstAbs,
      track: trackNumber,
      title: titleTag,
      start: startSec,
      duration: durationSec ?? null,
      albumTitle: albumMeta.albumTitle ?? null,
      year: albumMeta.year ?? null,
      genre: albumMeta.genre ?? null,
      totalTracks,
    });

    await runFfmpeg(args);
  }

  // В режиме move — удаляем исходную папку после успешной нарезки
  if (opMode === 'move') {
    try {
      await rmrf(srcBase);
    } catch (e: any) {
      log.warn(
        'failed to remove srcBase after CUE split',
        'torrents.cue.rmrf.fail',
        {
          srcBase,
          error: e?.message || String(e),
        },
      );
    }
  }
}
