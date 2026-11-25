/** A cell reference as it was written, so a rewrite can keep the letter's case. */
export interface CellRef {
  start: number;
  end: number;
  col: number;
  row: number;
  letters: string;
}

export type Expr =
  | { type: 'num'; value: number }
  | { type: 'ref'; col: number; row: number }
  | { type: 'refError' }
  | { type: 'unary'; op: '+' | '-'; expr: Expr }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr };

export interface ParsedFormula {
  expr: Expr;
  refs: CellRef[];
}

interface ParseState {
  source: string;
  index: number;
  refs: CellRef[];
}

const NUMBER_TOKEN = /^(?:\d+\.\d+|\d+)/;

function skip(state: ParseState): void {
  const { source } = state;
  let { index } = state;
  while (index < source.length && (source[index] === ' ' || source[index] === '\t')) {
    index += 1;
  }
  state.index = index;
}

function parsePrimary(state: ParseState): Expr | null {
  skip(state);
  const { source } = state;
  const ch = source[state.index];
  if (ch === '(' || ch === '[') {
    const close = ch === '(' ? ')' : ']';
    state.index += 1;
    const inner = parseAdditive(state);
    if (!inner) {
      return null;
    }
    skip(state);
    if (source[state.index] !== close) {
      return null;
    }
    state.index += 1;
    return inner;
  }
  if (source.startsWith('#REF!', state.index)) {
    state.index += 5;
    return { type: 'refError' };
  }
  const ref = matchRef(state);
  if (ref) {
    return ref;
  }
  return matchNumber(state);
}

function matchRef(state: ParseState): Expr | null {
  const { source } = state;
  const start = state.index;
  const letter = source[start];
  if (!letter || !/[A-Za-z]/.test(letter)) {
    return null;
  }
  const second = source[start + 1];
  if (second !== undefined && /[A-Za-z]/.test(second)) {
    return null;
  }
  if (second === undefined || !/[1-9]/.test(second)) {
    return null;
  }
  let end = start + 2;
  while (end < source.length && /[0-9]/.test(source[end] ?? '')) {
    end += 1;
  }
  const row = Number(source.slice(start + 1, end));
  if (!Number.isSafeInteger(row) || row < 1) {
    return null;
  }
  const col = letter.toUpperCase().charCodeAt(0) - 64;
  state.index = end;
  state.refs.push({ start, end, col, row, letters: letter });
  return { type: 'ref', col, row };
}

function matchNumber(state: ParseState): Expr | null {
  const slice = state.source.slice(state.index);
  const match = NUMBER_TOKEN.exec(slice);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  if (!Number.isFinite(value)) {
    return null;
  }
  state.index += match[0].length;
  return { type: 'num', value };
}

/**
 * Power is right-associative and binds tighter than unary minus, so -2^2 is -4.
 * `**` and `^` are the same operator.
 */
function parsePower(state: ParseState): Expr | null {
  const left = parsePrimary(state);
  if (!left) {
    return null;
  }
  skip(state);
  if (state.source.startsWith('**', state.index)) {
    state.index += 2;
  } else if (state.source[state.index] === '^') {
    state.index += 1;
  } else {
    return left;
  }
  const right = parseUnary(state);
  if (!right) {
    return null;
  }
  return { type: 'bin', op: '^', left, right };
}

function parseUnary(state: ParseState): Expr | null {
  skip(state);
  const op = state.source[state.index];
  if (op === '+' || op === '-') {
    state.index += 1;
    const expr = parseUnary(state);
    if (!expr) {
      return null;
    }
    return { type: 'unary', op, expr };
  }
  return parsePower(state);
}

function parseMultiplicative(state: ParseState): Expr | null {
  let left = parseUnary(state);
  if (!left) {
    return null;
  }
  for (;;) {
    skip(state);
    const op = state.source[state.index];
    if (op !== '*' && op !== '/') {
      break;
    }
    state.index += 1;
    const right = parseUnary(state);
    if (!right) {
      return null;
    }
    left = { type: 'bin', op, left, right };
  }
  return left;
}

function parseAdditive(state: ParseState): Expr | null {
  let left = parseMultiplicative(state);
  if (!left) {
    return null;
  }
  for (;;) {
    skip(state);
    const op = state.source[state.index];
    if (op !== '+' && op !== '-') {
      break;
    }
    state.index += 1;
    const right = parseMultiplicative(state);
    if (!right) {
      return null;
    }
    left = { type: 'bin', op, left, right };
  }
  return left;
}

/** A formula starts with `=`. Anything that does not parse returns null. */
export function parseFormula(source: string): ParsedFormula | null {
  if (!source.startsWith('=')) {
    return null;
  }
  const state: ParseState = { source, index: 1, refs: [] };
  const expr = parseAdditive(state);
  if (!expr) {
    return null;
  }
  skip(state);
  if (state.index !== source.length) {
    return null;
  }
  return { expr, refs: state.refs };
}
