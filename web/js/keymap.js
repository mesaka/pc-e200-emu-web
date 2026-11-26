// Key matrix (from MAME sharp/pce220.cpp, PC-G850V). [line, bit] per key id.
// Ports: lines selected by 0x11/0x12, read at 0x10. SHIFT = port 0x13 bit0, ON = port 0x1F bit7.
export const KEY_ROWS = [
  // line 0..9, bit 0..7
  ['OFF', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','],
  ['BASIC', 'TEXT', 'CAPS', 'KANA', 'TAB', 'SPACE', 'DOWN', 'UP'],
  ['LEFT', 'RIGHT', 'CONS', '0', '.', '=', '+', 'ENTER'],
  ['L', ';', 'DEL', '1', '2', '3', '-', 'M+'],
  ['I', 'O', 'INS', '4', '5', '6', '*', 'RM'],
  ['P', 'BS', 'PI', '7', '8', '9', '/', ')'],
  ['NPR', 'DEG', 'SQR', 'SQU', '^', '(', '1/X', 'MDF'],
  ['2ND', 'SIN', 'COS', 'LN', 'LOG', 'TAN', 'FSE', 'CCE'],
];

export const KEY_MATRIX = {};
KEY_ROWS.forEach((row, line) => row.forEach((name, bit) => { KEY_MATRIX[name] = [line, bit]; }));

// PC keyboard -> pocket computer key (with optional shift). Unshifted PC symbols that need the
// pocket's SHIFT are handled by `charKey`.
export const CODE_MAP = {
  Enter: 'ENTER', NumpadEnter: 'ENTER', Space: 'SPACE', Tab: 'TAB', Backspace: 'BS', Delete: 'DEL', Insert: 'INS',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', Escape: 'CCE', Home: 'CONS',
  F1: 'BASIC', F2: 'TEXT', F3: 'CAPS', F4: 'KANA',
  Comma: ',', Period: '.', Semicolon: ';', Minus: '-', Equal: '=', Slash: '/',
  NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.',
};
for (let i = 0; i <= 9; i++) { CODE_MAP['Digit' + i] = String(i); CODE_MAP['Numpad' + i] = String(i); }
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODE_MAP['Key' + c] = c;

// Shifted characters on the pocket computer (from MAME PORT_CHAR layout): char -> [key, needsShift]
export const CHAR_KEY = {
  '!': ['Q', true], '"': ['W', true], '#': ['E', true], '$': ['R', true], '%': ['T', true], '&': ['Y', true], "'": ['U', true],
  '[': ['A', true], ']': ['S', true], '{': ['D', true], '}': ['F', true], '|': ['H', true], '~': ['J', true], '_': ['K', true],
  '?': [',', true], '<': ['I', true], '>': ['O', true], '@': ['P', true], ':': [';', true],
  '(': ['(', false], ')': [')', false], '^': ['^', false], '*': ['*', false], '+': ['+', false], '=': ['=', false],
};
