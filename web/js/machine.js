// Sharp Z80 pocket computer machine model (PC-E220 / PC-G815 / PC-G850V family).
// Hardware description derived from the public MAME driver (sharp/pce220.cpp); see SPEC.md.
// NOTE: no firmware ROM is bundled. The user supplies ROM images.
import { Z80 } from './z80.js';
import { HD61202Pair, SED1560 } from './lcd.js';
import { KEY_MATRIX } from './keymap.js';
import { installIocs } from './iocs.js';

export const MODELS = {
  pce220: {
    name: 'PC-E220', clock: 3072000, romBanks: 8, bank4Rom: false, lcd: 'hd61202', lcdRows: 32,
    romSize: 8 * 0x4000,
  },
  pcg815: {
    name: 'PC-G815', clock: 3072000, romBanks: 14, bank4Rom: false, lcd: 'hd61202x2', lcdRows: 48,
    romSize: 14 * 0x4000,
  },
  pcg850v: {
    name: 'PC-G850V', clock: 8000000, romBanks: 22, bank4Rom: true, lcd: 'sed1560', lcdRows: 48,
    romSize: 22 * 0x4000,
  },
};

const BANK = 0x4000;
const TIMER_PERIOD_MS = 468; // timer interrupt period used by MAME

export class Machine {
  /** opts.flat: ROM-less mode, 64K of flat RAM and a user supplied Z80 program (see setProgram). opts.clock: Hz. */
  constructor(modelId = 'pcg850v', opts = {}) {
    this.flat = !!opts.flat;
    this.refreshHz = opts.refresh || 120;   // LCD sampling rate for grey levels (emulated time)
    this.lcdScales = opts.lcdScales || 4;   // number of samples averaged
    this.lcdAcc = 0;
    this.audioEvents = []; // flat [t0, v0, t1, v1, ...] writes to port 0x18 (cpu T-state timestamps)
    this.image = []; this.entry = 0x100;
    this.model = MODELS[modelId];
    this.clock = opts.clock || this.model.clock;
    this.modelId = modelId;
    this.rom = new Uint8Array(this.model.romSize);
    this.romLoaded = false;
    this.ram = new Uint8Array(0x10000); // 32K internal + 32K external card
    this.lcd = this.model.lcd === 'sed1560' ? new SED1560() : new HD61202Pair(this.model.lcd === 'hd61202x2');
    this.cpu = new Z80({
      read: a => this.read(a), write: (a, v) => this.write(a, v),
      in: p => this.portIn(p), out: (p, v) => this.portOut(p, v),
    });
    this.keys = new Uint8Array(10); // pressed state per matrix line (bit set = pressed)
    this.shift = false;
    this.onKey = false;
    if (this.flat && opts.iocs !== false) installIocs(this);
    if (this.lcd.setScales) this.lcd.setScales(this.flat ? this.lcdScales : 1);
    this.reset();
  }

  loadROM(data) {
    // data: Uint8Array containing banks concatenated in order (rom00.bin, rom01.bin, ...)
    this.rom.fill(0xff);
    this.rom.set(data.subarray(0, this.rom.length));
    this.romLoaded = true;
    this.reset();
  }

  reset() {
    this.bootMapped = true;   // ROM bank 0 at 0x0000 and writes inhibited after power-on
    this.rom2 = 0; this.rom3 = 1; this.rom4 = 0; // bank2/bank3/bank4 ROM indices
    this.ramBank = 0;
    this.keyMask = 0;         // port 0x11/0x12 line select (10 bits)
    this.irqMask = 0; this.irqStatus = 0;
    this.timerStatus = 0;
    this.timerAcc = 0;
    this.ioReg18 = 0; this.buzzer = false;
    this.p1e = 0;
    this.cpu.reset();
    this.lcd.reset();
    this.audioEvents.length = 0;
    if (this.flat) this.resetFlat();
    this.updateIrq();
  }

  // ---- ROM-less machine-language mode
  /** segs: [{addr, data:Uint8Array}], entry: start address. */
  setProgram(segs, entry = 0x100) {
    this.image = segs; this.entry = entry & 0xffff; this.romLoaded = true; this.reset();
  }
  resetFlat() {
    this.ram.fill(0);
    for (const s of this.image) this.ram.set(s.data.subarray(0, Math.max(0, 0x10000 - s.addr)), s.addr);
    // A program that exits with RET lands on a HALT stub at 0xFFFE (page zero is left alone: some programs keep variables there).
    this.ram[0xfffe] = 0x76; this.ram[0xfff0] = 0xfe; this.ram[0xfff1] = 0xff;
    this.cpu.sp = 0xfff0; this.cpu.pc = this.entry;
    this.lastFired = 0; if (this.iocsUnknown) this.iocsUnknown.clear();
  }

