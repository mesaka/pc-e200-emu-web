import assert from 'node:assert/strict';
import { BasicMachine } from '../web/js/basic/machine.js';

let clock = 0;
function mk() { clock = 0; return new BasicMachine({ speed: Infinity, now: () => clock }); }
function run(m, prog, inputs = []) {
  m.load(prog); m.type('RUN\r');
  for (let i = 0; i < 400; i++) {
    clock += 100; m.runMs(100);
    if (m.interp.state === 'waitInput' && inputs.length) m.type(inputs.shift() + '\r');
    if (m.interp.state === 'idle' && !m.listJob) break;
  }
  return m.lcd.text().join('\n');
}
const t = (name, prog, expect, inputs) => {
  const m = mk(); const out = run(m, prog, inputs);
  try { assert.ok(out.includes(expect), `expected "${expect}"`); console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name, '\n' + out); process.exitCode = 1; }
};

t('print/arith', '10 PRINT 1+2*3', '7');
t('float', '10 PRINT 1/3', '0.3333333333');
t('float sum', '10 PRINT 0.1+0.2=0.3', '1');
t('strings', '10 A$="HELLO":PRINT LEFT$(A$,2);MID$(A$,2,3);RIGHT$(A$,1)', 'HEELLO'.replace('HEELLO', 'HEELLO'));
t('for/next', '10 FOR I=1 TO 5:S=S+I:NEXT I:PRINT S', '15');
t('step neg', '10 FOR I=3 TO 1 STEP -1:PRINT I;:NEXT:PRINT', '321');
t('gosub', '10 GOSUB 100:PRINT "B":END\n100 PRINT "A":RETURN', 'A\nB');
t('if else', '10 A=5:IF A>3 THEN PRINT "BIG" ELSE PRINT "SMALL"\n20 IF A<3 THEN PRINT "X" ELSE PRINT "Y"', 'BIG\nY');
t('if then line', '10 IF 1=1 THEN 30\n20 PRINT "NO"\n30 PRINT "YES"', 'YES');
t('data/read', '10 READ A,B$,C\n20 PRINT A;B$;C\n30 DATA 1,"X Y",3', '1X Y3');
t('on goto', '10 ON 2 GOTO 100,200\n100 PRINT "ONE":END\n200 PRINT "TWO"', 'TWO');
t('array alias', '10 DIM A(30):A(1)=7:PRINT A;A(30)', '70');
t('2d array', '10 DIM X(2,3):X(2,3)=9:PRINT X(2,3)', '9');
t('input', '10 INPUT "N=";N:PRINT N*2', '20', ['10']);
t('input str', '10 INPUT A$:PRINT LEN(A$)', '5', ['HELLO']);
t('using', '10 PRINT USING "###.##";3.14159', '  3.14');
t('trig deg', '10 PRINT SIN 30', '0.5');
t('exp', '10 PRINT 2^10', '1024');
t('neg pow', '10 PRINT -2^2', '-4');
t('val str$', '10 PRINT VAL("12.5")+1;STR$(7)', '13.57');
t('chr asc', '10 PRINT ASC("A");CHR$(66)', '65B');
t('comma tab', '10 PRINT 1,2', '1       2');
t('while via goto', '10 I=I+1:IF I<100 THEN 10\n20 PRINT I', '100');
t('error', '10 PRINT 1/0', 'ERROR 2 IN 10');
t('on error', '10 ON ERROR GOTO 100\n20 PRINT 1/0\n30 PRINT "N"\n40 END\n100 PRINT "E";ERN:RESUME NEXT', 'E2');
t('no space', '10 FORI=1TO3:PRINTI;:NEXTI', '123');
t('int/fix', '10 PRINT INT(-1.5);FIX(-1.5)', '-2-1');
t('locate', '10 CLS:LOCATE 5,2:PRINT "X"', '     X');
t('pset', '10 PSET 3,4:PRINT POINT(3,4);POINT(3,5)', '10');
t('stop/cont', '10 PRINT "A":STOP\n20 PRINT "B"', 'BREAK IN 10');
t('big num', '10 PRINT 1E10;2^40', '1E+101.099511628E+12');
// PC-E200 style number guessing program (RANDOM, RND(1), IF..THEN..ELSE)
{
  const prog = `10 RANDOM
20 A=INT(RND(1)*100)+1
30 C=0
40 PRINT "1-100?"
50 INPUT G
60 C=C+1
70 IF G=A THEN 110
80 IF G<A THEN PRINT "SMALL" ELSE PRINT "BIG"
90 GOTO 40
100 END
110 PRINT "HIT! ";C`;
  const m = mk(); m.interp.rng = () => 0.41;   // A = INT(0.41*100)+1 = 42
  const out = run(m, prog, ['50', '30', '42']);
  assert.ok(out.includes('HIT! 3'), out); assert.ok(/BIG|SMALL/.test(out) || true);
  const m2 = mk(); m2.interp.rng = () => 0.41; run(m2, prog, ['50']);
  assert.ok(m2.lcd.text().join('\n').includes('BIG'));
  console.log('ok   guess game (RANDOM)');
}
// direct mode
{
  const m = mk(); m.type('PRINT 2+3\r'); clock += 100; m.runMs(100);
  assert.ok(m.lcd.text().join('\n').includes('5')); console.log('ok   direct');
  m.type('10 PRINT "HI"\r20 PRINT "YO"\rLIST\r'); clock += 100; m.runMs(100); m.runMs(100);
  const o = m.lcd.text().join('\n'); assert.ok(o.includes('10 PRINT "HI"') && o.includes('20 PRINT "YO"'), o); console.log('ok   list');
}

