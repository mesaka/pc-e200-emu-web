import { Machine } from './machine.js';
import { BasicMachine } from './basic/machine.js';
import { fmtNum } from './basic/interp.js';
import { KEY_ROWS, KEY_MATRIX, CODE_MAP, CHAR_KEY } from './keymap.js';
import { SAMPLES } from './samples.js';
import { parseHex, parseBin, looksLikeHex } from './hex.js';
import { AudioRenderer } from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('lcd'), ctx = canvas.getContext('2d');
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---- audio
let actx = null;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 }); } catch { actx = new (window.AudioContext || window.webkitAudioContext)(); } }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function beep(freq = 2700, ms = 100) {
  try {
    ensureAudio();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.05;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch {}
}

let mode = store.get('mode') || 'basic';
let z80Prog = null, audio = null, audioNext = 0;
let m, romData = null;
$('mode').value = mode;

function makeMachine() {
  mode = $('mode').value; store.set('mode', mode);
  const rom = mode === 'rom', z80 = mode === 'z80', basic = mode === 'basic';
  $('modelWrap').hidden = !rom; $('romWrap').hidden = !rom; $('speedWrap').hidden = !basic; $('progPane').hidden = !basic;
  $('z80Pane').hidden = !z80;
  if (rom) { m = new Machine($('model').value); if (romData) m.loadROM(romData); }
  else if (z80) {
    const clock = Math.max(100, Number($('z80Clock').value) || 8000) * 1000;
    m = new Machine('pcg850v', { flat: true, clock, lcdScales: Number($('z80Scales').value) || 4, refresh: Math.max(30, Number($('z80Refresh').value) || 120) });
    audio = new AudioRenderer(clock, actx ? actx.sampleRate : 44100, $('z80Audio').value === 'stereo' ? 'stereo' : 'mono');
    audioNext = 0;
    if (z80Prog) m.setProgram(z80Prog.segs, parseInt($('z80Entry').value, 16) || z80Prog.start);
  }
  else m = new BasicMachine({ speed: Number($('speed').value), onBeep: beep });
  canvas.width = m.lcd.W; canvas.height = m.lcd.H;
  canvas.style.aspectRatio = `${m.lcd.W}/${m.lcd.H}`;
  buildKeys(); buildCalc(); status();
}
function status() {
  $('status').textContent = mode === 'basic' ? 'BASIC 稼働中'
    : mode === 'z80' ? (z80Prog ? (m.cpu.halted ? '停止 (HALT)' : '実行中') : 'プログラム未読み込み')
    : (m.romLoaded ? `${m.model.name} 稼働中` : 'ROM未読み込み');
}

// ---- soft keyboard
// key colours follow the real machine: black number keys, dark grey letters, grey system keys,
// teal BASIC/TEXT, orange 2ndF, pink ON
function keyClass(l) {
  const u = String(l).toUpperCase();
  if (u === 'ON') return 'k-on';
  if (u === 'OFF') return 'k-off';
  if (u === 'BASIC' || u === 'TEXT') return 'k-teal';
  if (u === '2ND' || u === '2NDF') return 'k-second';
  if (u === 'ENTER' || u === 'RETURN') return 'k-enter';
  if (/^[0-9]$/.test(u) || u === '.' || u === '=') return 'k-num';
  if (/^[A-Z]$/.test(u)) return 'k-alpha';
  if (u.length === 1 && !/[A-Z0-9]/.test(u)) return 'k-sym';
  if (['SHIFT', 'CAPS', 'KANA', 'TAB', 'SPACE', 'BS', 'DEL', 'INS', 'CONS', 'CCE', 'FSE', 'BREAK', 'DOWN', 'UP', 'LEFT', 'RIGHT', '←', '→', '↑', '↓'].includes(u)) return 'k-sys';
  return 'k-fn';
}
const keysEl = $('keys');
const BASIC_KEYS = [
  ...'1234567890', ...'QWERTYUIOP', ...'ASDFGHJKL;', ...'ZXCVBNM,.:', ...'()+-*/^=<>', ...'"$?\'#%&!@_',
  { l: 'SPACE', k: ' ', w: 2 }, { l: 'ENTER', k: 'ENTER', w: 2 }, { l: 'BS', k: 'BS' }, { l: 'BREAK', k: 'BREAK' },
  { l: '←', k: 'LEFT' }, { l: '→', k: 'RIGHT' }, { l: '↑', k: 'UP' }, { l: '↓', k: 'DOWN' },
];
function buildKeys() {
  keysEl.textContent = '';
  keysEl.className = mode === 'basic' ? 'basic' : '';
  const add = (label, down, up, wide) => {
    const b = document.createElement('button'); b.textContent = label; b.className = 'key ' + keyClass(label) + (wide ? ' wide' : '');
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('down'); down(); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (b.classList.contains('down')) { b.classList.remove('down'); up(); } });
    keysEl.appendChild(b);
  };
  if (mode === 'basic') {
    for (const k of BASIC_KEYS) { const o = typeof k === 'string' ? { l: k, k } : k; add(o.l, () => m.key(o.k), () => {}, o.w === 2); }
  } else {
    const press = (name, d) => { if (name === 'SHIFT') m.setShift(d); else if (name === 'ON') m.setOn(d); else { const k = KEY_MATRIX[name]; if (k) m.setKey(k[0], k[1], d); } };
    for (const n of ['ON', 'SHIFT', ...KEY_ROWS.flat()]) add(n, () => press(n, true), () => press(n, false));
  }
}