  // ---- memory
  // 4 windows of 16K. MAME: bank1 rw, bank2 rw, bank3 ro, bank4 ro.
  // Boot: ROM bank 0 at 0x0000, writes inhibited until port 0x1A bit0 is written.
  // UNVERIFIED (no ROM to check against): which bank2 entry is RAM, RAM page numbering, bank4 select port.
  // These are isolated in resolve() so they can be corrected once a ROM is available.
  resolve(win) {
    switch (win) {
      case 0: return this.bootMapped ? { rom: 0 } : { ram: 0 };
      case 1: return this.rom2 === 0 ? { ram: 1 + this.ramBank * 2 } : { rom: this.rom2 };
      case 2: return { rom: this.rom3 };
      default: return this.model.bank4Rom ? { rom: this.rom4 } : { ram: 3 };
    }
  }
  read(a) {
    if (this.flat) return this.ram[a];
    const off = a & 0x3fff, m = this.resolve(a >> 14);
    if (m.rom !== undefined) { const i = m.rom * BANK + off; return i < this.rom.length ? this.rom[i] : 0xff; }
    return this.ram[m.ram * BANK + off];
  }
  write(a, v) {
    if (this.flat) { this.ram[a] = v; return; }
    const off = a & 0x3fff, w = a >> 14;
    if (w >= 2 && !(w === 3 && !this.model.bank4Rom)) return; // read-only windows (bank3, bank4 ROM)
    const m = this.resolve(w);
    if (m.ram !== undefined) this.ram[m.ram * BANK + off] = v;
  }

  // ---- ports (see SPEC.md)
  portIn(port) {
    const p = port & 0xff;
    if (this.model.lcd === 'sed1560' && (p & 0xfe) === 0x40) return this.lcd.read(p & 1);
    switch (p) {
      case 0x10: {
        let v = 0;
        for (let l = 0; l < 10; l++) if (this.keyMask & (1 << l)) v |= this.keys[l];
        return v;
      }
      case 0x13: return this.shift ? 1 : 0;
      case 0x14: return this.timerStatus;
      case 0x16: return this.irqStatus;
      case 0x18: return this.ioReg18;
      case 0x19: return ((this.rom2 & 7) << 4) | (this.rom3 & 0xf);
      case 0x1d: return 0; // battery OK
      case 0x1f: return (this.onKey ? 0x80 : 0) | 0x03;
      default:
        if (this.model.lcd !== 'sed1560') return this.lcd.read(p);
        return 0xff;
    }
  }

  portOut(port, v) {
    const p = port & 0xff;
    if (this.model.lcd === 'sed1560' && (p & 0xfe) === 0x40) { this.lcd.write(p & 1, v); return; }
    switch (p) {
      case 0x11: this.keyMask = (this.keyMask & 0x300) | v; break;
      case 0x12: this.keyMask = (this.keyMask & 0xff) | ((v & 3) << 8); break;
      case 0x14: this.irqStatus &= ~4; this.updateIrq(); break;
      case 0x16: this.irqStatus &= ~v; this.updateIrq(); break;
      case 0x17: this.irqMask = v; this.updateIrq(); break;
      case 0x18:
        this.ioReg18 = v & 0x7f; this.buzzer = !!(v & 0x80);
        if (this.audioEvents.length < 4e6) this.audioEvents.push(this.cpu.t, v);
        break;
      case 0x19: this.rom2 = (v >> 4) & 7; this.rom3 = v & 0xf; break;
      case 0x1a: if (v & 1) this.bootMapped = false; break;
      case 0x1b: this.ramBank = (v >> 2) & 1; break;
      case 0x1c: break;
      case 0x69: if (this.model.bank4Rom) this.rom4 = v % 22; break; // UNVERIFIED
      default:
        if (this.model.lcd !== 'sed1560') this.lcd.write(p, v);
    }
  }

  updateIrq() { this.cpu.irqLine = !!(this.irqStatus & this.irqMask); }

  // ---- input
  setKey(line, bit, down) {
    if (down) this.keys[line] |= 1 << bit; else this.keys[line] &= ~(1 << bit);
    if (down && line !== 0xff) { this.irqStatus |= 1; this.updateIrq(); }
    if (!down && !this.keys.some(v => v) && !this.shift) this.lastFired = 0;
  }
  setShift(down) { this.shift = down; }
  setOn(down) {
    this.onKey = down;
    if (down) { this.irqStatus |= 2; this.updateIrq(); }
  }

  // ---- run
  runMs(ms) {
    if (!this.romLoaded) return;
    // Interleave CPU and timer in 1 ms slices so interrupts are delivered at the right time.
    const perMs = this.clock / 1000;
    for (let left = ms; left > 0; left -= 1) {
      const slice = Math.min(1, left);
      const target = perMs * slice;
      let done = 0;
      while (done < target) done += this.cpu.step();
      this.timerAcc += slice;
      if (this.timerAcc >= TIMER_PERIOD_MS) {
        this.timerAcc -= TIMER_PERIOD_MS;
        this.timerStatus ^= 1; this.irqStatus |= 4; this.updateIrq();
      }
      if (this.flat) {
        this.lcdAcc += slice;
        const period = 1000 / this.refreshHz;
        while (this.lcdAcc >= period) { this.lcdAcc -= period; this.lcd.sampleFrame(); }
      }
    }
  }
}

export { KEY_MATRIX };
