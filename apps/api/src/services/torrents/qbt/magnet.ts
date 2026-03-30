// apps/api/src/services/torrents/qbt/magnet.ts
function base32ToHex(b32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = b32.toUpperCase().replace(/=+$/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('bad base32');
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  if (hex.length > 40) hex = hex.slice(0, 40);
  return hex;
}
export function parseMagnetHash(magnet?: string | null): string | null {
  if (!magnet) return null;
  const m = /xt=urn:btih:([^&]+)/i.exec(magnet);
  if (!m) return null;
  let hash = m[1].trim();

  const isHex = /^[a-f0-9]{40}$/i.test(hash);
  const isBase32 = /^[A-Z2-7]{26,40}$/i.test(hash);
  if (isHex) return hash.toUpperCase();
  if (isBase32) {
    try {
      const hex = base32ToHex(hash);
      return hex ? hex.toUpperCase() : null;
    } catch { /* ignore */ }
  }
  return null;
}
