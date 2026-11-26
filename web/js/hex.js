// Intel HEX / raw binary loaders. Returns { segs: [{addr, data}], start, end } (end exclusive).
export function parseHex(text) {
  const mem = new Map(); let ext = 0, lo = Infinity, hi = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line.startsWith(':')) continue;
    const n = parseInt(line.substr(1, 2), 16), addr = parseInt(line.substr(3, 4), 16), type = parseInt(line.substr(7, 2), 16);
    if (Number.isNaN(n) || Number.isNaN(addr) || line.length < 11 + n * 2) throw new Error('HEXの形式が不正です: ' + line.slice(0, 20));
    let sum = 0; for (let i = 1; i + 1 < line.length; i += 2) sum += parseInt(line.substr(i, 2), 16);
    if ((sum & 0xff) !== 0) throw new Error('HEXのチェックサムが一致しません: ' + line.slice(0, 20));
    if (type === 1) break;
    if (type === 2) ext = parseInt(line.substr(9, 4), 16) << 4;
    else if (type === 4) ext = parseInt(line.substr(9, 4), 16) << 16;
    else if (type === 0) {
      for (let i = 0; i < n; i++) {
        const a = ext + addr + i; if (a > 0xffff) continue;
        mem.set(a, parseInt(line.substr(9 + i * 2, 2), 16)); if (a < lo) lo = a; if (a > hi) hi = a;
      }
    }
  }
  if (hi < 0) throw new Error('HEXにデータがありません');
  const data = new Uint8Array(hi - lo + 1); for (const [a, v] of mem) data[a - lo] = v;
  return { segs: [{ addr: lo, data }], start: lo, end: hi + 1 };
}
export function parseBin(buf, addr) {
  const data = new Uint8Array(buf); return { segs: [{ addr, data }], start: addr, end: addr + data.length };
}
export function looksLikeHex(bytes) { return bytes.length > 0 && bytes[0] === 0x3a; }
