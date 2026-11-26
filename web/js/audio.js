// Turns timestamped writes to port 0x18 into PCM. The 1-bit stream is box-filtered per output sample
// (time-weighted average), so the pulse-density mixing used by 1-bit music players comes out as a mix.
// mode 'mono': bit7 (XOUT, the beeper / 11-pin #7). mode 'stereo': L = bit0 (#4), R = bit1 (#5).
export class AudioRenderer {
  constructor(clock, rate = 44100, mode = 'mono') {
    this.clock = clock; this.rate = rate; this.mode = mode;
    this.t0 = 0; this.v = 0; this.dcL = 0; this.dcR = 0;
  }
  reset(t = 0) { this.t0 = t; this.v = 0; this.dcL = this.dcR = 0; }
  level(v) { return this.mode === 'stereo' ? [v & 1, (v >> 1) & 1] : [(v >> 7) & 1, (v >> 7) & 1]; }
  /** events: flat [t, v, ...] (consumed); tEnd: cycle time up to which to render. */
  render(events, tEnd) {
    const cps = this.clock / this.rate;
    const n = Math.max(0, Math.floor((tEnd - this.t0) / cps));
    const L = new Float32Array(n), R = new Float32Array(n);
    let i = 0, t = this.t0, cur = this.v;
    let [cl, cr] = this.level(cur);
    for (let s = 0; s < n; s++) {
      const wEnd = t + cps; let pos = t, al = 0, ar = 0;
      while (i < events.length && events[i] < wEnd) {
        const et = Math.max(events[i], pos);
        al += cl * (et - pos); ar += cr * (et - pos); pos = et;
        cur = events[i + 1]; [cl, cr] = this.level(cur); i += 2;
      }
      al += cl * (wEnd - pos); ar += cr * (wEnd - pos);
      const xl = al / cps, xr = ar / cps;
      this.dcL += (xl - this.dcL) * 0.002; this.dcR += (xr - this.dcR) * 0.002; // DC blocker
      L[s] = (xl - this.dcL) * 0.4; R[s] = (xr - this.dcR) * 0.4;
      t = wEnd;
    }
    events.splice(0, i); this.t0 = t; this.v = cur;
    return { L, R };
  }
}
