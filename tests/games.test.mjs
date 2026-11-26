// Runs real PC-G850 games (maruhiro's SAME/shoot/reversi/hana, rogue). The programs are not part of this repository:
//   GAMES_DIR=/path/with/the/unzipped/folders node tests/games.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Machine } from '../web/js/machine.js';
import { parseHex } from '../web/js/hex.js';
import { KEY_MATRIX } from '../web/js/keymap.js';

const dir = process.env.GAMES_DIR;
if (!dir) { console.log('GAMES_DIR not set: skipping game tests'); process.exit(0); }
const FILES = { same: 'same20100807/same/same.ihx', shoot: 'shoot20080330_2/shoot/shoot850v.ihx', reversi: 'reversi20060825/reversi/reversi.ihx', hana: 'hana20091213/hana/hana850v.ihx', rogue: 'rogue20150412/rogue/rogue.ihx' };
const boot = n => { const m = new Machine('pcg850v', { flat: true, clock: 8000000 }); m.setProgram(parseHex(readFileSync(`${dir}/${FILES[n]}`, 'utf8')).segs, 0x100); return m; };
const press = (m, n, ms = 150, gap = 250) => { const [l, b] = KEY_MATRIX[n]; m.setKey(l, b, true); m.runMs(ms); m.setKey(l, b, false); m.runMs(gap); };
const snap = m => Uint8Array.from(m.lcd.render());
const lit = m => snap(m).reduce((a, b) => a + b, 0);
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
const ok = s => console.log('ok  ', s);

for (const n of Object.keys(FILES)) if (!existsSync(`${dir}/${FILES[n]}`)) { console.log('missing', FILES[n], '- skipping that game'); delete FILES[n]; }

if (FILES.same) {
  const m = boot('same'); m.runMs(1000); assert.ok(lit(m) > 1500, 'board drawn'); assert.ok(!m.cpu.halted);
  const a = snap(m); press(m, '6'); press(m, '2'); assert.ok(diff(a, snap(m)) > 20, 'cursor moves');
  const b = snap(m); for (let i = 0; i < 8; i++) { press(m, 'SPACE'); press(m, '6'); } assert.ok(diff(b, snap(m)) > 200, 'stones removed');
  assert.equal(m.iocsUnknown.size, 0); ok('SAME GAME: board, cursor and selection');
}
if (FILES.shoot) {
  const m = boot('shoot'); m.runMs(800); const title = lit(m); assert.ok(title > 300);
  press(m, 'SPACE', 150, 300); m.runMs(1500); const a = snap(m); press(m, '1', 300, 100); m.runMs(300);
  assert.ok(diff(a, snap(m)) > 40, 'scrolling/ship moves'); assert.equal(m.iocsUnknown.size, 0); ok('shoot: title, start, controls');
}
if (FILES.reversi) {
  const m = boot('reversi'); m.runMs(800); assert.equal(m.cpu.pc, 0xbcfd, 'waiting for a key at the title');
  press(m, '1', 150, 400); press(m, '1', 150, 400); m.runMs(500); const a = snap(m);
  press(m, 'D', 150, 400); press(m, '3', 150, 400); m.runMs(3000);
  assert.ok(diff(a, snap(m)) > 30, 'the move is played and the computer answers'); ok('Reversi: title, board, a move and the reply');
}
if (FILES.hana) {
  const m = boot('hana'); m.runMs(2500); assert.ok(lit(m) > 500);
  const levels = new Set(m.lcd.renderGray()); assert.ok(levels.size >= 4, 'grey levels: ' + [...levels]);
  const a = snap(m); press(m, '8', 200, 600); m.runMs(2500); press(m, '6', 200, 600); press(m, '8', 200, 600); m.runMs(2500);
  assert.ok(diff(a, snap(m)) > 300, 'game screen follows input'); assert.equal(m.iocsUnknown.size, 0); ok('Hanafuda: 4-level grey, title and play');
}
if (FILES.rogue) {
  const m = boot('rogue'); m.runMs(3000); assert.ok(!m.cpu.halted && lit(m) > 200, 'dungeon drawn'); const a = snap(m);
  for (const k of ['6', '6', '6', '2']) press(m, k, 150, 350); m.runMs(800);
  assert.ok(diff(a, snap(m)) > 100, 'the player moves'); assert.equal(m.iocsUnknown.size, 0); ok('Rogue: dungeon and movement');
}
console.log('game tests passed');