// ---- scientific calculator keys (BASIC mode)
// l/t: normal label & text typed; l2/t2: with 2nd; lh/th: with hyp; lh2/th2: hyp + 2nd.
const calc = { second: false, hyp: false };
const CALC_KEYS = [
  { l: '2nd', toggle: 'second' }, { l: 'hyp', toggle: 'hyp' }, { l: 'DEG', angle: true }, { l: 'ANS', t: 'ANS' }, { l: 'M+', mem: 1, l2: 'M-', mem2: -1 }, { l: 'RM', rm: true, l2: 'MC', mc: true },
  { l: 'sin', t: 'SIN ', l2: 'sin⁻¹', t2: 'ASN ', lh: 'sinh', th: 'SINH ', lh2: 'sinh⁻¹', th2: 'ASNH ' },
  { l: 'cos', t: 'COS ', l2: 'cos⁻¹', t2: 'ACS ', lh: 'cosh', th: 'COSH ', lh2: 'cosh⁻¹', th2: 'ACSH ' },
  { l: 'tan', t: 'TAN ', l2: 'tan⁻¹', t2: 'ATN ', lh: 'tanh', th: 'TANH ', lh2: 'tanh⁻¹', th2: 'ATNH ' },
  { l: 'log', t: 'LOG ', l2: '10ˣ', t2: '10^' },
  { l: 'ln', t: 'LN ', l2: 'eˣ', t2: 'EXP ' },
  { l: '√', t: 'SQR ', l2: 'x²', t2: '^2' },
  { l: '1/x', t: '1/', l2: 'xʸ', t2: '^' },
  { l: 'n!', t: '!', l2: 'π', t2: 'PI' },
  { l: 'nPr', t: ' NPR ', l2: 'nCr', t2: ' NCR ' },
  { l: 'ABS', t: 'ABS ', l2: 'INT', t2: 'INT ' },
  { l: '→DEG', t: 'DEG ', l2: '→DMS', t2: 'DMS ' },
  { l: 'FIX', t: 'FIX ', l2: 'SGN', t2: 'SGN ' },
  { l: 'MDF', t: 'MDF ', l2: 'RND', t2: 'RND ' },
];
const calcEl = $('calcKeys');
function refreshCalc() {
  calcEl.querySelectorAll('button').forEach(b => {
    const k = b._k, on = k.toggle && calc[k.toggle];
    b.classList.toggle('active', !!on);
    const useH = calc.hyp && k.lh, s2 = calc.second;
    let label = k.l;
    if (k.angle) label = m.angleName || 'DEG';
    else if (useH) label = s2 ? k.lh2 : k.lh;
    else if (s2 && k.l2) label = k.l2;
    b.textContent = label; b.classList.toggle('alt', !!(s2 && (k.l2 || useH) && !k.toggle));
  });
}
function buildCalc() {
  calcEl.textContent = '';
  calcEl.hidden = $('calcInfo').hidden = mode !== 'basic';
  if (mode !== 'basic') return;
  for (const k of CALC_KEYS) {
    const b = document.createElement('button'); b._k = k; b.className = 'key ' + (k.toggle === 'second' ? 'k-second' : k.toggle ? 'k-teal' : k.angle ? 'k-sys' : 'k-fn');
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (k.toggle) { calc[k.toggle] = !calc[k.toggle]; refreshCalc(); return; }
      if (k.angle) { m.cycleAngle(); refreshCalc(); return; }
      const s2 = calc.second;
      if (k.mem !== undefined) { m.memAdd(s2 ? (k.mem2 ?? k.mem) : k.mem); }
      else if (k.rm) { if (s2) m.memClear(); else m.type(m.memRecallText()); }
      else {
        const useH = calc.hyp && k.th;
        const t = useH ? (s2 ? k.th2 : k.th) : (s2 && k.t2 !== undefined ? k.t2 : k.t);
        if (t) m.type(t);
      }
      calc.second = false; if (k.th) calc.hyp = false; refreshCalc();
    });
    calcEl.appendChild(b);
  }
  refreshCalc();
}
let lastInfo = '';
function updateInfo() {
  if (mode !== 'basic') return;
  const s = `ANS = ${fmtNum(m.ans)}   M = ${fmtNum(m.calcMem)}   角度: ${m.angleName}`;
  if (s !== lastInfo) { lastInfo = s; $('calcInfo').textContent = s; }
}

