import assert from 'node:assert/strict';
import { Machine } from '../web/js/machine.js';

// Synthetic ROM (not firmware): exercises boot map, ports, LCD, keys, timer IRQ.
const rom = new Uint8Array(22 * 0x4000).fill(0);
// Program at 0x0000 (boot ROM bank 0):
const code = [
  0x3e, 0x01, 0xd3, 0x1a,       // LD A,1 ; OUT (0x1A),A  -> RAM replaces boot ROM at 0x0000
  0x3e, 0xaf, 0xd3, 0x40,       // display ON  (cmd 0xAF)
  0x3e, 0xb0, 0xd3, 0x40,       // page 0
  0x3e, 0xff, 0xd3, 0x41,       // data 0xFF -> col 0
  0x3e, 0x02, 0xd3, 0x11,       // select key line 1 (bit1)
  0xdb, 0x10, 0x32, 0x10, 0x00, // IN A,(0x10) ; LD (0x0010),A   (RAM now at 0)
  0x76,                         // HALT
];
rom.set([0xc3, 0x00, 0x80], 0);     // boot: JP 0x8000 (bank3 window = ROM bank 1)
rom.set(code, 0x4000);
const m = new Machine('pcg850v');
m.loadROM(rom);

// press key 'S' (line1 bit1) before running
m.setKey(1, 1, true);
m.runMs(5);
const px = m.lcd.render();
assert.equal(px[0], 1, 'LCD pixel (0,0) on'); assert.equal(px[7 * 144], 1, 'LCD pixel (0,7) on'); assert.equal(px[8 * 144], 0);
assert.equal(m.ram[0x10], 0x02, 'key matrix read returned bit1');
assert.equal(m.bootMapped, false);

// ROM at boot is write-protected
const m2 = new Machine('pcg850v'); m2.loadROM(rom);
m2.write(0x0000, 0x55); assert.equal(m2.read(0x0000), rom[0]);

// timer IRQ: IM1 -> 0x0038, flag in port 0x16 bit2, ack through 0x14
const m3 = new Machine('pcg850v');
const r3 = new Uint8Array(22 * 0x4000);
r3.set([0xc3, 0x00, 0x80], 0);
r3.set([0x31, 0x00, 0x70, 0x3e, 1, 0xd3, 0x1a, 0x3e, 4, 0xd3, 0x17, 0xed, 0x56, 0xfb, 0x76], 0x4000); // OUT 1A; mask=4; IM 1; EI; HALT
r3.set([0xdb, 0x16, 0x32, 0x20, 0x00, 0xd3, 0x14, 0xfb, 0xed, 0x4d], 0x38);      // ISR: IN 16 -> (0x20); ack; EI; RETI
// ISR at 0x38 lives in boot ROM window -> after RAM switch it's RAM; copy ISR into RAM through CPU instead.
m3.loadROM(r3);
m3.ram.set([0xdb, 0x16, 0x32, 0x20, 0x00, 0xd3, 0x14, 0xfb, 0xed, 0x4d], 0x38);
m3.runMs(1000);
assert.equal(m3.ram[0x20] & 4, 4, "timer IRQ delivered");
assert.equal(m3.ram[0x20] & 4, 4, 'timer IRQ delivered');
console.log('machine tests passed');
