// apps/api/src/services/torrents/cue/cueParse.ts
import fs from 'node:fs/promises';
import { decodeCueSmart } from './cueDecode';
import type { CueTrack, ParsedCue } from '../types';
import { log } from '../index';

export async function parseCueFile(cuePath: string): Promise<ParsedCue> {
  const buf = await fs.readFile(cuePath);
  const decoded = decodeCueSmart(buf);
  const raw = decoded.text;

  log.debug('cue decoded', 'torrents.cue.decode', {
    cuePath,
    encoding: decoded.encoding,
    size: buf.length,
  });

  const lines = raw.split(/\r?\n/);

  const tracks: CueTrack[] = [];
  let current: CueTrack | null = null;

  let albumTitle: string | null = null;
  let albumPerformer: string | null = null;
  let albumGenre: string | null = null;
  let albumDate: string | null = null;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // REM DATE 1999 / REM DATE "1999"
    const remDateMatch = /^REM\s+DATE\s+"?([^"]+)"?/i.exec(l);
    if (remDateMatch) {
      albumDate = remDateMatch[1].trim() || null;
      continue;
    }

    // REM GENRE / GENRE
    const remGenreMatch = /^REM\s+GENRE\s+"?([^"]+)"?/i.exec(l);
    if (remGenreMatch) {
      albumGenre = remGenreMatch[1].trim() || null;
      continue;
    }
    const genreMatch = /^GENRE\s+"?([^"]+)"?/i.exec(l);
    if (genreMatch) {
      albumGenre = genreMatch[1].trim() || null;
      continue;
    }

    const trackMatch = /^TRACK\s+(\d{1,2})\s+/i.exec(l);
    if (trackMatch) {
      // закрываем предыдущий трек, если он заполнен
      if (current && current.track != null && current.title && current.index01) {
        tracks.push(current);
      }
      current = {
        track: parseInt(trackMatch[1], 10),
        title: '',
        index01: '00:00:00',
      };
      continue;
    }

    const titleMatch = /^TITLE\s+"([^"]+)"/i.exec(l);
    if (titleMatch) {
      if (current && current.track != null) {
        current.title = titleMatch[1].trim();
      } else {
        albumTitle = titleMatch[1].trim();
      }
      continue;
    }

    const performerMatch = /^PERFORMER\s+"([^"]+)"/i.exec(l);
    if (performerMatch) {
      if (current && current.track != null) {
        current.performer = performerMatch[1].trim();
      } else {
        albumPerformer = performerMatch[1].trim();
      }
      continue;
    }

    const indexMatch = /^INDEX\s+01\s+(\d{2}:\d{2}:\d{2})/i.exec(l);
    if (indexMatch && current) {
      current.index01 = indexMatch[1].trim();
      continue;
    }
  }

  // последний трек
  if (current && current.track != null && current.title && current.index01) {
    tracks.push(current);
  }

  tracks.sort((a, b) => a.track - b.track);

  return {
    albumTitle,
    albumPerformer,
    albumGenre,
    albumDate,
    tracks,
  };
}
