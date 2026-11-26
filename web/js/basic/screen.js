// 144x48 monochrome LCD: 24x6 text cells of 6x8 px, plus pixel graphics sharing one framebuffer.
import { FONT, BOX } from './font.js';
export const COLS = 24, ROWS = 6, W = 144, H = 48;

export class Screen {
  constructor() {
    this.W = W; this.H = H; this.cols = COLS; this.rows = ROWS;
    this.pixels = new Uint8Array(W * H);
    this.view = new Uint8Array(W * H);
    this.chars = new Array(COLS * ROWS).fill(' ');
    this.cx = 0; this.cy = 0; this.gx = 0; this.dirty = true; this.cursorVisible = true;
  }
  clear() { this.pixels.fill(0); this.chars.fill(' '); this.cx = 0; this.cy = 0; this.dirty = true; }
  glyph(code) { return code >= 32 && code <= 126 ? FONT[code - 32] : BOX; }
  drawCell(col, row, code) {
    const g = this.glyph(code), x0 = col * 6, y0 = row * 8;
    for (let i = 0; i < 6; i++) {
      const bits = i < 5 ? g[i] : 0;
      for (let r = 0; r < 8; r++) this.pixels[(y0 + r) * W + x0 + i] = (bits >> r) & 1;
    }
    this.chars[row * COLS + col] = code >= 32 && code <= 126 ? String.fromCharCode(code) : '?';
    this.dirty = true;
  }
  scroll() {
    this.pixels.copyWithin(0, W * 8);
    this.pixels.fill(0, W * 8 * (ROWS - 1));
    this.chars.copyWithin(0, COLS); this.chars.fill(' ', COLS * (ROWS - 1));
    this.dirty = true;
  }
  newline() { this.cx = 0; if (++this.cy >= ROWS) { this.cy = ROWS - 1; this.scroll(); } }
  putc(code) {
    if (code === 13 || code === 10) { this.newline(); return; }
    this.drawCell(this.cx, this.cy, code);
    if (++this.cx >= COLS) this.newline();
  }
  print(s) { for (let i = 0; i < s.length; i++) this.putc(s.charCodeAt(i)); }
  backspace() {
    if (this.cx === 0) { if (this.cy === 0) return; this.cy--; this.cx = COLS; }
    this.cx--; this.drawCell(this.cx, this.cy, 32);
  }
  locate(x, y) { this.cx = Math.max(0, Math.min(COLS - 1, x | 0)); this.cy = Math.max(0, Math.min(ROWS - 1, y | 0)); }
  text() { const o = []; for (let r = 0; r < ROWS; r++) o.push(this.chars.slice(r * COLS, r * COLS + COLS).join('').replace(/\s+$/, '')); return o; }
  // graphics
  pset(x, y, on = 1) { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W && y >= 0 && y < H) { this.pixels[y * W + x] = on; this.dirty = true; } }
  point(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && x < W && y >= 0 && y < H ? this.pixels[y * W + x] : -1; }
  line(x1, y1, x2, y2, on = 1) {
    x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
    const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.pset(x1, y1, on);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x1 += sx; }
      if (e2 <= dx) { e += dx; y1 += sy; }
    }
  }
  box(x1, y1, x2, y2, on = 1, fill = false) {
    if (fill) { const a = Math.min(y1, y2), b = Math.max(y1, y2); for (let y = a; y <= b; y++) this.line(x1, y, x2, y, on); return; }
    this.line(x1, y1, x2, y1, on); this.line(x2, y1, x2, y2, on); this.line(x2, y2, x1, y2, on); this.line(x1, y2, x1, y1, on);
  }
  circle(cx, cy, r, on = 1) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    let x = r, y = 0, e = 1 - r;
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.pset(cx + a, cy + b, on);
      y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
  }
  gprint(hex) { // each 2 hex digits = 7-bit column, bit0 = top of current text row
    for (let i = 0; i + 1 < hex.length; i += 2) {
      const v = parseInt(hex.substr(i, 2), 16); if (Number.isNaN(v)) continue;
      for (let r = 0; r < 8; r++) this.pset(this.gx, this.cy * 8 + r, (v >> r) & 1);
      this.gx = Math.min(W - 1, this.gx + 1);
    }
  }
  render() {
    this.view.set(this.pixels);
    if (this.cursorVisible && Math.floor(Date.now() / 500) % 2 === 0 && this.cx < COLS) {
      const y = this.cy * 8 + 7; for (let i = 0; i < 5; i++) this.view[y * W + this.cx * 6 + i] = 1;
    }
    this.dirty = false; return this.view;
  }
}
