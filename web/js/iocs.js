// High-level emulation of the PC-G850 system ROM entry points (IOCS) that user programs call at 0xBCxx-0xBFxx.
// There is no ROM: the CPU is hooked on these addresses and the call is done here, then a RET is performed.
//
// Specification inferred from public source of programs that use these calls (rogue.h names: _inkey, _getkey, _putchrs)
// and their call sites. NOT verified against a real ROM -- see SPEC.md.
//
//  BE53 INKEY    out: CY=1 key pressed, A=scan code (0 if none; |0x80 with SHIFT; 0x52 for two keys; 0x51 = ON/BREAK)
//  BCFD GETKEY   waits for a new key press; out: A=scan code
//  BE62 PUTCHR   A=char, E=column(0-23), D=row(0-5): draws one character, cursor is not moved
//  BE5F          same as BE62 (entered with JP by some programs)
//  BFEE PUTCHRS  A=char, B=count, DE=start: repeats a character (wraps to the next row)
//  BFF1 PUTSTR   HL=string, B=count, DE=start: draws B characters, HL advances
//  BFD0 PUTPAT   HL=pattern, B=bytes, DE=position: writes B raw LCD columns, HL advances
import { KEY_ROWS } from './keymap.js';

export const KEY_BREAK = 0x51, KEY_DOUBLE = 0x52, KEY_SHIFT = 0x80;
export const IOCS_ENTRIES = [0xbcfd, 0xbe53, 0xbe5f, 0xbe62, 0xbfd0, 0xbfee, 0xbff1];

/** Returns { code, pressed } for the current key matrix state. scan code = line*8 + bit + 1. */
export function scanKeys(m) {
  const found = [];
  for (let l = 0; l < 10; l++) for (let b = 0; b < 8; b++) if (m.keys[l] & (1 << b)) found.push(l * 8 + b + 1);
  if (m.onKey) found.push(KEY_BREAK);
  if (!found.length) return { code: 0, pressed: false };
  if (found.length > 1) return { code: KEY_DOUBLE | (m.shift ? KEY_SHIFT : 0), pressed: true };
  return { code: found[0] | (m.shift ? KEY_SHIFT : 0), pressed: true };
}

export function installIocs(m) {
  const cpu = m.cpu;
  m.iocsUnknown = new Set();
  m.lastFired = 0;
  const ret = c => { c.pc = c.pop(); };
  const setCarry = (c, on) => { c.f = (c.f & ~1) | (on ? 1 : 0); };
  const putc = (code, col, row) => m.lcd.putChar(col, row, code);
  const table = new Map();

  table.set(0xbe53, c => { // INKEY
    const k = scanKeys(m); c.r8[7] = k.code; setCarry(c, k.pressed); ret(c); return 120;
  });
  table.set(0xbcfd, c => { // GETKEY (blocking: stays on the instruction until a new key arrives)
    const k = scanKeys(m);
    if (!k.pressed) { m.lastFired = 0; return 60; }
    if (k.code === m.lastFired) return 60;
    m.lastFired = k.code; c.r8[7] = k.code; setCarry(c, true); ret(c); return 120;
  });
  const putchr = c => { putc(c.r8[7], c.r8[3], c.r8[2]); ret(c); return 200; };
  table.set(0xbe62, putchr);
  table.set(0xbe5f, putchr);
  table.set(0xbfee, c => { // PUTCHRS
    let col = c.r8[3], row = c.r8[2], n = c.r8[0] || 256;
    while (n-- > 0) { putc(c.r8[7], col, row); if (++col >= 24) { col = 0; row++; } }
    ret(c); return 1500;
  });
  table.set(0xbff1, c => { // PUTSTR
    let col = c.r8[3], row = c.r8[2], n = c.r8[0] || 256, hl = c.hl;
    while (n-- > 0) { putc(m.read(hl), col, row); hl = (hl + 1) & 0xffff; if (++col >= 24) { col = 0; row++; } }
    c.hl = hl; ret(c); return 1500;
  });
  table.set(0xbfd0, c => { // PUTPAT
    const n = c.r8[0] || 256, bytes = new Uint8Array(n); let hl = c.hl;
    for (let i = 0; i < n; i++) { bytes[i] = m.read(hl); hl = (hl + 1) & 0xffff; }
    m.lcd.putPattern(c.r8[3], c.r8[2], bytes);
    c.hl = hl; ret(c); return 800;
  });

  cpu.hooks = table; cpu.hookMin = 0xbc00; cpu.hookMax = 0xbfff;
  cpu.hookDefault = c => { // any other system entry: remember it and return immediately
    m.iocsUnknown.add(c.pc); ret(c); return 100;
  };
}