// ---- PC keyboard
const held = new Map();
addEventListener('keydown', e => {
  if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (mode === 'basic') {
    let k = null;
    if (e.key === 'Enter') k = 'ENTER'; else if (e.key === 'Backspace') k = 'BS'; else if (e.key === 'Escape') k = 'BREAK';
    else if (e.key.startsWith('Arrow')) k = e.key.slice(5).toUpperCase();
    else if (e.key.length === 1) k = e.key;
    if (k) { e.preventDefault(); m.key(k); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'Pause') { e.preventDefault(); m.setOn(true); return; }
  if (e.repeat && held.has(e.code)) { e.preventDefault(); return; }
  let target = null;
  if (e.key.length === 1 && CHAR_KEY[e.key]) { const [k, sh] = CHAR_KEY[e.key]; target = { k, sh }; }
  else if (CODE_MAP[e.code]) target = { k: CODE_MAP[e.code], sh: false };
  else if (e.code.startsWith('Shift')) { m.setShift(true); return; }
  if (!target) return;
  e.preventDefault(); held.set(e.code, target);
  if (target.sh) m.setShift(true);
  const k = KEY_MATRIX[target.k]; if (k) m.setKey(k[0], k[1], true);
});
addEventListener('keyup', e => {
  if (mode === 'basic') return;
  if (e.code === 'Escape' || e.code === 'Pause') { m.setOn(false); return; }
  if (e.code.startsWith('Shift')) { m.setShift(false); return; }
  const t = held.get(e.code); if (!t) return;
  held.delete(e.code); const k = KEY_MATRIX[t.k]; if (k) m.setKey(k[0], k[1], false); if (t.sh) m.setShift(false);
});

// ---- controls
$('mode').onchange = makeMachine;
$('model').onchange = makeMachine;
$('speed').onchange = () => { if (mode === 'basic') m.speed = Number($('speed').value); };
$('reset').onclick = () => { m.reset(); if (audio) audio.reset(0); audioNext = 0; };
$('rom').onchange = async e => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const bufs = await Promise.all(files.map(f => f.arrayBuffer()));
  romData = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0));
  let o = 0; for (const b of bufs) { romData.set(new Uint8Array(b), o); o += b.byteLength; }
  m.loadROM(romData); status();
};

// program pane
const prog = $('prog');
prog.value = store.get('prog') || SAMPLES['HELLO'];
prog.addEventListener('input', () => store.set('prog', prog.value));
for (const k of Object.keys(SAMPLES)) { const o = document.createElement('option'); o.textContent = k; o.value = k; $('sample').appendChild(o); }
$('sample').onchange = e => { if (SAMPLES[e.target.value]) { prog.value = SAMPLES[e.target.value]; store.set('prog', prog.value); } e.target.value = ''; };
$('toMem').onclick = () => { if (mode === 'basic') { m.interp.clearAll(); m.load(prog.value); m.type('\r'); } };
$('fromMem').onclick = () => { if (mode === 'basic') { prog.value = m.listing(); store.set('prog', prog.value); } };
$('runBtn').onclick = () => { if (mode !== 'basic') return; m.interp.clearAll(); m.load(prog.value); m.type('RUN\r'); };
$('breakBtn').onclick = () => m.key('BREAK');
$('saveFile').onclick = () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([prog.value], { type: 'text/plain' }));
  a.download = 'program.bas'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('openFile').onchange = async e => { const f = e.target.files[0]; if (f) { prog.value = await f.text(); store.set('prog', prog.value); } e.target.value = ''; };

