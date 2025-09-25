// apps/api/src/services/torrents/cue/cueDecode.ts
import chardet from 'chardet';
import iconv from 'iconv-lite';

function hasUtf8Bom(buf: Buffer) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function isValidUtf8(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const b0 = buf[i];

    // ASCII
    if (b0 <= 0x7f) {
      i += 1;
      continue;
    }

    // 2-byte
    if ((b0 & 0xe0) === 0xc0) {
      // запрет overlong: 0xC0/0xC1
      if (b0 < 0xc2) return false;
      if (i + 1 >= buf.length) return false;
      const b1 = buf[i + 1];
      if ((b1 & 0xc0) !== 0x80) return false;
      i += 2;
      continue;
    }

    // 3-byte
    if ((b0 & 0xf0) === 0xe0) {
      if (i + 2 >= buf.length) return false;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return false;

      // overlong для 3-byte
      if (b0 === 0xe0 && b1 < 0xa0) return false;
      // суррогаты U+D800..U+DFFF
      if (b0 === 0xed && b1 >= 0xa0) return false;

      i += 3;
      continue;
    }

    // 4-byte
    if ((b0 & 0xf8) === 0xf0) {
      if (b0 > 0xf4) return false; // максимум U+10FFFF
      if (i + 3 >= buf.length) return false;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      const b3 = buf[i + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return false;

      // overlong для 4-byte
      if (b0 === 0xf0 && b1 < 0x90) return false;
      // выше U+10FFFF
      if (b0 === 0xf4 && b1 > 0x8f) return false;

      i += 4;
      continue;
    }

    return false;
  }
  return true;
}

function scoreDecodedText(s: string) {
  const repl = (s.match(/�/g) || []).length;
  const cyr  = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const ctrl = (s.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return (cyr * 6) - (repl * 30) - (ctrl * 2);
}

export function decodeCueSmart(buf: Buffer): { text: string; encoding: string } {
  // 1) BOM -> UTF-8
  if (hasUtf8Bom(buf)) {
    const t = buf.toString('utf8').replace(/^\uFEFF/, '');
    return { text: t, encoding: 'utf8-bom' };
  }

  // 2) Если буфер строго валиден как UTF-8 — это приоритетнее любых эвристик.
  //    Это как раз чинит “Инкогнито - Наши голоса”: UTF-8 без BOM больше не уйдёт в win1251.
  if (isValidUtf8(buf)) {
    const t = buf.toString('utf8').replace(/^\uFEFF/, '');
    return { text: t, encoding: 'utf8' };
  }

  // 3) Дальше — эвристики для НЕ-UTF8 (cp1251/cp866/koi8-r/…)
  const candidates = [
    'win1251',
    'cp1251',
    'cp866',
    'koi8-r',
    'win1252',
    'latin1',
  ];

  const detected = (chardet.detect(buf) || '').toString();
  const detectedNorm = detected.toUpperCase();
  let detectedEnc: string | null = null;

  if (detectedNorm.includes('1251')) detectedEnc = 'win1251';
  else if (detectedNorm.includes('866')) detectedEnc = 'cp866';
  else if (detectedNorm.includes('KOI8')) detectedEnc = 'koi8-r';
  else if (detectedNorm.includes('1252')) detectedEnc = 'win1252';
  else if (detectedNorm.includes('ISO-8859-1')) detectedEnc = 'latin1';

  const uniq = Array.from(new Set([...(detectedEnc ? [detectedEnc] : []), ...candidates]));

  let best = { text: iconv.decode(buf, 'win1251'), encoding: 'win1251', score: -Infinity };

  for (const enc of uniq) {
    let text: string;
    try {
      text = iconv.decode(buf, enc);
    } catch {
      continue;
    }
    text = text.replace(/^\uFEFF/, '');
    const sc = scoreDecodedText(text);
    if (sc > best.score) best = { text, encoding: enc, score: sc };
  }

  return { text: best.text, encoding: best.encoding };
}
