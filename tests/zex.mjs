// Runs CP/M test programs (zexdoc.com / zexall.com) on the Z80 core.
import { readFileSync } from 'node:fs';
import { Z80 } from '../web/js/z80.js';

import { existsSync } from 'node:fs';
const file = process.argv[2] || new URL('./fixtures/zexdoc.com', import.meta.url).pathname;
if (!existsSync(file)) {
  console.log('zexdoc.com not found. Put the CP/M test binary at tests/fixtures/zexdoc.com (or pass its path) to run the Z80 instruction exerciser; skipping.');
  process.exit(0);
}
const mem = new Uint8Array(65536);
mem.set(readFileSync(file), 0x100);
mem[0] = 0x76; // HALT at warm boot
mem[5] = 0xc9; // RET at BDOS entry
let out = '';
const cpu = new Z80({
  read: a => mem[a], write: (a, v) => { mem[a] = v; },
  in: () => 0xff, out: () => {},
});
cpu.pc = 0x100; cpu.sp = 0xf000;
let failed = 0;
const t0 = Date.now();
for (;;) {
  if (cpu.pc === 5) { // BDOS call
    const fn = cpu.r8[1];
    if (fn === 2) out += String.fromCharCode(cpu.r8[3]);
    else if (fn === 9) { let a = cpu.de; while (mem[a] !== 0x24) out += String.fromCharCode(mem[a++]); }
  }
  if (cpu.pc === 0 && cpu.halted) break;
  if (cpu.pc === 0 && cpu.t > 0) { /* warm boot jump */ break; }
  cpu.step();
  if (out.includes('\n')) {
    const lines = out.split('\n'); out = lines.pop();
    for (const l of lines) { if (l.trim()) { process.stdout.write(l + '\n'); if (/ERROR/.test(l)) failed++; } }
  }
}
process.stdout.write(out + '\n');
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, T-states=${cpu.t}`);
process.exit(failed ? 1 : 0);
