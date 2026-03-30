// apps/api/src/services/torrents/qbt/hash.ts
import { fetch } from 'undici';
import { createHash } from 'node:crypto';
import type { TorrentRelease } from '@prisma/client';
import { parseMagnetHash } from './magnet';
import { log } from '../index';

function bdecodeValueEndOffset(buf: Buffer, offset: number): number {
  if (offset >= buf.length) {
    throw new Error('Unexpected EOF while decoding bencode');
  }

  const ch = buf[offset];

  if (ch === 0x69 /* 'i' */) {
    const end = buf.indexOf(0x65 /* 'e' */, offset + 1);
    if (end === -1) throw new Error('Invalid bencode integer: no terminator');
    return end + 1;
  }

  if (ch === 0x6c /* 'l' */ || ch === 0x64 /* 'd' */) {
    const isDict = ch === 0x64;
    let pos = offset + 1;

    while (pos < buf.length && buf[pos] !== 0x65 /* 'e' */) {
      if (isDict) {
        pos = bdecodeValueEndOffset(buf, pos);
      }
      pos = bdecodeValueEndOffset(buf, pos);
    }

    if (pos >= buf.length || buf[pos] !== 0x65 /* 'e' */) {
      throw new Error('Invalid bencode list/dict: no terminator');
    }

    return pos + 1;
  }

  if (ch >= 0x30 /* '0' */ && ch <= 0x39 /* '9' */) {
    let colon = buf.indexOf(0x3a /* ':' */, offset); // позиция ':'
    if (colon === -1) throw new Error('Invalid bencode string: no colon');

    const lenStr = buf.toString('ascii', offset, colon);
    const len = parseInt(lenStr, 10);
    if (!Number.isFinite(len) || len < 0) {
      throw new Error('Invalid bencode string length');
    }

    const end = colon + 1 + len;
    if (end > buf.length) throw new Error('Invalid bencode string: truncated data');

    return end;
  }

  throw new Error(`Unknown bencode type: 0x${ch.toString(16)}`);
}
async function downloadTorrentFile(urlStr: string): Promise<Buffer> {
  const resp = await fetch(urlStr, { method: 'GET' });

  if (!resp.ok) {
    throw new Error(`Torrent download failed: HTTP ${resp.status} ${resp.statusText}`);
  }

  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}
function extractInfoDictSlice(buf: Buffer): Buffer {
  const marker = Buffer.from('4:info');
  const idx = buf.indexOf(marker);
  if (idx === -1) {
    throw new Error('Invalid .torrent: no "info" dictionary');
  }

  const start = idx + marker.length;
  const end = bdecodeValueEndOffset(buf, start);
  if (end <= start || end > buf.length) {
    throw new Error('Invalid .torrent: malformed "info" dictionary');
  }

  return buf.subarray(start, end);
}
async function computeTorrentInfoHashFromUrl(urlStr: string): Promise<string | null> {
  // если это не http/https — не лезем
  if (!/^https?:\/\//i.test(urlStr)) return null;

  const buf = await downloadTorrentFile(urlStr);
  const infoSlice = extractInfoDictSlice(buf);

  const hashHex = createHash('sha1')
    .update(infoSlice)
    .digest('hex')
    .toUpperCase();

  return hashHex;
}
export async function precomputeReleaseHash(release: TorrentRelease): Promise<string | null> {
  if (release.magnet) {
    const h = parseMagnetHash(release.magnet);
    if (h) return h;
  }

  if (release.link && /^https?:\/\//i.test(release.link)) {
    try {
      const h = await computeTorrentInfoHashFromUrl(release.link);
      if (h) return h;
    } catch (e: any) {
      log.warn(
        'failed to compute info-hash from torrent URL',
        'torrents.hash.precompute.error',
        {
          releaseId: release.id,
          linkPreview: release.link.slice(0, 200),
          error: e?.message || String(e),
        },
      );
    }
  }

  return null;
}
