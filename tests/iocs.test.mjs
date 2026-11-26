// System-call emulation (IOCS) tests using tiny hand-assembled programs; no ROM and no external files needed.
import assert from 'node:assert/strict';
import { Machine } from '../web/js/machine.js';
import { KEY_MATRIX } from '../web/js/keymap.js';
import { FONT } from '../web/js/basic/font.js';

const mk = bytes => { const m = new Machine('pcg850v', { flat: true, clock: 8000000 }); m.setProgram([{ addr: 0x100, data: Uint8Array.from(bytes) }], 0x100); return m; };
const key = (m, n, d) => { const [l, b] = KEY_MATRIX[n]; m.setKey(l, b, d); };

// PUTCHR: A='A', D=row 1, E=col 2
{
  const m = mk([0x3e, 0x41, 0x11, 0x02, 0x01, 0xcd, 0x62, 0xbe, 0x76]); m.runMs(5);
  assert.ok(m.cpu.halted, 'program finished');
  for (let i = 0; i < 5; i++) assert.equal(m.lcd.vram[1 * 256 + 2 * 6 + i], FONT['A'.charCodeAt(0) - 32][i]);
  console.log('ok   PUTCHR draws a character at (col,row)');
}
// PUTCHRS: fill 30 cells with '*' starting at row 0 col 20 -> wraps to the next row
{
  const m = mk([0x3e, 0x2a, 0x06, 0x1e, 0x11, 0x14, 0x00, 0xcd, 0xee, 0xbf, 0x76]); m.runMs(5);
  const g = FONT['*'.charCodeAt(0) - 32];
  assert.equal(m.lcd.vram[0 * 256 + 23 * 6 + 1], g[1]); assert.equal(m.lcd.vram[1 * 256 + 0 * 6 + 1], g[1]);
  assert.equal(m.lcd.vram[1 * 256 + 23 * 6 + 1], g[1]); // 4 on row 0 + 24 on row 1 + 2 on row 2 = 30
  assert.equal(m.lcd.vram[2 * 256 + 1 * 6 + 1], g[1]); assert.equal(m.lcd.vram[2 * 256 + 2 * 6 + 1], 0);
  console.log('ok   PUTCHRS repeats and wraps');
}
// PUTSTR: "HI" at row 2 col 1, then HL advances
{
  const m = mk([0x21, 0x10, 0x01, 0x11, 0x01, 0x02, 0x06, 0x02, 0xcd, 0xf1, 0xbf, 0x22, 0x00, 0x80, 0x76, 0x48, 0x49]);
  m.ram.set([0x48, 0x49], 0x110); m.runMs(5);
  assert.equal(m.lcd.vram[2 * 256 + 1 * 6 + 1], FONT['H'.charCodeAt(0) - 32][1]);
  assert.equal(m.lcd.vram[2 * 256 + 2 * 6 + 1], FONT['I'.charCodeAt(0) - 32][1]);
  assert.equal(m.ram[0x8000] | (m.ram[0x8001] << 8), 0x112, 'HL advanced');
  console.log('ok   PUTSTR prints a string and advances HL');
}
// PUTPAT: 3 raw columns at row 3 col 4
{
  const m = mk([0x21, 0x10, 0x01, 0x11, 0x04, 0x03, 0x06, 0x03, 0xcd, 0xd0, 0xbf, 0x76]);
  m.ram.set([0x11, 0x22, 0x33], 0x110); m.runMs(5);
  assert.deepEqual([...m.lcd.vram.slice(3 * 256 + 24, 3 * 256 + 27)], [0x11, 0x22, 0x33]);
  console.log('ok   PUTPAT writes raw LCD columns');
}
// INKEY: scan codes (line*8 + bit + 1), SHIFT = +0x80, two keys = 0x52, none = carry clear
{
  const prog = [0xcd, 0x53, 0xbe, 0x32, 0x00, 0x80, 0x3e, 0x00, 0x17, 0x32, 0x01, 0x80, 0x76];
  const run = setup => { const m = mk(prog); setup(m); m.runMs(5); return [m.ram[0x8000], m.ram[0x8001]]; };
  assert.deepEqual(run(() => {}), [0, 0]);
  assert.deepEqual(run(m => key(m, 'SPACE', true)), [0x1e, 1]);
  assert.deepEqual(run(m => { key(m, 'Q', true); m.setShift(true); }), [0x82, 1]);
  assert.deepEqual(run(m => { key(m, 'A', true); key(m, 'S', true); }), [0x52, 1]);
  assert.deepEqual(run(m => m.setOn(true)), [0x51, 1]);
  assert.deepEqual(run(m => key(m, '2', true)), [0x2d, 1]);
  console.log('ok   INKEY returns scan codes and carry');
}
// GETKEY: blocks until a new key press; a held key is returned once
{
  const m = mk([0xcd, 0xfd, 0xbc, 0x32, 0x00, 0x80, 0xcd, 0xfd, 0xbc, 0x32, 0x01, 0x80, 0x76]);
  m.runMs(20); assert.ok(!m.cpu.halted && m.ram[0x8000] === 0, 'waits for a key');
  key(m, 'A', true); m.runMs(20);
  assert.equal(m.ram[0x8000], 0x09); assert.ok(!m.cpu.halted, 'held key is not returned twice');
  key(m, 'A', false); m.runMs(5); key(m, 'S', true); m.runMs(20);
  assert.equal(m.ram[0x8001], 0x0a); assert.ok(m.cpu.halted);
  console.log('ok   GETKEY waits for a new key');
}
// unknown system entries are recorded and return immediately
{
  const m = mk([0xcd, 0x00, 0xbd, 0x76]); m.runMs(5);
  assert.ok(m.cpu.halted && m.iocsUnknown.has(0xbd00));
  console.log('ok   unknown system entries are reported');
}
console.log('iocs tests passed');