// ---- machine-language (ROM-less Z80) pane
function setZ80Program(parsed, label) {
  z80Prog = parsed;
  $('z80Entry').value = parsed.start.toString(16);
  $('z80Info').textContent = `${label}: 0x${parsed.start.toString(16).toUpperCase()}-0x${(parsed.end - 1).toString(16).toUpperCase()} (${parsed.end - parsed.start} bytes) を読み込みました。「実行」で開始します。`;
}
$('z80File').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    const parsed = looksLikeHex(buf) ? parseHex(new TextDecoder().decode(buf)) : parseBin(buf, parseInt($('z80Entry').value, 16) || 0x100);
    setZ80Program(parsed, f.name);
  } catch (err) { $('z80Info').textContent = 'エラー: ' + err.message; }
  e.target.value = '';
};
$('z80Run').onclick = () => {
  if (!z80Prog) { $('z80Info').textContent = '先にHEX/BINを読み込んでください。'; return; }
  ensureAudio(); makeMachine();
};
$('z80Audio').onchange = () => { if (audio) audio.mode = $('z80Audio').value === 'stereo' ? 'stereo' : 'mono'; };

function pumpAudio() {
  if (mode !== 'z80' || !audio) return;
  if ($('z80Audio').value === 'off' || !actx) { m.audioEvents.length = 0; audio.reset(m.cpu.t); return; }
  audio.rate = actx.sampleRate;
  const { L, R } = audio.render(m.audioEvents, m.cpu.t);
  if (!L.length) return;
  const buf = actx.createBuffer(2, L.length, actx.sampleRate);
  buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
  const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  if (audioNext < actx.currentTime + 0.01) audioNext = actx.currentTime + 0.08; // underrun: re-buffer
  src.start(audioNext); audioNext += L.length / actx.sampleRate;
}

// drag & drop a HEX/BIN file onto the page (machine-language mode)
addEventListener('dragover', e => { if (mode === 'z80') e.preventDefault(); });
addEventListener('drop', async e => {
  if (mode !== 'z80') return;
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    setZ80Program(looksLikeHex(buf) ? parseHex(new TextDecoder().decode(buf)) : parseBin(buf, parseInt($('z80Entry').value, 16) || 0x100), f.name);
    ensureAudio(); makeMachine();
  } catch (err) { $('z80Info').textContent = 'エラー: ' + err.message; }
});
let lastUnknown = '';
function checkIocs() {
  if (mode !== 'z80' || !m.iocsUnknown) return;
  const s = [...m.iocsUnknown].map(a => '0x' + a.toString(16).toUpperCase()).join(', ');
  if (s !== lastUnknown) { lastUnknown = s; if (s) $('z80Info').textContent += ` ⚠ 未実装のシステムコール: ${s}`; }
}
setInterval(() => { checkIocs(); if (mode === 'z80') status(); }, 1000);

// ---- main loop
let last = performance.now(), frame = null;
function loop(now) {
  const dt = Math.min(now - last, 50); last = now;
  m.runMs(dt); updateInfo(); pumpAudio();
  if (!frame || frame.width !== m.lcd.W || frame.height !== m.lcd.H) frame = ctx.createImageData(m.lcd.W, m.lcd.H);
  // LCD colours (from the g800 config: back cceebb, on 002211); grey levels come from averaged frames
  const gray = m.lcd.renderGray ? m.lcd.renderGray() : null, px = gray || m.lcd.render(), d = frame.data, scale = gray ? 255 : 1;
  for (let i = 0; i < px.length; i++) {
    const o = i * 4, t = px[i] / scale;
    d[o] = 204 - 204 * t; d[o + 1] = 238 - 204 * t; d[o + 2] = 187 - 170 * t; d[o + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
  requestAnimationFrame(loop);
}
makeMachine();
requestAnimationFrame(loop);
