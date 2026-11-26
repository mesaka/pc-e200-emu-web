// BasicMachine: ROM-less BASIC pocket computer. Same surface as the Z80 Machine used by main.js.
import { Screen } from './screen.js';
import { Interp, fmtNum } from './interp.js';

export class BasicMachine {
  constructor(opts = {}) {
    this.lcd = new Screen();
    this.romLoaded = true;           // nothing to load
    this.model = { name: 'BASIC (ROM不要)' };
    this.speed = opts.speed ?? 3000; // statements/second; Infinity = unthrottled
    this.beepHandler = opts.onBeep || (() => {});
    this.nowFn = opts.now || (() => Date.now());
    this.keyq = [];
    this.listJob = null; this.listRows = 0; this.listWait = false;
    this.mode = 'run'; this.buf = ''; this.acc = 0;
    this.io = {
      now: () => this.nowFn(),
      beep: (f, ms) => this.beepHandler(f, ms),
      inkey: () => (this.keyq.length ? this.keyq.shift() : ''),
      requestInput: () => { this.mode = 'edit'; this.buf = ''; },
      listLines: lines => { this.listJob = lines.slice(); this.listRows = 0; this.listWait = false; },
      onIdle: () => this.prompt(),
    };
    this.interp = new Interp(this.lcd, this.io);
    this.reset();
  }
  reset() {
    this.interp.clearAll(); this.lcd.clear(); this.keyq = []; this.listJob = null;
    this.lcd.print('POCKET BASIC'); this.lcd.newline();
    this.prompt();
  }
  prompt() {
    const s = this.lcd;
    if (s.cx !== 0) s.newline();
    s.print('>'); this.mode = 'edit'; this.buf = '';
  }
  load(text) { this.interp.loadText(text); }
  listing() { return this.interp.listText(); }
  run() { this.type('RUN\r'); }

  // ---- input
  type(str) { for (const ch of str) this.key(ch === '\n' ? '\r' : ch); }
  key(ch) {
    const it = this.interp;
    if (ch === 'BREAK') {
      if (this.listJob) { this.listJob = null; this.prompt(); return; }
      if (it.state !== 'idle') { it.breakRun(); } return;
    }
    if (this.listJob && this.listWait) { this.listWait = false; this.listRows = 0; return; }
    if (this.mode !== 'edit') { if (ch.length === 1 || ch === 'UP' || ch === 'DOWN' || ch === 'LEFT' || ch === 'RIGHT') { this.keyq.push(KEYCODE[ch] || ch); if (this.keyq.length > 16) this.keyq.shift(); } return; }
    if (ch === '\r' || ch === 'ENTER') { this.submit(); return; }
    if (ch === 'BS' || ch === '\b') { if (this.buf.length) { this.buf = this.buf.slice(0, -1); this.lcd.backspace(); } return; }
    if (ch.length === 1 && ch >= ' ' && ch <= '~' && this.buf.length < 250) { this.buf += ch; this.lcd.putc(ch.charCodeAt(0)); }
  }
  submit() {
    const line = this.buf; this.buf = ''; this.lcd.newline();
    const it = this.interp;
    if (it.state === 'waitInput') { this.mode = 'run'; it.provideInput(line); if (it.state === 'running') this.mode = 'run'; return; }
    const m = it.parseNumbered(line);
    try {
      if (m) { it.setLine(m[0], m[1]); this.prompt(); return; }
      if (line.trim() === '') { this.prompt(); return; }
      this.mode = 'run';
      it.runDirect(line);
      // execute immediately for direct commands so short ones finish in the same frame
    } catch (e) {
      if (e && e.code) { this.lcd.print(`ERROR ${e.code}`); this.lcd.newline(); this.prompt(); } else throw e;
    }
  }

  // ---- run
  runMs(ms) {
    const it = this.interp;
    if (this.listJob && !this.listWait) {
      while (this.listJob.length && this.listRows < 5) { this.lcd.print(this.listJob.shift().slice(0, 24)); if (this.lcd.cx) this.lcd.newline(); this.listRows++; }
      if (!this.listJob.length) { this.listJob = null; this.prompt(); } else this.listWait = true;
      return;
    }
    if (it.state === 'idle' || it.state === 'waitInput') return;
    this.acc += this.speed === Infinity ? 1e6 : (ms * this.speed) / 1000;
    const n = Math.min(Math.floor(this.acc), this.speed === Infinity ? 200000 : 100000);
    this.acc -= n === 1e6 ? 0 : Math.min(this.acc, n);
    if (this.speed === Infinity) this.acc = 0;
    it.tick(this.nowFn(), n);
  }
  // ---- calculator helpers (memory / angle mode)
  get ans() { return this.interp.ans; }
  get calcMem() { return this.interp.calcMem; }
  /** M+ (sign=1) / M- (sign=-1): adds the line being typed (evaluated) or else ANS to memory. */
  memAdd(sign) {
    const it = this.interp, s = this.lcd;
    if (this.mode !== 'edit' || it.state !== 'idle') return;
    let v = it.ans;
    if (this.buf.trim() !== '') {
      try { v = it.evalNow(this.buf); if (typeof v !== 'number') throw new Error('type'); }
      catch (e) { s.newline(); s.print('ERROR ' + (e.code || 1)); this.buf = ''; this.prompt(); return; }
      this.buf = '';
    }
    it.calcMem = +(it.calcMem + sign * v).toPrecision(13);
    if (s.cx !== 0) s.newline();
    const t = 'M=' + fmtNum(it.calcMem); s.print(' '.repeat(Math.max(0, 24 - t.length)) + t); s.newline();
    this.prompt();
  }
  memClear() { this.interp.calcMem = 0; }
  memRecallText() { return fmtNum(this.interp.calcMem); }
  /** Cycles DEGREE -> RADIAN -> GRAD; returns mode name. */
  cycleAngle() { this.interp.angle = (this.interp.angle + 1) % 3; return ANGLES[this.interp.angle]; }
  get angleName() { return ANGLES[this.interp.angle]; }

  // soft keyboard / matrix compatibility no-ops
  setKey() {} setShift() {} setOn(d) { if (d) this.key('BREAK'); }
}
const ANGLES = ['DEG', 'RAD', 'GRAD'];
const KEYCODE = { UP: String.fromCharCode(30), DOWN: String.fromCharCode(31), LEFT: String.fromCharCode(29), RIGHT: String.fromCharCode(28) };
