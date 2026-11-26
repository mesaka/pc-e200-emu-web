// Sharp pocket-computer style BASIC interpreter (high-level emulation; no ROM needed).
// Not a bit-exact clone of any firmware: it implements the documented language behaviour.

export class BasicError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
const ERR = {
  SYNTAX: [1, 'SYNTAX'], CALC: [2, 'CALC'], FUNC: [3, 'ILLEGAL FUNCTION CALL'], NEXT: [4, 'NEXT WITHOUT FOR'],
  RET: [5, 'RETURN WITHOUT GOSUB'], DATA: [6, 'OUT OF DATA'], LINE: [7, 'UNDEFINED LINE'], TYPE: [8, 'TYPE MISMATCH'],
  SUB: [9, 'SUBSCRIPT'], MEM: [10, 'MEMORY'],
};
const fail = k => { throw new BasicError(ERR[k][0], ERR[k][1]); };

const KEYWORDS = [
  'PRINT', 'INPUT', 'GOTO', 'GOSUB', 'RETURN', 'IF', 'THEN', 'ELSE', 'FOR', 'TO', 'STEP', 'NEXT', 'END', 'STOP', 'REM',
  'DIM', 'DATA', 'READ', 'RESTORE', 'ON', 'CLS', 'LOCATE', 'CSR', 'BEEP', 'WAIT', 'PAUSE', 'PSET', 'PRESET', 'LINE',
  'CIRCLE', 'GPRINT', 'GCURSOR', 'RANDOMIZE', 'RANDOM', 'DEGREE', 'RADIAN', 'GRAD', 'CLEAR', 'USING', 'AREAD', 'RUN', 'LIST',
  'NEW', 'CONT', 'LET', 'AND', 'OR', 'XOR', 'NOT', 'RESUME', 'ERROR', 'POKE', 'LLIST', 'LPRINT', 'TRON', 'TROFF',
  'ABS', 'INT', 'SGN', 'SQR', 'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN', 'LOG', 'LN', 'EXP', 'RND', 'PI', 'DEG', 'DMS',
  'FIX', 'LEN', 'VAL', 'STR$', 'CHR$', 'ASC', 'LEFT$', 'RIGHT$', 'MID$', 'INKEY$', 'MEM', 'PEEK', 'POINT', 'ERN', 'ERL',
  'HEX$', 'SQU', 'TIME', 'ANS', 'SINH', 'COSH', 'TANH', 'ASNH', 'ACSH', 'ATNH', 'NPR', 'NCR', 'MDF',
].sort((a, b) => b.length - a.length);

