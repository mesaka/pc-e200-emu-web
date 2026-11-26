// Z80 CPU core (documented + common undocumented behaviour: X/Y flags, IXH/IXL, SLL, DDCB copy).
// bus: { read(addr), write(addr, v), in(port16), out(port16, v) }
const S = 0x80, Z = 0x40, Y = 0x20, H = 0x10, X = 0x08, PV = 0x04, N = 0x02, C = 0x01;

const PAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0, v = i;
  while (v) { p ^= v & 1; v >>= 1; }
  PAR[i] = p ? 0 : PV;
}
const SZ = new Uint8Array(256);
for (let i = 0; i < 256; i++) SZ[i] = (i & (S | Y | X)) | (i === 0 ? Z : 0);
const SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) SZP[i] = SZ[i] | PAR[i];

export class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.r8 = new Uint8Array(8); // B C D E H L (unused) A
    this.alt = new Uint8Array(8);
    // address hooks (set by the machine; they survive reset)
    this.hooks = null; this.hookMin = 0; this.hookMax = -1; this.hookDefault = null;
    this.reset();
  }

  reset() {
    this.r8.fill(0); this.alt.fill(0);
    this.r8[7] = 0xff; this.f = 0xff;
    this.af_ = 0xffff;
    this.sp = 0xffff; this.pc = 0;
    this.ix = 0xffff; this.iy = 0xffff;
    this.i = 0; this.r = 0;
    this.iff1 = false; this.iff2 = false; this.im = 0;
    this.halted = false; this.eiDelay = false;
    this.irqLine = false;
    this.t = 0; // total T-states
    this.memptr = 0;
  }

  // ---- bus helpers
  rd(a) { return this.bus.read(a & 0xffff); }
  wr(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr16(a, v) { this.wr(a, v); this.wr(a + 1, v >> 8); }
  fetch() { const v = this.bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const l = this.fetch(); return l | (this.fetch() << 8); }
  fetchOp() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); return this.fetch(); }
  push(v) { this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v); }
  pop() { const l = this.rd(this.sp); this.sp = (this.sp + 1) & 0xffff; const h = this.rd(this.sp); this.sp = (this.sp + 1) & 0xffff; return l | (h << 8); }

  get af() { return (this.r8[7] << 8) | this.f; }
  set af(v) { this.r8[7] = v >> 8; this.f = v & 0xff; }
  get bc() { return (this.r8[0] << 8) | this.r8[1]; }
  set bc(v) { this.r8[0] = v >> 8; this.r8[1] = v; }
  get de() { return (this.r8[2] << 8) | this.r8[3]; }
  set de(v) { this.r8[2] = v >> 8; this.r8[3] = v; }
  get hl() { return (this.r8[4] << 8) | this.r8[5]; }
  set hl(v) { this.r8[4] = v >> 8; this.r8[5] = v; }

  // ---- 8-bit register access honoring DD/FD (ix: 0 none, 1 IX, 2 IY)
  get8(i, ix) {
    if (ix) {
      if (i === 4) return (ix === 1 ? this.ix : this.iy) >> 8;
      if (i === 5) return (ix === 1 ? this.ix : this.iy) & 0xff;
    }
    return this.r8[i];
  }
  set8(i, v, ix) {
    v &= 0xff;
    if (ix && (i === 4 || i === 5)) {
      let r = ix === 1 ? this.ix : this.iy;
      r = i === 4 ? (v << 8) | (r & 0xff) : (r & 0xff00) | v;
      if (ix === 1) this.ix = r; else this.iy = r;
      return;
    }
    this.r8[i] = v;
  }
  getHL(ix) { return ix === 0 ? this.hl : ix === 1 ? this.ix : this.iy; }
  setHL(v, ix) { v &= 0xffff; if (ix === 0) this.hl = v; else if (ix === 1) this.ix = v; else this.iy = v; }
  getRP(p, ix) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHL(ix) : this.sp; }
  setRP(p, v, ix) { v &= 0xffff; if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setHL(v, ix); else this.sp = v; }
  getRP2(p, ix) { return p === 3 ? this.af : this.getRP(p, ix); }
  setRP2(p, v, ix) { if (p === 3) this.af = v; else this.setRP(p, v, ix); }

  cond(y) {
    const f = this.f;
    switch (y) {
      case 0: return !(f & Z); case 1: return !!(f & Z);
      case 2: return !(f & C); case 3: return !!(f & C);
      case 4: return !(f & PV); case 5: return !!(f & PV);
      case 6: return !(f & S); default: return !!(f & S);
    }
  }

  // ---- ALU
  alu(y, v) {
    const a = this.r8[7];
    let res;
    switch (y) {
      case 0: case 1: { // ADD / ADC
        const c = y === 1 ? (this.f & C) : 0;
        res = a + v + c;
        this.f = SZ[res & 0xff] | ((a ^ v ^ res) & H) | (((a ^ res) & (v ^ res) & 0x80) ? PV : 0) | ((res >> 8) & C);
        this.r8[7] = res; break;
      }
      case 2: case 3: case 7: { // SUB / SBC / CP
        const c = y === 3 ? (this.f & C) : 0;
        res = a - v - c;
        this.f = SZ[res & 0xff] | ((a ^ v ^ res) & H) | (((a ^ v) & (a ^ res) & 0x80) ? PV : 0) | N | ((res >> 8) & C);
        if (y === 7) this.f = (this.f & ~(Y | X)) | (v & (Y | X));
        else this.r8[7] = res;
        break;
      }
      case 4: res = a & v; this.f = SZP[res] | H; this.r8[7] = res; break;
      case 5: res = a ^ v; this.f = SZP[res]; this.r8[7] = res; break;
      case 6: res = a | v; this.f = SZP[res]; this.r8[7] = res; break;
    }
  }
  inc8(v) { const r = (v + 1) & 0xff; this.f = (this.f & C) | SZ[r] | ((v & 0xf) === 0xf ? H : 0) | (v === 0x7f ? PV : 0); return r; }
  dec8(v) { const r = (v - 1) & 0xff; this.f = (this.f & C) | SZ[r] | ((v & 0xf) === 0 ? H : 0) | (v === 0x80 ? PV : 0) | N; return r; }
  add16(a, b) {
    const r = a + b;
    this.f = (this.f & (S | Z | PV)) | ((r >> 8) & (Y | X)) | (((a ^ b ^ r) >> 8) & H) | ((r >> 16) & C);
    this.memptr = (a + 1) & 0xffff;
    return r & 0xffff;
  }
  adc16(b) {
    const a = this.hl, c = this.f & C, r = a + b + c;
    this.f = ((r >> 8) & (S | Y | X)) | ((r & 0xffff) === 0 ? Z : 0) | (((a ^ b ^ r) >> 8) & H) |
      ((~(a ^ b) & (a ^ r) & 0x8000) ? PV : 0) | ((r >> 16) & C);
    this.memptr = (a + 1) & 0xffff;
    this.hl = r;
  }
  sbc16(b) {
    const a = this.hl, c = this.f & C, r = a - b - c;
    this.f = ((r >> 8) & (S | Y | X)) | ((r & 0xffff) === 0 ? Z : 0) | (((a ^ b ^ r) >> 8) & H) |
      (((a ^ b) & (a ^ r) & 0x8000) ? PV : 0) | N | ((r >> 16) & C);
    this.memptr = (a + 1) & 0xffff;
    this.hl = r;
  }

  // rotate/shift for CB. op 0..7: RLC RRC RL RR SLA SRA SLL SRL
  rot(op, v) {
    let r, c;
    switch (op) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; r = ((v << 1) | (this.f & C)) & 0xff; break;
      case 3: c = v & 1; r = (v >> 1) | ((this.f & C) << 7); break;
      case 4: c = v >> 7; r = (v << 1) & 0xff; break;
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;
      default: c = v & 1; r = v >> 1; break;
    }
    this.f = SZP[r] | c;
    return r;
  }

  daa() {
    const a = this.r8[7], f = this.f;
    let add = 0, c = f & C;
    if ((f & H) || (a & 0xf) > 9) add |= 6;
    if (c || a > 0x99) { add |= 0x60; c = C; }
    const r = (f & N) ? (a - add) & 0xff : (a + add) & 0xff;
    const h = (f & N) ? ((f & H) && (a & 0xf) < 6 ? H : 0) : ((a & 0xf) > 9 ? H : 0);
    this.f = SZP[r] | (f & N) | h | c;
    this.r8[7] = r;
  }

  // ---- interrupt
  accept() {
    this.halted = false;
    this.iff1 = this.iff2 = false;
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
    this.push(this.pc);
    if (this.im === 2) { this.pc = this.rd16((this.i << 8) | 0xff); this.t += 19; }
    else { this.pc = 0x38; this.t += 13; }
    this.memptr = this.pc;
  }

  // Executes one instruction; returns T-states used.
  step() {
    const t0 = this.t;
    const canInt = !this.eiDelay;
    this.eiDelay = false;
    if (canInt && this.irqLine && this.iff1) { this.accept(); return this.t - t0; }
    if (this.hooks !== null && this.pc >= this.hookMin && this.pc <= this.hookMax) {
      const f = this.hooks.get(this.pc) || this.hookDefault;
      if (f) { this.t += f(this) || 0; return this.t - t0; }
    }
    if (this.halted) { this.t += 4; this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); return 4; }

    let op = this.fetchOp(), ix = 0;
    this.t += 4;
    while (op === 0xdd || op === 0xfd) {
      ix = op === 0xdd ? 1 : 2;
      op = this.fetchOp(); this.t += 4;
    }
    if (op === 0xed) { this.execED(); }
    else if (op === 0xcb) { ix ? this.execDDCB(ix) : this.execCB(); }
    else this.exec(op, ix);
    return this.t - t0;
  }

  // address of (HL)/(IX+d)/(IY+d); fetches displacement if indexed
  mem(ix) {
    if (!ix) return this.hl;
    const d = this.fetch();
    const a = ((ix === 1 ? this.ix : this.iy) + (d << 24 >> 24)) & 0xffff;
    this.memptr = a;
    this.t += 8;
    return a;
  }

  exec(op, ix) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    switch (x) {
      case 1: { // LD r,r'
        if (op === 0x76) { this.halted = true; return; }
        if (z === 6) { const a = this.mem(ix); this.r8[y] = this.rd(a); this.t += 3; }
        else if (y === 6) { const a = this.mem(ix); this.wr(a, this.r8[z]); this.t += 3; }
        else this.set8(y, this.get8(z, ix), ix);
        return;
      }
      case 2: { // ALU A,r
        if (z === 6) { const a = this.mem(ix); this.alu(y, this.rd(a)); this.t += 3; }
        else this.alu(y, this.get8(z, ix));
        return;
      }
      case 0: return this.execX0(op, y, z, p, q, ix);
      default: return this.execX3(op, y, z, p, q, ix);
    }
  }

  execX0(op, y, z, p, q, ix) {
    switch (z) {
      case 0:
        if (y === 0) return;
        if (y === 1) { const t = this.af; this.af = this.af_; this.af_ = t; return; }
        if (y === 2) { // DJNZ
          const d = this.fetch() << 24 >> 24; this.t += 4;
          this.r8[0] = (this.r8[0] - 1) & 0xff;
          if (this.r8[0]) { this.pc = (this.pc + d) & 0xffff; this.memptr = this.pc; this.t += 5; }
          return;
        }
        { // JR / JR cc
          const d = this.fetch() << 24 >> 24; this.t += 3;
          if (y === 3 || this.cond(y - 4)) { this.pc = (this.pc + d) & 0xffff; this.memptr = this.pc; this.t += 5; }
          return;
        }
      case 1:
        if (q === 0) { this.setRP(p, this.fetch16(), ix); this.t += 6; }
        else { this.setHL(this.add16(this.getHL(ix), this.getRP(p, ix)), ix); this.t += 7; }
        return;
      case 2: {
        if (q === 0) {
          if (p === 0) { this.wr(this.bc, this.r8[7]); this.t += 3; }
          else if (p === 1) { this.wr(this.de, this.r8[7]); this.t += 3; }
          else if (p === 2) { const a = this.fetch16(); this.wr16(a, this.getHL(ix)); this.memptr = a + 1; this.t += 12; }
          else { const a = this.fetch16(); this.wr(a, this.r8[7]); this.memptr = ((this.r8[7] << 8) | ((a + 1) & 0xff)); this.t += 9; }
        } else {
          if (p === 0) { this.r8[7] = this.rd(this.bc); this.t += 3; }
          else if (p === 1) { this.r8[7] = this.rd(this.de); this.t += 3; }
          else if (p === 2) { const a = this.fetch16(); this.setHL(this.rd16(a), ix); this.memptr = a + 1; this.t += 12; }
          else { const a = this.fetch16(); this.r8[7] = this.rd(a); this.memptr = a + 1; this.t += 9; }
        }
        return;
      }
      case 3:
        this.setRP(p, this.getRP(p, ix) + (q ? -1 : 1), ix); this.t += 2; return;
      case 4: case 5: {
        const f = z === 4 ? 'inc8' : 'dec8';
        if (y === 6) { const a = this.mem(ix); this.wr(a, this[f](this.rd(a))); this.t += 7; }
        else this.set8(y, this[f](this.get8(y, ix)), ix);
        return;
      }
      case 6:
        if (y === 6) { const a = this.mem(ix); if (ix) this.t -= 3; this.wr(a, this.fetch()); this.t += 6; }
        else { this.set8(y, this.fetch(), ix); this.t += 3; }
        return;
      default: { // z === 7
        const a = this.r8[7];
        switch (y) {
          case 0: { const c = a >> 7; const r = ((a << 1) | c) & 0xff; this.r8[7] = r; this.f = (this.f & (S | Z | PV)) | (r & (Y | X)) | c; return; }
          case 1: { const c = a & 1; const r = (a >> 1) | (c << 7); this.r8[7] = r; this.f = (this.f & (S | Z | PV)) | (r & (Y | X)) | c; return; }
          case 2: { const c = a >> 7; const r = ((a << 1) | (this.f & C)) & 0xff; this.r8[7] = r; this.f = (this.f & (S | Z | PV)) | (r & (Y | X)) | c; return; }
          case 3: { const c = a & 1; const r = (a >> 1) | ((this.f & C) << 7); this.r8[7] = r; this.f = (this.f & (S | Z | PV)) | (r & (Y | X)) | c; return; }
          case 4: this.daa(); return;
          case 5: { const r = a ^ 0xff; this.r8[7] = r; this.f = (this.f & (S | Z | PV | C)) | (r & (Y | X)) | H | N; return; }
          case 6: this.f = (this.f & (S | Z | PV)) | (a & (Y | X)) | C; return;
          default: { // CCF: H = old C, C = !old C
            const oc = this.f & C;
            this.f = (this.f & (S | Z | PV)) | (a & (Y | X)) | (oc ? H : C);
            return;
          }
        }
      }
    }
  }

  execX3(op, y, z, p, q, ix) {
    switch (z) {
      case 0:
        this.t += 1;
        if (this.cond(y)) { this.pc = this.pop(); this.memptr = this.pc; this.t += 6; }
        return;
      case 1:
        if (q === 0) { this.setRP2(p, this.pop(), ix); this.t += 6; return; }
        if (p === 0) { this.pc = this.pop(); this.memptr = this.pc; this.t += 6; }
        else if (p === 1) { // EXX
          for (let i = 0; i < 6; i++) { const t = this.r8[i]; this.r8[i] = this.alt[i]; this.alt[i] = t; }
        } else if (p === 2) this.pc = this.getHL(ix);
        else { this.sp = this.getHL(ix); this.t += 2; }
        return;
      case 2: {
        const a = this.fetch16(); this.memptr = a; this.t += 6;
        if (this.cond(y)) this.pc = a;
        return;
      }
      case 3:
        switch (y) {
          case 0: this.pc = this.fetch16(); this.memptr = this.pc; this.t += 6; return;
          case 2: { const n = this.fetch(); const port = (this.r8[7] << 8) | n; this.bus.out(port, this.r8[7]); this.memptr = ((this.r8[7] << 8) | ((n + 1) & 0xff)); this.t += 7; return; }
          case 3: { const n = this.fetch(); const port = (this.r8[7] << 8) | n; this.r8[7] = this.bus.in(port); this.memptr = port + 1; this.t += 7; return; }
          case 4: { // EX (SP),HL
            const v = this.rd16(this.sp); this.wr16(this.sp, this.getHL(ix)); this.setHL(v, ix); this.memptr = v; this.t += 15; return;
          }
          case 5: { const t = this.de; this.de = this.hl; this.hl = t; return; }
          case 6: this.iff1 = this.iff2 = false; return;
          case 7: this.iff1 = this.iff2 = true; this.eiDelay = true; return;
        }
        return;
      case 4: {
        const a = this.fetch16(); this.memptr = a; this.t += 6;
        if (this.cond(y)) { this.push(this.pc); this.pc = a; this.t += 7; }
        return;
      }
      case 5:
        if (q === 0) { this.t += 1; this.push(this.getRP2(p, ix)); this.t += 6; }
        else { const a = this.fetch16(); this.memptr = a; this.push(this.pc); this.pc = a; this.t += 13; }
        return;
      case 6: this.alu(y, this.fetch()); this.t += 3; return;
      default: this.t += 1; this.push(this.pc); this.pc = y * 8; this.memptr = this.pc; this.t += 6; return;
    }
  }

  execCB() {
    const op = this.fetchOp(); this.t += 4;
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    if (z === 6) {
      const a = this.hl, v = this.rd(a); this.t += 4;
      if (x === 0) { this.wr(a, this.rot(y, v)); this.t += 3; }
      else if (x === 1) { this.f = (this.f & C) | H | ((v & (1 << y)) ? (y === 7 ? S : 0) : (Z | PV)) | ((this.memptr >> 8) & (Y | X)); }
      else if (x === 2) { this.wr(a, v & ~(1 << y)); this.t += 3; }
      else { this.wr(a, v | (1 << y)); this.t += 3; }
      return;
    }
    const v = this.r8[z];
    if (x === 0) this.r8[z] = this.rot(y, v);
    else if (x === 1) this.f = (this.f & C) | H | ((v & (1 << y)) ? (y === 7 ? S : 0) | (v & (Y | X)) : (Z | PV | (v & (Y | X))));
    else if (x === 2) this.r8[z] = v & ~(1 << y);
    else this.r8[z] = v | (1 << y);
  }

  execDDCB(ix) {
    const d = this.fetch() << 24 >> 24;
    const op = this.fetch(); // not an M1 fetch: no R increment
    const a = ((ix === 1 ? this.ix : this.iy) + d) & 0xffff;
    this.memptr = a;
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const v = this.rd(a);
    this.t += 4 + 4 + 4;
    if (x === 1) { this.f = (this.f & C) | H | ((v & (1 << y)) ? (y === 7 ? S : 0) : (Z | PV)) | ((a >> 8) & (Y | X)); return; }
    let r;
    if (x === 0) r = this.rot(y, v);
    else if (x === 2) r = v & ~(1 << y);
    else r = v | (1 << y);
    this.t += 3;
    this.wr(a, r);
    if (z !== 6) this.r8[z] = r; // undocumented: result also copied to register
  }

  execED() {
    const op = this.fetchOp(); this.t += 4;
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: { // IN r,(C)
          const v = this.bus.in(this.bc); this.f = (this.f & C) | SZP[v]; if (y !== 6) this.r8[y] = v; this.memptr = this.bc + 1; this.t += 4; return;
        }
        case 1: this.bus.out(this.bc, y === 6 ? 0 : this.r8[y]); this.memptr = this.bc + 1; this.t += 4; return;
        case 2: if (q === 0) this.sbc16(this.getRP(p, 0)); else this.adc16(this.getRP(p, 0)); this.t += 7; return;
        case 3: {
          const a = this.fetch16(); this.memptr = a + 1;
          if (q === 0) this.wr16(a, this.getRP(p, 0)); else this.setRP(p, this.rd16(a), 0);
          this.t += 12; return;
        }
        case 4: { // NEG
          const a = this.r8[7]; this.r8[7] = 0; this.alu(2, a); return;
        }
        case 5: // RETN / RETI
          this.iff1 = this.iff2; this.pc = this.pop(); this.memptr = this.pc; this.t += 6; return;
        case 6: this.im = [0, 0, 1, 2][y & 3]; return;
        default:
          switch (y) {
            case 0: this.i = this.r8[7]; this.t += 1; return;
            case 1: this.r = this.r8[7]; this.t += 1; return;
            case 2: this.r8[7] = this.i; this.f = (this.f & C) | SZ[this.i] | (this.iff2 ? PV : 0); this.t += 1; return;
            case 3: this.r8[7] = this.r; this.f = (this.f & C) | SZ[this.r] | (this.iff2 ? PV : 0); this.t += 1; return;
            case 4: { // RRD
              const a = this.hl, m = this.rd(a), A = this.r8[7];
              this.wr(a, ((A << 4) | (m >> 4)) & 0xff); this.r8[7] = (A & 0xf0) | (m & 0x0f);
              this.f = (this.f & C) | SZP[this.r8[7]]; this.memptr = a + 1; this.t += 10; return;
            }
            case 5: { // RLD
              const a = this.hl, m = this.rd(a), A = this.r8[7];
              this.wr(a, ((m << 4) | (A & 0x0f)) & 0xff); this.r8[7] = (A & 0xf0) | (m >> 4);
              this.f = (this.f & C) | SZP[this.r8[7]]; this.memptr = a + 1; this.t += 10; return;
            }
            default: return; // NOP
          }
      }
    }
    if (x === 2 && z < 4 && y >= 4) return this.block(y, z);
    // other ED opcodes are NOPs
  }

  block(y, z) {
    const dec = y & 1, rep = y >= 6;
    const dir = dec ? -1 : 1;
    switch (z) {
      case 0: { // LDI/LDD/LDIR/LDDR
        const v = this.rd(this.hl); this.wr(this.de, v);
        this.hl = this.hl + dir; this.de = this.de + dir; this.bc = this.bc - 1;
        const n = (v + this.r8[7]) & 0xff;
        this.f = (this.f & (S | Z | C)) | (n & X) | ((n << 4) & Y) | (this.bc ? PV : 0);
        this.t += 8;
        if (rep && this.bc) { this.pc = (this.pc - 2) & 0xffff; this.memptr = this.pc + 1; this.t += 5; }
        return;
      }
      case 1: { // CPI/CPD/CPIR/CPDR
        const v = this.rd(this.hl), a = this.r8[7], r = (a - v) & 0xff;
        const h = ((a ^ v ^ r) & H) ? 1 : 0;
        this.hl = this.hl + dir; this.bc = this.bc - 1;
        const n = (r - h) & 0xff;
        this.f = (this.f & C) | (r & S) | (r === 0 ? Z : 0) | (h ? H : 0) | (n & X) | ((n << 4) & Y) | (this.bc ? PV : 0) | N;
        this.t += 8;
        this.memptr = (this.memptr + dir) & 0xffff;
        if (rep && this.bc && r !== 0) { this.pc = (this.pc - 2) & 0xffff; this.memptr = this.pc + 1; this.t += 5; }
        return;
      }
      case 2: { // INI/IND/INIR/INDR
        const v = this.bus.in(this.bc); this.wr(this.hl, v);
        this.r8[0] = (this.r8[0] - 1) & 0xff; this.hl = this.hl + dir;
        this.f = SZ[this.r8[0]] | (v & 0x80 ? N : 0) | (this.f & C);
        this.t += 8;
        if (rep && this.r8[0]) { this.pc = (this.pc - 2) & 0xffff; this.t += 5; }
        return;
      }
      default: { // OUTI/OUTD/OTIR/OTDR
        const v = this.rd(this.hl);
        this.r8[0] = (this.r8[0] - 1) & 0xff;
        this.bus.out(this.bc, v); this.hl = this.hl + dir;
        this.f = SZ[this.r8[0]] | (v & 0x80 ? N : 0) | (this.f & C);
        this.t += 8;
        if (rep && this.r8[0]) { this.pc = (this.pc - 2) & 0xffff; this.t += 5; }
        return;
      }
    }
  }
}