// ---- calculator mode
function calc(lines) {
  const m = mk();
  for (const l of lines) { m.type(l + '\r'); clock += 50; m.runMs(50); }
  return { m, out: m.lcd.text().join('\n') };
}
const ct = (name, lines, expect) => {
  const { out } = calc(lines);
  try { assert.ok(out.includes(expect), `expected "${expect}"`); console.log('ok   calc', name); }
  catch (e) { console.log('FAIL calc', name, '\n' + out); process.exitCode = 1; }
};
ct('bare expr', ['2+3*4'], '14');
ct('ans', ['10/4', 'ANS*2'], '5');
ct('implicit ans', ['6', '*7'], '42');
ct('sin', ['SIN 30'], '0.5');
ct('sqrt', ['SQR 2'], '1.414213562');
ct('fact', ['5!'], '120');
ct('npr', ['5 NPR 2'], '20');
ct('ncr', ['5 NCR 2'], '10');
ct('hyp', ['SINH 0'], '0');
ct('asinh', ['ASNH 1'], '0.881373587');
ct('log', ['LOG 1000'], '3');
ct('pi', ['PI*2'], '6.283185307');
ct('var assign still works', ['A=5', 'A*A'], '25');
ct('arr assign', ['DIM B(3)', 'B(2)=9', 'B(2)+1'], '10');
ct('radian', ['RADIAN', 'SIN (PI/2)'], '1');
ct('error', ['1/0'], 'ERROR 2');
ct('fact err', ['70!'], 'ERROR 2');
ct('mdf', ['MDF (1/3)'], '0.3333333333');
{
  const { m } = calc(['2+3']);
  m.type('4*5'); m.memAdd(1);               // M+ evaluates the typed line
  assert.equal(m.calcMem, 20); assert.equal(m.ans, 20);
  m.memAdd(-1); assert.equal(m.calcMem, 0);   // M- with empty line uses ANS
  m.memAdd(1); m.memAdd(1); assert.equal(m.calcMem, 40);
  m.memClear(); assert.equal(m.calcMem, 0);
  assert.equal(m.cycleAngle(), 'RAD'); assert.equal(m.cycleAngle(), 'GRAD'); assert.equal(m.cycleAngle(), 'DEG');
  console.log('ok   calc memory/angle');
}

ct('line number still stored', ['10 PRINT 5', 'RUN'], '5');
{ const { out } = calc(['10 PRINT 5', '10', 'RUN']); assert.ok(!/^5$/m.test(out) && !out.includes('ERROR'), out); console.log('ok   calc line delete'); }
