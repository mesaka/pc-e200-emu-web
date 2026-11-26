// LCD controllers. Both expose a 144x(32|48) 1-bit framebuffer via `pixels` (Uint8Array, 1 byte/pixel).
// UNVERIFIED against real firmware: command sets implemented from the public datasheets (HD61202 / SED1560 family).

import { FONT, BOX } from './basic/font.js';

export class SED1560 {
  // PC-G850V: 144x48, ports 0x40 (command/status) and 0x41 (data).
  constructor() { this.W = 144; this.H = 48; this.vram = new Uint8Array(8 * 256); this.pixels = new Uint8Array(144 * 48); this.reset(); }
  reset() {
    this.page = 0; this.col = 0; this.on = true; this.startLine = 0; this.adc = 0; this.rmw = false; this.rmwCol = 0;
    this.reverse = false; this.allOn = false; this.latch = 0; this.vram.fill(0); this.dirty = true;
  }
  read(rs) {
    if (rs === 0) return this.on ? 0x00 : 0x20; // status: not busy
    // Data reads go through a latch: the first read after setting an address returns the stale latch.
    const v = this.latch;
    this.latch = this.vram[this.page * 256 + (this.col & 0xff)];
    if (!this.rmw) this.col++;
    return v;
  }
  write(rs, v) {
    if (rs === 1) {
      this.vram[this.page * 256 + (this.col & 0xff)] = v; this.col++; this.dirty = true; return;
    }
    if ((v & 0xf0) === 0xb0) this.page = v & 0x0f & 7;
    else if ((v & 0xf0) === 0x00) this.col = (this.col & 0xf0) | (v & 0x0f);
    else if ((v & 0xf0) === 0x10) this.col = (this.col & 0x0f) | ((v & 0x0f) << 4);
    else if ((v & 0xc0) === 0x40) this.startLine = v & 0x3f;
    else if (v === 0xae) this.on = false;
    else if (v === 0xaf) this.on = true;
    else if (v === 0xa0) this.adc = 0;
    else if (v === 0xa1) this.adc = 1;
    else if (v === 0xa6) this.reverse = false;
    else if (v === 0xa7) this.reverse = true;
    else if (v === 0xa4) this.allOn = false;
    else if (v === 0xa5) this.allOn = true;
    else if (v === 0xe0) { this.rmw = true; }
    else if (v === 0xee) { this.rmw = false; }
    else if (v === 0xe2) this.reset();
    this.dirty = true;
  }
  // ---- helpers used by the emulated system calls
  putChar(col, row, code) {
    if (col < 0 || col >= 24 || row < 0 || row >= 6) return;
    const g = code >= 32 && code <= 126 ? FONT[code - 32] : BOX, base = row * 256 + col * 6;
    for (let i = 0; i < 6; i++) this.vram[base + i] = i < 5 ? g[i] & 0x7f : 0;
    this.dirty = true;
  }
  putPattern(col, row, bytes) {
    if (row < 0 || row >= 8) return;
    const base = row * 256 + col * 6;
    for (let i = 0; i < bytes.length && base + i < row * 256 + 256; i++) this.vram[base + i] = bytes[i];
    this.dirty = true;
  }
  // ---- grey levels: average of the last `scales` samples (the LCD has persistence; games flicker pixels for 4 shades)
  setScales(n) { this.scales = Math.max(1, n | 0); this.ring = []; this.sum = new Uint16Array(144 * 48); this.ringPos = 0; }
  sampleFrame() {
    const f = Uint8Array.from(this.render());
    if (!this.ring) this.setScales(this.scales || 1);
    if (this.ring.length < this.scales) this.ring.push(f);
    else { const old = this.ring[this.ringPos]; for (let i = 0; i < f.length; i++) this.sum[i] -= old[i]; this.ring[this.ringPos] = f; this.ringPos = (this.ringPos + 1) % this.scales; }
    for (let i = 0; i < f.length; i++) this.sum[i] += f[i];
    if (this.ring.length < this.scales) { /* sum already includes pushed frame */ }
  }
  renderGray() {
    if (!this.ring || !this.ring.length) { const p = this.render(); this.gray = this.gray || new Uint8Array(144 * 48); for (let i = 0; i < p.length; i++) this.gray[i] = p[i] * 255; return this.gray; }
    this.gray = this.gray || new Uint8Array(144 * 48);
    const n = this.ring.length;
    for (let i = 0; i < this.gray.length; i++) this.gray[i] = (this.sum[i] * 255 / n) | 0;
    return this.gray;
  }
  render() {
    const px = this.pixels;
    for (let y = 0; y < 48; y++) {
      const ly = (y + this.startLine) % 64; const pg = ly >> 3, bit = ly & 7;
      for (let x = 0; x < 144; x++) {
        const col = this.adc ? 143 - x : x;
        let on = this.on && ((this.vram[(pg & 7) * 256 + col] >> bit) & 1);
        if (this.allOn) on = 1;
        if (this.reverse) on ^= 1;
        px[y * 144 + x] = on ? 1 : 0;
      }
    }
    this.dirty = false;
    return px;
  }
}

export class HD61202Pair {
  // PC-E220 (single chip, 144x32 via two halves is board-specific) / PC-G815 (two chips).
  // Chip-select layout is firmware-dependent and UNVERIFIED; this is a placeholder with a standard HD61202 core.
  constructor(dual) {
    this.dual = dual; this.W = 144; this.H = dual ? 48 : 32;
    this.chips = [new HD61202(), new HD61202()];
    this.pixels = new Uint8Array(144 * this.H);
    this.dirty = true;
  }
  reset() { this.chips.forEach(c => c.reset()); this.dirty = true; }
  read(p) { const c = this.chips[(p & 2) ? 1 : 0]; return c.read(p & 1); }
  write(p, v) { const c = this.chips[(p & 2) ? 1 : 0]; c.write(p & 1, v); this.dirty = true; }
  render() {
    // Placeholder layout: chip0 = left 64 columns, chip1 = right 64 columns (+ 16 shared), refine with ROM.
    this.pixels.fill(0);
    for (let y = 0; y < this.H; y++) for (let x = 0; x < 144; x++) {
      const chip = x < 72 ? this.chips[0] : this.chips[1]; const cx = x < 72 ? x : x - 72;
      this.pixels[y * 144 + x] = chip.on && ((chip.vram[((y >> 3) & 7) * 64 + cx] >> (y & 7)) & 1) ? 1 : 0;
    }
    this.dirty = false;
    return this.pixels;
  }
}

class HD61202 {
  constructor() { this.vram = new Uint8Array(8 * 64); this.reset(); }
  reset() { this.on = false; this.page = 0; this.col = 0; this.start = 0; this.vram.fill(0); }
  read(rs) {
    if (rs === 0) return this.on ? 0 : 0x20;
    const v = this.vram[this.page * 64 + (this.col & 63)]; this.col = (this.col + 1) & 63; return v;
  }
  write(rs, v) {
    if (rs === 1) { this.vram[this.page * 64 + (this.col & 63)] = v; this.col = (this.col + 1) & 63; return; }
    if ((v & 0xfe) === 0x3e) this.on = !!(v & 1);
    else if ((v & 0xc0) === 0x40) this.col = v & 63;
    else if ((v & 0xf8) === 0xb8) this.page = v & 7;
    else if ((v & 0xc0) === 0xc0) this.start = v & 63;
  }
}
