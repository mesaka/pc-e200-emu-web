// Runs a Minesweeper BASIC program (.bas) on the ROM-less BASIC machine. The program is not part of this repository:
//   node tests/minesweeper.test.mjs path/to/minesweeper.bas
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BasicMachine } from '../web/js/basic/machine.js';

const file = process.argv[2] || process.env.MINESWEEPER_BAS;
if (!file) { console.log('No .bas file given: skipping minesweeper test (usage: node tests/minesweeper.test.mjs <file.bas>)'); process.exit(0); }

let clock = 0;
const m = new BasicMachine({ speed: Infinity, now: () => clock });
const step = (n = 5) => { for (let i = 0; i < n; i++) { clock += 100; m.runMs(100); } };
const press = k => { m.key(k); step(); };
const rows = () => m.lcd.text();
const board = () => rows().slice(0, 5).join('\n');
const ok = s => console.log('ok  ', s);

m.load(readFileSync(file, 'utf8')); m.type('RUN\r'); step(10);
assert.ok(m.interp.state !== 'idle', 'program is running (title screen waiting for a key)');
ok('starts and waits for a key');

press(' ');
assert.ok(rows().slice(0, 5).every(r => r.includes('#')), 'unopened cells (#) are shown on every board row');
assert.ok(rows()[5].includes('MINES: 8'), 'status line shows the mine count');
ok('board is drawn');

const before = board(); press('d'); press('s');
assert.notEqual(board(), before, 'cursor moved'); ok('cursor moves (WASD)');

press('f'); assert.ok(board().includes('F') && rows()[5].includes('MINES: 7'), 'flag placed and mine counter decreases');
press('f'); assert.ok(!board().includes('F') && rows()[5].includes('MINES: 8'), 'flag removed');
ok('flag toggles');

const closed = (board().match(/#/g) || []).length;
press(' '); // the first open is always safe
assert.ok((board().match(/#/g) || []).length < closed, 'opening a cell reveals cells');
assert.ok(!rows()[5].includes('BOOM'), 'the first open is never a mine');
ok('first open is safe and reveals cells');

press('r'); step();
assert.ok(rows().slice(0, 5).every(r => r.includes('#')), 'R restarts with a fresh board'); ok('restart (R)');
console.log('minesweeper tests passed');