function lex(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') s += src[j++];
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (c === '?') { out.push({ t: 'kw', v: 'PRINT' }); i++; continue; }
    if (c === "'") { out.push({ t: 'kw', v: 'REM' }); out.push({ t: 'rest', v: src.slice(i + 1) }); break; }
    if (c === '&' && /[hH]/.test(src[i + 1] || '')) {
      let j = i + 2; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      out.push({ t: 'num', v: parseInt(src.slice(i + 2, j) || '0', 16) }); i = j; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < n && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.') { j++; while (j < n && /[0-9]/.test(src[j])) j++; }
      if (/[eE]/.test(src[j] || '') && /[0-9+\-]/.test(src[j + 1] || '')) {
        let k = j + 1; if (/[+-]/.test(src[k])) k++;
        if (/[0-9]/.test(src[k] || '')) { while (k < n && /[0-9]/.test(src[k])) k++; j = k; }
      }
      out.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const up = src.slice(i).toUpperCase();
      const kw = KEYWORDS.find(k => up.startsWith(k));
      if (kw) {
        out.push({ t: 'kw', v: kw }); i += kw.length;
        if (kw === 'REM') { out.push({ t: 'rest', v: src.slice(i) }); break; }
        if (kw === 'DATA') { // raw until unquoted ':'
          let j = i, q = false;
          while (j < n && (q || src[j] !== ':')) { if (src[j] === '"') q = !q; j++; }
          out.push({ t: 'rest', v: src.slice(i, j) }); i = j;
        }
        continue;
      }
      let j = i + 1;
      while (j < n && /[A-Za-z0-9]/.test(src[j])) {
        const u = src.slice(j).toUpperCase();
        if (KEYWORDS.some(k => u.startsWith(k))) break;
        j++;
      }
      let name = src.slice(i, j).toUpperCase();
      if (src[j] === '$') { name += '$'; j++; }
      out.push({ t: 'id', v: name }); i = j; continue;
    }
    const two = src.substr(i, 2);
    if (['<=', '>=', '<>', '><', '=<', '=>'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^()<>=,;:#!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    fail('SYNTAX');
  }
  return out;
}

const round13 = v => (Number.isInteger(v) || !Number.isFinite(v)) ? v : +v.toPrecision(13);
const checkNum = v => { if (!Number.isFinite(v)) fail('CALC'); return v; };

export function fmtNum(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e10) return String(v);
  if (a >= 1e10 || a < 1e-9) {
    let [m, e] = v.toExponential(9).split('e');
    m = m.replace(/\.?0+$/, ''); const ex = parseInt(e, 10);
    return `${m}E${ex >= 0 ? '+' : '-'}${Math.abs(ex)}`;
  }
  let s = v.toPrecision(10);
  if (s.includes('e')) s = String(+s);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

class Parser {
  constructor(tokens, it) { this.t = tokens; this.p = 0; this.it = it; }
  peek() { return this.t[this.p]; }
  next() { return this.t[this.p++]; }
  atEnd() { return this.p >= this.t.length; }
  isKw(v) { const k = this.t[this.p]; return !!k && k.t === 'kw' && k.v === v; }
  isOp(v) { const k = this.t[this.p]; return !!k && k.t === 'op' && k.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  eatKw(v) { if (this.isKw(v)) { this.p++; return true; } return false; }
  needOp(v) { if (!this.eatOp(v)) fail('SYNTAX'); }
  endOfStmt() { return this.atEnd() || this.isOp(':') || this.isKw('ELSE'); }

  // ---- statements
  parseStatements(out) {
    for (;;) {
      while (this.eatOp(':'));
      if (this.atEnd() || this.isKw('ELSE')) return;
      this.parseStatement(out);
      if (this.atEnd() || this.isKw('ELSE')) return;
      if (!this.eatOp(':')) fail('SYNTAX');
    }
  }

  parseStatement(out) {
    const k = this.next();
    if (k.t === 'id') { this.p--; return this.parseLet(out); }
    if (k.t !== 'kw') fail('SYNTAX');
    switch (k.v) {
      case 'LET': return this.parseLet(out);
      case 'REM': { if (this.peek() && this.peek().t === 'rest') this.next(); return; }
      case 'PRINT': case 'LPRINT': return this.parsePrint(out);
      case 'INPUT': return this.parseInput(out);
      case 'GOTO': out.push({ op: 'GOTO', n: this.lineNum() }); return;
      case 'GOSUB': out.push({ op: 'GOSUB', n: this.lineNum() }); return;
      case 'RETURN': out.push({ op: 'RETURN' }); return;
      case 'IF': return this.parseIf(out);
      case 'FOR': return this.parseFor(out);
      case 'NEXT': {
        const vars = [];
        while (this.peek() && this.peek().t === 'id') { vars.push(this.next().v); if (!this.eatOp(',')) break; }
        out.push({ op: 'NEXT', vars }); return;
      }
      case 'END': out.push({ op: 'END' }); return;
      case 'STOP': out.push({ op: 'STOP' }); return;
      case 'DIM': return this.parseDim(out);
      case 'DATA': { const r = this.peek(); out.push({ op: 'DATA' }); if (r && r.t === 'rest') { this.next(); } return; }
      case 'READ': { const l = []; do l.push(this.lvalue()); while (this.eatOp(',')); out.push({ op: 'READ', l }); return; }
      case 'RESTORE': out.push({ op: 'RESTORE', n: this.endOfStmt() ? null : this.lineNum() }); return;
      case 'ON': return this.parseOn(out);
      case 'CLS': out.push({ op: 'CLS' }); return;
      case 'LOCATE': { const a = this.exprList(); out.push({ op: 'LOCATE', a }); return; }
      case 'CSR': out.push({ op: 'CSR', a: this.expr() }); return;
      case 'BEEP': out.push({ op: 'BEEP', a: this.endOfStmt() ? [] : this.exprList() }); return;
      case 'WAIT': out.push({ op: 'WAIT', a: this.endOfStmt() ? null : this.expr() }); return;
      case 'PAUSE': return this.parsePause(out);
      case 'PSET': case 'PRESET': { const a = this.pointArgs(); out.push({ op: k.v, a }); return; }
      case 'LINE': return this.parseLine(out);
      case 'CIRCLE': return this.parseCircle(out);
      case 'GPRINT': { const l = []; do l.push(this.expr()); while (this.eatOp(';') || this.eatOp(',')); out.push({ op: 'GPRINT', l }); return; }
      case 'GCURSOR': out.push({ op: 'GCURSOR', a: this.expr() }); return;
      case 'RANDOMIZE': case 'RANDOM': if (!this.endOfStmt()) this.expr(); out.push({ op: 'RANDOMIZE' }); return;
      case 'DEGREE': out.push({ op: 'ANGLE', m: 0 }); return;
      case 'RADIAN': out.push({ op: 'ANGLE', m: 1 }); return;
      case 'GRAD': out.push({ op: 'ANGLE', m: 2 }); return;
      case 'CLEAR': out.push({ op: 'CLEAR' }); return;
      case 'AREAD': { out.push({ op: 'AREAD', l: this.lvalue() }); return; }
      case 'RUN': out.push({ op: 'RUN', n: this.endOfStmt() ? null : this.lineNum() }); return;
      case 'LIST': case 'LLIST': {
        let a = null, b = null;
        if (this.peek() && this.peek().t === 'num') { a = this.next().v; b = a; if (this.eatOp('-')) b = this.peek() && this.peek().t === 'num' ? this.next().v : Infinity; }
        else if (this.eatOp('-')) { a = 0; b = this.next().v; }
        out.push({ op: 'LIST', a, b }); return;
      }
      case 'NEW': out.push({ op: 'NEW' }); return;
      case 'CONT': out.push({ op: 'CONT' }); return;
      case 'POKE': { const a = this.exprList(); out.push({ op: 'POKE', a }); return; }
      case 'TRON': case 'TROFF': return;
      case 'RESUME': {
        let m = 'same', n = null;
        if (this.eatKw('NEXT')) m = 'next'; else if (this.peek() && this.peek().t === 'num') { m = 'line'; n = this.next().v; }
        out.push({ op: 'RESUME', m, n }); return;
      }
      default: fail('SYNTAX');
    }
  }

  lineNum() { const k = this.next(); if (!k || k.t !== 'num') fail('SYNTAX'); return k.v; }

  parseLet(out) {
    const lv = this.lvalue(); this.needOp('=');
    out.push({ op: 'LET', lv, f: this.expr() });
  }

  parsePrint(out) {
    const items = []; let using = null;
    if (this.eatKw('USING')) { using = this.expr(); if (!this.eatOp(';') && !this.eatOp(',')) { /* allow none */ } }
    let nl = true;
    while (!this.endOfStmt()) {
      if (this.eatOp(';')) { items.push({ sep: ';' }); nl = false; continue; }
      if (this.eatOp(',')) { items.push({ sep: ',' }); nl = false; continue; }
      items.push({ f: this.expr() }); nl = true;
    }
    out.push({ op: 'PRINT', items, using, nl });
  }

  parsePause(out) {
    if (this.endOfStmt()) { out.push({ op: 'PAUSE', items: [], nl: true }); return; }
    const items = []; let nl = true;
    while (!this.endOfStmt()) {
      if (this.eatOp(';')) { items.push({ sep: ';' }); nl = false; continue; }
      if (this.eatOp(',')) { items.push({ sep: ',' }); nl = false; continue; }
      items.push({ f: this.expr() }); nl = true;
    }
    out.push({ op: 'PAUSE', items, nl });
  }

  parseInput(out) {
    let prompt = null;
    if (this.peek() && this.peek().t === 'str') { prompt = this.next().v; if (!this.eatOp(';')) this.eatOp(','); }
    const l = []; do l.push(this.lvalue()); while (this.eatOp(','));
    out.push({ op: 'INPUT', prompt, l });
  }

  parseIf(out) {
    const cond = this.expr();
    if (!this.eatKw('THEN') && !this.isKw('GOTO')) fail('SYNTAX');
    const node = { op: 'IF', cond, els: -1 };
    out.push(node);
    this.parseBranch(out);
    if (this.eatKw('ELSE')) {
      const jmp = { op: 'JUMPEND' }; out.push(jmp);
      node.els = out.length;
      this.parseBranch(out);
    }
  }
  parseBranch(out) {
    if (this.peek() && this.peek().t === 'num') { out.push({ op: 'GOTO', n: this.next().v }); return; }
    if (this.eatKw('GOTO')) { out.push({ op: 'GOTO', n: this.lineNum() }); return; }
    this.parseStatements(out);
  }

  parseFor(out) {
    const lv = this.lvalue(); this.needOp('=');
    const from = this.expr(); if (!this.eatKw('TO')) fail('SYNTAX');
    const to = this.expr(); const step = this.eatKw('STEP') ? this.expr() : null;
    out.push({ op: 'FOR', lv, from, to, step });
  }

  parseDim(out) {
    const items = [];
    do {
      const k = this.next(); if (!k || k.t !== 'id') fail('SYNTAX');
      this.needOp('('); const dims = this.exprList(); this.needOp(')');
      if (this.eatOp('*')) this.expr();
      items.push({ name: k.v, dims });
    } while (this.eatOp(','));
    out.push({ op: 'DIM', items });
  }

  parseOn(out) {
    if (this.eatKw('ERROR')) { if (!this.eatKw('GOTO')) fail('SYNTAX'); out.push({ op: 'ONERR', n: this.lineNum() }); return; }
    const f = this.expr();
    const kind = this.next(); if (!kind || kind.t !== 'kw' || (kind.v !== 'GOTO' && kind.v !== 'GOSUB')) fail('SYNTAX');
    const ns = []; do ns.push(this.lineNum()); while (this.eatOp(','));
    out.push({ op: kind.v === 'GOTO' ? 'ONGOTO' : 'ONGOSUB', f, ns });
  }

  // (x,y) or x,y
  pointArgs() {
    const save = this.p;
    if (this.isOp('(')) {
      try {
        this.next(); const x = this.expr(); this.needOp(','); const y = this.expr(); this.needOp(')');
        const rest = []; while (this.eatOp(',')) rest.push(this.expr());
        return [x, y, ...rest];
      } catch (e) { this.p = save; }
    }
    return this.exprList();
  }

  parseLine(out) {
    let p1 = null;
    if (this.isOp('(')) { p1 = this.pointArgs0(); }
    let p2;
    if (this.eatOp('-')) { p2 = this.pointArgs0(); } else { p2 = p1; p1 = null; }
    let s = null, c = null, flag = '';
    while (this.eatOp(',')) {
      const k = this.peek();
      if (k && k.t === 'id' && (k.v === 'B' || k.v === 'BF')) { flag = k.v; this.next(); continue; }
      if (this.isOp(',')) { continue; }
      const e = this.expr(); if (s === null) s = e; else c = e;
    }
    out.push({ op: 'LINE', p1, p2, s, flag });
  }
  pointArgs0() { this.needOp('('); const x = this.expr(); this.needOp(','); const y = this.expr(); this.needOp(')'); return [x, y]; }

  parseCircle(out) {
    const c = this.pointArgs0(); this.needOp(','); const r = this.expr();
    const rest = []; while (this.eatOp(',')) rest.push(this.isOp(',') ? null : this.expr());
    out.push({ op: 'CIRCLE', c, r, s: rest[0] || null });
  }

  exprList() { const l = [this.expr()]; while (this.eatOp(',')) l.push(this.expr()); return l; }

  // ---- variables
  lvalue() {
    const k = this.next(); if (!k || k.t !== 'id') fail('SYNTAX');
    const name = k.v; let subs = null;
    if (this.isOp('(')) { this.next(); subs = this.exprList(); this.needOp(')'); }
    return this.it.makeVar(name, subs);
  }

  // ---- expressions (closures taking the interpreter)
  expr() { return this.parseOr(); }
  parseOr() {
    let l = this.parseAnd();
    for (;;) {
      if (this.eatKw('OR')) { const a = l, b = this.parseAnd(); l = it => (num(a(it)) | num(b(it))); }
      else if (this.eatKw('XOR')) { const a = l, b = this.parseAnd(); l = it => (num(a(it)) ^ num(b(it))); }
      else return l;
    }
  }
  parseAnd() {
    let l = this.parseNot();
    while (this.eatKw('AND')) { const a = l, b = this.parseNot(); l = it => (num(a(it)) & num(b(it))); }
    return l;
  }
  parseNot() {
    if (this.eatKw('NOT')) { const a = this.parseNot(); return it => ~num(a(it)); }
    return this.parseCmp();
  }
  parseCmp() {
    let l = this.parseAdd();
    for (;;) {
      const k = this.peek();
      if (!k || k.t !== 'op' || !['=', '<', '>', '<=', '>=', '<>', '><', '=<', '=>'].includes(k.v)) return l;
      this.next(); const a = l, b = this.parseAdd(), op = k.v;
      l = it => {
        const x = a(it), y = b(it);
        if ((typeof x === 'string') !== (typeof y === 'string')) fail('TYPE');
        switch (op) {
          case '=': return x === y ? 1 : 0;
          case '<>': case '><': return x !== y ? 1 : 0;
          case '<': return x < y ? 1 : 0;
          case '>': return x > y ? 1 : 0;
          case '<=': case '=<': return x <= y ? 1 : 0;
          default: return x >= y ? 1 : 0;
        }
      };
    }
  }
  parseAdd() {
    let l = this.parseMul();
    for (;;) {
      if (this.isOp('+')) {
        this.next(); const a = l, b = this.parseMul();
        l = it => { const x = a(it), y = b(it); if (typeof x === 'string') { if (typeof y !== 'string') fail('TYPE'); return x + y; } if (typeof y === 'string') fail('TYPE'); return checkNum(round13(x + y)); };
      } else if (this.isOp('-')) {
        this.next(); const a = l, b = this.parseMul(); l = it => checkNum(round13(num(a(it)) - num(b(it))));
      } else return l;
    }
  }
  parseMul() {
    let l = this.parseUnary();
    for (;;) {
      if (this.isOp('*')) { this.next(); const a = l, b = this.parseUnary(); l = it => checkNum(round13(num(a(it)) * num(b(it)))); }
      else if (this.isOp('/')) { this.next(); const a = l, b = this.parseUnary(); l = it => { const d = num(b(it)); if (d === 0) fail('CALC'); return checkNum(round13(num(a(it)) / d)); }; }
      else if (this.isKw('NPR') || this.isKw('NCR')) { const op = this.next().v; const a = l, b = this.parseUnary(); l = it => FUNCS[op](it, num(a(it)), num(b(it))); }
      else return l;
    }
  }
  parseUnary() {
    if (this.eatOp('-')) { const a = this.parseUnary(); return it => -num(a(it)); }
    if (this.eatOp('+')) return this.parseUnary();
    return this.parsePow();
  }
  parsePow() {
    let l = this.parsePrimary();
    for (;;) {
      if (this.eatOp('!')) { const a = l; l = it => FUNCS.FACT(it, a(it)); continue; }
      if (!this.eatOp('^')) break;
      const a = l; const b = this.isOp('-') ? (this.next(), (x => it => -num(x(it)))(this.parsePrimary())) : this.parsePrimary();
      l = it => { const x = num(a(it)), y = num(b(it)); if (x < 0 && !Number.isInteger(y)) fail('CALC'); return checkNum(round13(Math.pow(x, y))); };
    }
    return l;
  }
  parsePrimary() {
    const k = this.next(); if (!k) fail('SYNTAX');
    if (k.t === 'num') { const v = k.v; return () => v; }
    if (k.t === 'str') { const v = k.v; return () => v; }
    if (k.t === 'op' && k.v === '(') { const e = this.expr(); this.needOp(')'); return e; }
    if (k.t === 'id') {
      let subs = null;
      if (this.isOp('(')) { this.next(); subs = this.exprList(); this.needOp(')'); }
      return this.it.makeVar(k.v, subs).get;
    }
    if (k.t === 'kw') {
      switch (k.v) {
        case 'PI': return () => Math.PI;
        case 'ANS': return it => it.ans;
        case 'MEM': return () => 8192;
        case 'ERN': return it => it.errCode;
        case 'ERL': return it => it.errLine;
        case 'TIME': return () => { const d = new Date(); return d.getHours() * 10000 + d.getMinutes() * 100 + d.getSeconds(); };
        case 'INKEY$': return it => it.io.inkey();
      }
      const fn = FUNCS[k.v]; if (!fn) fail('SYNTAX');
      let args;
      if (this.isOp('(')) { this.next(); args = this.exprList(); this.needOp(')'); }
      else args = [this.parsePrimaryArg()];
      return it => fn(it, ...args.map(a => a(it)));
    }
    fail('SYNTAX');
  }
  parsePrimaryArg() { return this.parseUnary(); }
}

const STMT_KW = new Set(['LET', 'REM', 'PRINT', 'LPRINT', 'INPUT', 'GOTO', 'GOSUB', 'RETURN', 'IF', 'FOR', 'NEXT', 'END', 'STOP', 'DIM', 'DATA',
  'READ', 'RESTORE', 'ON', 'CLS', 'LOCATE', 'CSR', 'BEEP', 'WAIT', 'PAUSE', 'PSET', 'PRESET', 'LINE', 'CIRCLE', 'GPRINT', 'GCURSOR',
  'RANDOMIZE', 'RANDOM', 'DEGREE', 'RADIAN', 'GRAD', 'CLEAR', 'AREAD', 'RUN', 'LIST', 'LLIST', 'NEW', 'CONT', 'POKE', 'TRON', 'TROFF', 'RESUME', 'ELSE', 'THEN']);
const num = v => { if (typeof v !== 'number') fail('TYPE'); return v; };
const str = v => { if (typeof v !== 'string') fail('TYPE'); return v; };
const toRad = (it, v) => it.angle === 0 ? v * Math.PI / 180 : it.angle === 1 ? v : v * Math.PI / 200;
const fromRad = (it, v) => it.angle === 0 ? v * 180 / Math.PI : it.angle === 1 ? v : v * 200 / Math.PI;
const FUNCS = {
  ABS: (it, x) => Math.abs(num(x)),
  INT: (it, x) => Math.floor(num(x)),
  FIX: (it, x) => Math.trunc(num(x)),
  SGN: (it, x) => Math.sign(num(x)),
  SQR: (it, x) => { if (num(x) < 0) fail('CALC'); return round13(Math.sqrt(x)); },
  SQU: (it, x) => round13(num(x) * x),
  SIN: (it, x) => round13(Math.sin(toRad(it, num(x)))),
  COS: (it, x) => round13(Math.cos(toRad(it, num(x)))),
  TAN: (it, x) => checkNum(round13(Math.tan(toRad(it, num(x))))),
  ASN: (it, x) => { if (Math.abs(num(x)) > 1) fail('CALC'); return round13(fromRad(it, Math.asin(x))); },
  ACS: (it, x) => { if (Math.abs(num(x)) > 1) fail('CALC'); return round13(fromRad(it, Math.acos(x))); },
  ATN: (it, x) => round13(fromRad(it, Math.atan(num(x)))),
  LOG: (it, x) => { if (num(x) <= 0) fail('CALC'); return round13(Math.log10(x)); },
  LN: (it, x) => { if (num(x) <= 0) fail('CALC'); return round13(Math.log(x)); },
  EXP: (it, x) => checkNum(round13(Math.exp(num(x)))),
  RND: (it, x) => { num(x); return x > 1 ? Math.floor(it.random() * Math.floor(x)) + 1 : it.random(); },
  DEG: (it, x) => { const s = Math.sign(num(x)), a = Math.abs(x), d = Math.floor(a), m = Math.floor((a - d) * 100 + 1e-9), sec = ((a - d) * 100 - m) * 100; return round13(s * (d + m / 60 + sec / 3600)); },
  DMS: (it, x) => { const s = Math.sign(num(x)), a = Math.abs(x), d = Math.floor(a), mm = (a - d) * 60, m = Math.floor(mm), sec = (mm - m) * 60; return round13(s * (d + m / 100 + sec / 10000)); },
  SINH: (it, x) => round13(Math.sinh(num(x))),
  COSH: (it, x) => round13(Math.cosh(num(x))),
  TANH: (it, x) => round13(Math.tanh(num(x))),
  ASNH: (it, x) => round13(Math.asinh(num(x))),
  ACSH: (it, x) => { if (num(x) < 1) fail('CALC'); return round13(Math.acosh(x)); },
  ATNH: (it, x) => { if (Math.abs(num(x)) >= 1) fail('CALC'); return round13(Math.atanh(x)); },
  FACT: (it, x) => { num(x); if (x < 0 || x > 69 || !Number.isInteger(x)) fail('CALC'); let r = 1; for (let i = 2; i <= x; i++) r *= i; return r; },
  NPR: (it, n, r) => { num(n); num(r); if (n < 0 || r < 0 || r > n || !Number.isInteger(n) || !Number.isInteger(r) || n > 69) fail('CALC'); let p = 1; for (let i = 0; i < r; i++) p *= n - i; return p; },
  NCR: (it, n, r) => { num(n); num(r); if (n < 0 || r < 0 || r > n || !Number.isInteger(n) || !Number.isInteger(r) || n > 69) fail('CALC'); r = Math.min(r, n - r); let p = 1; for (let i = 1; i <= r; i++) p = Math.round(p * (n - r + i) / i); return p; },
  MDF: (it, x) => +num(x).toPrecision(10),
  LEN: (it, s) => str(s).length,
  VAL: (it, s) => { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(str(s)); return m ? parseFloat(m[0]) : 0; },
  'STR$': (it, x) => fmtNum(num(x)),
  'CHR$': (it, x) => { if (num(x) < 0 || x > 255) fail('FUNC'); return String.fromCharCode(x); },
  'HEX$': (it, x) => Math.trunc(num(x)).toString(16).toUpperCase(),
  ASC: (it, s) => str(s).length ? s.charCodeAt(0) : fail('FUNC'),
  'LEFT$': (it, s, n) => str(s).slice(0, Math.max(0, num(n))),
  'RIGHT$': (it, s, n) => n <= 0 ? '' : str(s).slice(-num(n)),
  'MID$': (it, s, a, n) => { str(s); if (num(a) < 1) fail('FUNC'); return n === undefined ? s.slice(a - 1) : s.substr(a - 1, Math.max(0, n)); },
  PEEK: (it, a) => it.mem[num(a) & 0xffff],
  POINT: (it, x, y) => it.screen.point(num(x), num(y)),
};
// POINT(x,y)/MID$ etc. take a parenthesised list; single-arg functions also accept juxtaposition (SIN X).

export class Interp {
  /** io: { screen, beep(freq,ms), inkey(), requestInput(promptHandled), listLines(lines), onIdle(), print helpers } */
  constructor(screen, io) {
    this.screen = screen; this.io = io;
    this.prog = new Map(); this.lines = []; this.byNum = new Map();
    this.mem = new Uint8Array(65536);
    this.state = 'idle'; this.angle = 0;
    this.errCode = 0; this.errLine = 0; this.errHandler = null;
    this.ans = 0; this.calcMem = 0;
    this.rng = Math.random;
    this.newVars();
  }
  random() { return this.rng(); }

  newVars() {
    this.num = new Array(27 + 100).fill(0); // index 1..26 = A..Z (A(n) aliases)
    this.sv = new Array(27 + 100).fill('');
    this.vars = new Map(); this.arrays = new Map();
    this.forStack = []; this.gosubStack = [];
    this.readLine = null; this.dataPtr = null; this.errHandler = null;
  }

  // ---- program store
  rebuild() {
    this.lines = [...this.prog.entries()].sort((a, b) => a[0] - b[0]).map(([n, text], i) => ({ n, text, i, stmts: null }));
    this.byNum = new Map(this.lines.map(l => [l.n, l]));
  }
  compileLine(line) {
    if (line.stmts) return line.stmts;
    const out = [];
    const p = new Parser(lex(line.text), this);
    p.parseStatements(out);
    if (!p.atEnd()) fail('SYNTAX');
    line.stmts = out; return out;
  }
  setLine(n, text) {
    if (text.trim() === '') this.prog.delete(n); else this.prog.set(n, text.trim());
    this.rebuild(); this.state = 'idle'; this.cont = null; this.forStack = []; this.gosubStack = [];
  }
  loadText(src) { // multi-line text with line numbers
    for (const raw of src.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s?(.*)$/.exec(raw); if (m) { if (m[2].trim() === '') this.prog.delete(+m[1]); else this.prog.set(+m[1], m[2]); }
    }
    this.rebuild();
  }
  listText() { return this.lines.map(l => `${l.n} ${l.text}`).join('\n'); }
  clearAll() { this.prog.clear(); this.rebuild(); this.newVars(); this.state = 'idle'; this.cont = null; }

  // ---- variables
  makeVar(name, subs) {
    const isStr = name.endsWith('$'), base = isStr ? name.slice(0, -1) : name;
    const single = base.length === 1;
    const store = isStr ? 'sv' : 'num', dflt = isStr ? '' : 0;
    const chk = v => { if (isStr ? typeof v !== 'string' : typeof v !== 'number') fail('TYPE'); return v; };
    if (!subs) {
      if (single) {
        const idx = base.charCodeAt(0) - 64;
        return { name, get: it => it[store][idx], set: (it, v) => { it[store][idx] = chk(v); } };
      }
      return { name, get: it => { const v = it.vars.get(name); return v === undefined ? dflt : v; }, set: (it, v) => { it.vars.set(name, chk(v)); } };
    }
    if (subs.length === 1 && single) {
      const off = base.charCodeAt(0) - 64, f = subs[0];
      const pos = it => { const i = Math.trunc(num(f(it))); const p = i === 0 ? 0 : off + i - 1; if (i < 0 || p >= it[store].length) fail('SUB'); return p; };
      return { name, get: it => it[store][pos(it)], set: (it, v) => { it[store][pos(it)] = chk(v); } };
    }
    const locate = (it, create) => {
      let arr = it.arrays.get(name);
      if (!arr) { if (!create) { arr = it.dim(name, subs.map(() => 10)); } else arr = it.dim(name, subs.map(() => 10)); }
      const ix = subs.map(f => Math.trunc(num(f(it))));
      if (ix.length !== arr.dims.length) fail('SUB');
      let p = 0;
      for (let d = 0; d < ix.length; d++) { if (ix[d] < 0 || ix[d] > arr.dims[d]) fail('SUB'); p = p * (arr.dims[d] + 1) + ix[d]; }
      return arr.data[p] === undefined ? [arr, p] : [arr, p];
    };
    return {
      name,
      get: it => { const [a, p] = locate(it); const v = a.data[p]; return v === undefined ? dflt : v; },
      set: (it, v) => { const [a, p] = locate(it, true); a.data[p] = chk(v); },
    };
  }
  dim(name, dims) {
    let size = 1; for (const d of dims) size *= d + 1;
    if (size > 200000) fail('MEM');
    const arr = { dims, data: new Array(size) };
    this.arrays.set(name, arr); return arr;
  }
  doDim(items) {
    for (const { name, dims } of items) {
      const d = dims.map(f => Math.trunc(num(f(this))));
      if (d.some(x => x < 0)) fail('SUB');
      const isStr = name.endsWith('$'), base = isStr ? name.slice(0, -1) : name;
      if (d.length === 1 && base.length === 1) {
        const store = isStr ? 'sv' : 'num';
        const need = base.charCodeAt(0) - 64 + d[0] + 1;
        if (need > 20000) fail('MEM');
        while (this[store].length < need) this[store].push(isStr ? '' : 0);
      } else this.dim(name, d);
    }
  }

  // ---- running
  start(n = null) {
    if (!this.lines.length) { this.state = 'idle'; return; }
    this.newVars();
    const line = n === null ? this.lines[0] : this.byNum.get(n);
    if (!line) fail('LINE');
    this.line = line; this.idx = 0; this.state = 'running'; this.cont = null; this.initData();
  }
  initData() { this.dataPtr = { li: 0, items: null, pos: 0 }; }
  isStatement(tokens) {
    const t0 = tokens[0]; if (!t0) return true;
    if (t0.t === 'kw') return STMT_KW.has(t0.v);
    if (t0.t !== 'id') return false;
    if (tokens[1] && tokens[1].t === 'op' && tokens[1].v === '=') return true;
    if (tokens[1] && tokens[1].t === 'op' && tokens[1].v === '(') { // A(1)=...
      let d = 0; for (let i = 1; i < tokens.length; i++) { const k = tokens[i]; if (k.t === 'op' && k.v === '(') d++; else if (k.t === 'op' && k.v === ')' && --d === 0) return !!(tokens[i + 1] && tokens[i + 1].t === 'op' && tokens[i + 1].v === '='); }
    }
    return false;
  }
  // Calculator mode: compile "expression" (a leading * / ^ continues from ANS)
  compileExpr(text) {
    let toks = lex(text);
    if (toks[0] && toks[0].t === 'op' && ['*', '/', '^'].includes(toks[0].v)) toks = [{ t: 'kw', v: 'ANS' }, ...toks];
    const p = new Parser(toks, this); const f = p.expr(); if (!p.atEnd()) fail('SYNTAX');
    return f;
  }
  /** Splits "10 PRINT X" into [10, "PRINT X"]. Returns null when the line is a calculator expression
   *  (e.g. "2+3", "5 NPR 2"): the text after the number must start a statement (or be empty for line deletion). */
  parseNumbered(line) {
    const m = /^\s*(\d+)\s?(.*)$/.exec(line); if (!m) return null;
    const n = +m[1], rest = m[2];
    if (rest.trim() === '') return this.prog.has(n) ? [n, ''] : null;
    try { return this.isStatement(lex(rest)) ? [n, rest] : null; } catch (e) { return [n, rest]; }
  }
  evalNow(text) { const v = this.compileExpr(text)(this); if (typeof v === 'number') this.ans = v; return v; }
  runDirect(text) {
    const tmp = { n: -1, i: -1, text, stmts: null };
    const toks = lex(text);
    if (!this.isStatement(toks)) { const f = this.compileExpr(text); tmp.stmts = [{ op: 'CALC', f }]; }
    else this.compileLine(tmp);
    const wasLines = this.lines;
    this.line = tmp; this.idx = 0; this.state = 'running';
    if (!this.dataPtr) this.initData();
  }
  breakRun(msg = true) {
    if (this.state === 'idle') return;
    this.cont = this.line && this.line.n >= 0 ? { line: this.line, idx: this.idx } : null;
    const n = this.line ? this.line.n : -1;
    this.state = 'idle';
    this.printLn(); if (msg) this.printLn(n >= 0 ? `BREAK IN ${n}` : 'BREAK');
    this.io.onIdle();
  }
  finish() { this.state = 'idle'; this.io.onIdle(); }
  printLn(s = '') { if (this.screen.cx !== 0 && s === '') { this.screen.newline(); return; } this.screen.print(s); this.screen.newline(); }

  tick(now, budget) {
    if (this.state === 'waitTime') { if (now < this.waitUntil) return 0; this.state = 'running'; if (this.pauseNl) { this.pauseNl = false; this.screen.newline(); } }
    let n = 0;
    while (this.state === 'running' && n < budget) { n++; this.stepOne(); }
    return n;
  }

  stepOne() {
    const line = this.line;
    try {
      if (!line.stmts) this.compileLine(line);
      if (this.idx >= line.stmts.length) { this.nextLine(); return; }
      this.exec(line.stmts[this.idx++], line);
    } catch (e) {
      if (!(e instanceof BasicError)) throw e;
      this.handleError(e, line);
    }
  }
  nextLine() {
    const l = this.line;
    if (l.n < 0) { this.finish(); return; }
    const nx = this.lines[l.i + 1];
    if (!nx) { this.finish(); return; }
    this.line = nx; this.idx = 0;
  }
  handleError(e, line) {
    this.errCode = e.code; this.errLine = line.n;
    if (this.errHandler !== null && this.byNum.has(this.errHandler) && !this.inHandler) {
      this.errPos = { line, idx: this.idx - 1 }; this.inHandler = true;
      this.line = this.byNum.get(this.errHandler); this.idx = 0; return;
    }
    this.state = 'idle'; this.inHandler = false;
    this.cont = null;
    if (this.screen.cx !== 0) this.screen.newline();
    this.screen.print(`ERROR ${e.code}` + (line.n >= 0 ? ` IN ${line.n}` : '')); this.screen.newline();
    this.screen.print(e.message.slice(0, 24)); this.screen.newline();
    this.io.onIdle();
  }
  jump(n) {
    const l = this.byNum.get(n); if (!l) fail('LINE');
    this.line = l; this.idx = 0;
  }

  exec(s, line) {
    switch (s.op) {
      case 'LET': s.lv.set(this, s.f(this)); return;
      case 'CALC': {
        const v = s.f(this);
        if (typeof v === 'number') this.ans = v;
        const t = typeof v === 'string' ? v : fmtNum(v);
        if (this.screen.cx !== 0) this.screen.newline();
        this.screen.print(typeof v === 'string' ? t : ' '.repeat(Math.max(0, 24 - t.length)) + t); this.screen.newline();
        return;
      }
      case 'PRINT': this.doPrint(s); return;
      case 'PAUSE': this.doPrint(s, true); this.waitUntil = this.io.now() + 850; this.state = 'waitTime'; return;
      case 'GOTO': this.jump(s.n); return;
      case 'GOSUB': if (this.gosubStack.length > 100) fail('MEM'); this.gosubStack.push({ line: this.line, idx: this.idx }); this.jump(s.n); return;
      case 'RETURN': { const r = this.gosubStack.pop(); if (!r) fail('RET'); this.line = r.line; this.idx = r.idx; return; }
      case 'IF': if (!num(s.cond(this))) { this.idx = s.els >= 0 ? s.els : line.stmts.length; } return;
      case 'JUMPEND': this.idx = line.stmts.length; return;
      case 'FOR': {
        const start = num(s.from(this)), end = num(s.to(this)), step = s.step ? num(s.step(this)) : 1;
        s.lv.set(this, start);
        const key = s.lv.name;
        const k = this.forStack.findIndex(f => f.key === key); if (k >= 0) this.forStack.length = k;
        this.forStack.push({ key, lv: s.lv, end, step, line: this.line, idx: this.idx });
        // body is skipped entirely only when the loop already exceeds its limit (Sharp BASIC executes body once; keep standard behaviour)
        return;
      }
      case 'NEXT': {
        let f;
        if (s.vars.length) { const key = s.vars[0]; const k = this.forStack.map(x => x.key).lastIndexOf(key); if (k < 0) fail('NEXT'); this.forStack.length = k + 1; f = this.forStack[k]; }
        else f = this.forStack[this.forStack.length - 1];
        if (!f) fail('NEXT');
        const v = round13(f.lv.get(this) + f.step); f.lv.set(this, v);
        if (f.step >= 0 ? v <= f.end : v >= f.end) { this.line = f.line; this.idx = f.idx; }
        else this.forStack.pop();
        return;
      }
      case 'END': this.finish(); return;
      case 'STOP': this.cont = { line: this.line, idx: this.idx }; this.state = 'idle'; this.printLn(); this.printLn(`BREAK IN ${this.line.n}`); this.io.onIdle(); return;
      case 'DIM': this.doDim(s.items); return;
      case 'DATA': return;
      case 'READ': for (const lv of s.l) lv.set(this, this.readData(lv.name.endsWith('$'))); return;
      case 'RESTORE': this.initData(); if (s.n !== null) { const l = this.byNum.get(s.n); if (!l) fail('LINE'); this.dataPtr.li = l.i; } return;
      case 'ONGOTO': case 'ONGOSUB': {
        const v = Math.trunc(num(s.f(this)));
        if (v >= 1 && v <= s.ns.length) {
          if (s.op === 'ONGOSUB') this.gosubStack.push({ line: this.line, idx: this.idx });
          this.jump(s.ns[v - 1]);
        }
        return;
      }
      case 'ONERR': this.errHandler = s.n; return;
      case 'RESUME': {
        if (!this.errPos) fail('RET');
        const p = this.errPos; this.inHandler = false; this.errPos = null;
        if (s.m === 'line') { this.jump(s.n); return; }
        this.line = p.line; this.idx = p.idx + (s.m === 'next' ? 1 : 0); return;
      }
      case 'CLS': this.screen.clear(); this.screen.gx = 0; return;
      case 'LOCATE': { const a = s.a.map(f => Math.trunc(num(f(this)))); this.screen.locate(a[0], a[1] === undefined ? this.screen.cy : a[1]); return; }
      case 'CSR': this.screen.locate(num(s.a(this)), this.screen.cy); return;
      case 'BEEP': { const a = s.a.map(f => num(f(this))); this.io.beep(a.length > 1 ? a[1] : 2700, a.length > 2 ? a[2] : 100); return; }
      case 'WAIT': { const n = s.a ? num(s.a(this)) : 64; this.waitUntil = this.io.now() + n * (1000 / 64); this.state = 'waitTime'; return; }
      case 'PSET': case 'PRESET': { const a = s.a.map(f => num(f(this))); this.screen.pset(a[0], a[1], s.op === 'PSET' ? (a[2] === 0 ? 0 : 1) : 0); return; }
      case 'LINE': {
        const p2 = s.p2.map(f => num(f(this)));
        const p1 = s.p1 ? s.p1.map(f => num(f(this))) : [this.lastX ?? 0, this.lastY ?? 0];
        const on = s.s ? (num(s.s(this)) === 0 ? 0 : 1) : 1;
        if (s.flag === 'B') this.screen.box(p1[0], p1[1], p2[0], p2[1], on);
        else if (s.flag === 'BF') this.screen.box(p1[0], p1[1], p2[0], p2[1], on, true);
        else this.screen.line(p1[0], p1[1], p2[0], p2[1], on);
        this.lastX = p2[0]; this.lastY = p2[1]; return;
      }
      case 'CIRCLE': { const c = s.c.map(f => num(f(this))); this.screen.circle(c[0], c[1], num(s.r(this)), s.s ? (num(s.s(this)) === 0 ? 0 : 1) : 1); return; }
      case 'GPRINT': { for (const f of s.l) { const v = f(this); this.screen.gprint(typeof v === 'string' ? v : fmtNum(v)); } return; }
      case 'GCURSOR': this.screen.gx = Math.max(0, Math.min(143, Math.trunc(num(s.a(this))))); return;
      case 'RANDOMIZE': return;
      case 'ANGLE': this.angle = s.m; return;
      case 'CLEAR': { const prog = this.prog; this.newVars(); return; }
      case 'AREAD': s.l.set(this, s.l.name.endsWith('$') ? '' : 0); return;
      case 'POKE': { const a = s.a.map(f => num(f(this))); this.mem[a[0] & 0xffff] = a[1] & 0xff; return; }
      case 'INPUT': this.beginInput(s); return;
      case 'RUN': { this.start(s.n); return; }
      case 'LIST': { this.state = 'idle'; this.io.listLines(this.lines.filter(l => (s.a === null || l.n >= s.a) && (s.b === null || l.n <= s.b)).map(l => `${l.n} ${l.text}`)); return; }
      case 'NEW': this.clearAll(); this.finish(); return;
      case 'CONT': {
        if (!this.cont) fail('RET');
        this.line = this.cont.line; this.idx = this.cont.idx; this.cont = null; return;
      }
      default: fail('SYNTAX');
    }
  }

  readData(wantStr) {
    const d = this.dataPtr;
    for (;;) {
      if (!d.items) {
        if (d.li >= this.lines.length) fail('DATA');
        const l = this.lines[d.li]; const toks = lex(l.text);
        const items = []; let hasData = false;
        for (let i = 0; i < toks.length; i++) {
          if (toks[i].t === 'kw' && toks[i].v === 'REM') break;
          if (toks[i].t === 'kw' && toks[i].v === 'DATA') { hasData = true; items.push(...splitData(toks[i + 1] && toks[i + 1].t === 'rest' ? toks[i + 1].v : '')); }
        }
        d.items = items; d.pos = 0; d.li = d.li; d.cur = d.li;
        if (!hasData) { d.items = null; d.li++; continue; }
      }
      if (d.pos >= d.items.length) { d.items = null; d.li++; continue; }
      const raw = d.items[d.pos++];
      if (wantStr) return raw.q ? raw.v : raw.v.trim();
      const v = parseFloat(raw.v); if (Number.isNaN(v)) { if (raw.v.trim() === '') return 0; fail('TYPE'); } return v;
    }
  }

  // ---- PRINT
  doPrint(s, isPause = false) {
    let out = '';
    const sc = this.screen;
    const emit = t => { sc.print(t); };
    let usingFmt = s.using ? str(s.using(this)) : null;
    let ni = 0;
    for (const it of s.items) {
      if (it.sep === ',') { const col = sc.cx; const next = (Math.floor(col / 8) + 1) * 8; emit(' '.repeat(Math.max(0, Math.min(24, next) - col))); continue; }
      if (it.sep === ';') continue;
      const v = it.f(this);
      if (usingFmt !== null) emit(formatUsing(usingFmt, v, ni++));
      else emit(typeof v === 'string' ? v : fmtNum(v));
    }
    if (isPause) { this.pauseNl = s.nl; return; }
    if (s.nl) sc.newline();
  }

  // ---- INPUT
  beginInput(s) {
    this.inputSpec = s; this.inputVals = [];
    const p = s.prompt !== null ? s.prompt : '?';
    this.screen.print(p);
    this.state = 'waitInput'; this.io.requestInput();
  }
  provideInput(text) {
    const s = this.inputSpec; const vars = s.l;
    const parts = [];
    let cur = '', q = false;
    for (const ch of text) { if (ch === '"') q = !q; if (ch === ',' && !q) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    try {
      const need = vars.length - this.inputVals.length;
      const take = parts.slice(0, need);
      const vals = take.map((t, i) => {
        const lv = vars[this.inputVals.length + i];
        if (lv.name.endsWith('$')) return t.replace(/^\s*"?|"?\s*$/g, '');
        const tt = t.trim(); if (tt === '') return 0;
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tt)) throw new BasicError(8, 'TYPE MISMATCH');
        return parseFloat(tt);
      });
      this.inputVals.push(...vals);
    } catch (e) { this.screen.print('?'); this.state = 'waitInput'; this.io.requestInput(); return; }
    if (this.inputVals.length < vars.length) { this.screen.print('?'); this.state = 'waitInput'; this.io.requestInput(); return; }
    vars.forEach((lv, i) => lv.set(this, this.inputVals[i]));
    this.state = 'running';
  }
}

function splitData(raw) {
  const items = []; let cur = '', q = false, wasQ = false;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (i === raw.length || (ch === ',' && !q)) { items.push({ v: cur, q: wasQ }); cur = ''; wasQ = false; continue; }
    if (ch === '"') { q = !q; wasQ = true; continue; }
    cur += ch;
  }
  return items;
}

function formatUsing(fmt, v, n) {
  if (typeof v === 'string') {
    if (/&/.test(fmt)) return v;
    const m = /\{|!|#+/.exec(fmt); const w = fmt.length || v.length;
    return (v + ' '.repeat(w)).slice(0, w);
  }
  const m = /[#,]*[#][#,]*(\.#*)?|\.#+/.exec(fmt);
  if (!m) return fmtNum(v);
  const spec = m[0]; const dot = spec.indexOf('.');
  const decs = dot >= 0 ? spec.length - dot - 1 : 0;
  const width = spec.length;
  const comma = spec.includes(',');
  let s = Math.abs(v).toFixed(decs);
  if (comma) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); }
  if (v < 0) s = '-' + s;
  s = s.padStart(width, ' ');
  return fmt.slice(0, m.index) + s + fmt.slice(m.index + spec.length);
}
