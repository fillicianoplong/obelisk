import type { TableCell } from '../../../../shared/schema/types.js';
import { formatMathValue } from './format.js';
import { parseFormula, type Expr, type ParsedFormula } from './parse.js';
import { readCell } from './text.js';
import { FORMULA_ERRORS, type EvaluatedCell, type FormulaError } from './types.js';

type ValueCell =
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'text' }
  | { kind: 'unparsed' }
  | { kind: 'error'; error: FormulaError }
  | { kind: 'pending' };

interface FormulaNode {
  row: number;
  col: number;
  source: string;
  formula: ParsedFormula;
  deps: string[];
}

type EvalResult =
  | { ok: true; value: number }
  | { ok: false; error: FormulaError };

function blankCell(): EvaluatedCell {
  return {
    display: '',
    editing: '',
    underline: false,
    error: null,
    value: null,
    blank: true,
  };
}

function literalCell(display: string, editing: string, value: number | null): EvaluatedCell {
  return {
    display,
    editing,
    underline: false,
    error: null,
    value,
    blank: false,
  };
}

function unparsedCell(source: string): EvaluatedCell {
  return {
    display: source,
    editing: source,
    underline: true,
    error: null,
    value: null,
    blank: false,
  };
}

function errorCell(source: string, error: FormulaError): EvaluatedCell {
  return {
    display: error,
    editing: source,
    underline: false,
    error,
    value: null,
    blank: false,
  };
}

function valueCell(source: string, value: number): EvaluatedCell {
  return {
    display: formatMathValue(value),
    editing: source,
    underline: false,
    error: null,
    value,
    blank: false,
  };
}

function raise(base: number, exponent: number): EvalResult {
  if (base < 0 && !Number.isInteger(exponent)) {
    return { ok: false, error: FORMULA_ERRORS.div0 };
  }
  const value = base ** exponent;
  if (!Number.isFinite(value)) {
    return { ok: false, error: FORMULA_ERRORS.div0 };
  }
  return { ok: true, value };
}

function evalExpr(expr: Expr, lookup: (col: number, row: number) => EvalResult): EvalResult {
  if (expr.type === 'num') {
    return { ok: true, value: expr.value };
  }
  if (expr.type === 'refError') {
    return { ok: false, error: FORMULA_ERRORS.ref };
  }
  if (expr.type === 'ref') {
    return lookup(expr.col, expr.row);
  }
  if (expr.type === 'unary') {
    const inner = evalExpr(expr.expr, lookup);
    if (!inner.ok) {
      return inner;
    }
    return { ok: true, value: expr.op === '-' ? -inner.value : inner.value };
  }
  const left = evalExpr(expr.left, lookup);
  if (!left.ok) {
    return left;
  }
  const right = evalExpr(expr.right, lookup);
  if (!right.ok) {
    return right;
  }
  if (expr.op === '+') {
    return { ok: true, value: left.value + right.value };
  }
  if (expr.op === '-') {
    return { ok: true, value: left.value - right.value };
  }
  if (expr.op === '*') {
    return { ok: true, value: left.value * right.value };
  }
  if (expr.op === '/') {
    if (right.value === 0) {
      return { ok: false, error: FORMULA_ERRORS.div0 };
    }
    return { ok: true, value: left.value / right.value };
  }
  return raise(left.value, right.value);
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function findCycles(nodes: Map<string, FormulaNode>): Set<string> {
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  function visit(key: string): void {
    color.set(key, 1);
    stack.push(key);
    const node = nodes.get(key);
    for (const dep of node?.deps ?? []) {
      const seen = color.get(dep) ?? 0;
      if (seen === 0) {
        visit(dep);
      } else if (seen === 1) {
        const at = stack.indexOf(dep);
        for (let index = at; index < stack.length; index += 1) {
          const cycleKey = stack[index];
          if (cycleKey !== undefined) {
            cycles.add(cycleKey);
          }
        }
      }
    }
    stack.pop();
    color.set(key, 2);
  }

  for (const key of nodes.keys()) {
    if ((color.get(key) ?? 0) === 0) {
      visit(key);
    }
  }
  return cycles;
}

function evaluationOrder(nodes: Map<string, FormulaNode>, cycles: Set<string>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  function visit(key: string): void {
    if (seen.has(key) || cycles.has(key)) {
      return;
    }
    seen.add(key);
    const node = nodes.get(key);
    for (const dep of node?.deps ?? []) {
      visit(dep);
    }
    order.push(key);
  }

  for (const key of nodes.keys()) {
    visit(key);
  }
  return order;
}

/**
 * Compute every formula in the grid. Literals are read first, then formulas
 * in dependency order. A formula that depends on itself shows #CYCLE!.
 */
export function evaluateTable(rows: readonly (readonly TableCell[])[]): EvaluatedCell[][] {
  const result: EvaluatedCell[][] = [];
  const values: ValueCell[][] = [];
  const nodes = new Map<string, FormulaNode>();

  for (const [rowIndex, row] of rows.entries()) {
    const resultRow: EvaluatedCell[] = [];
    const valueRow: ValueCell[] = [];
    for (const [colIndex, cell] of row.entries()) {
      const read = readCell(cell);
      if (read.kind === 'blank') {
        resultRow.push(blankCell());
        valueRow.push({ kind: 'blank' });
      } else if (read.kind === 'number') {
        resultRow.push(literalCell(read.text, read.text, read.value));
        valueRow.push({ kind: 'number', value: read.value });
      } else if (read.kind === 'text') {
        resultRow.push(literalCell(read.text, read.text, null));
        valueRow.push({ kind: 'text' });
      } else {
        const formula = parseFormula(read.source);
        if (!formula) {
          resultRow.push(unparsedCell(read.source));
          valueRow.push({ kind: 'unparsed' });
        } else {
          resultRow.push(unparsedCell(read.source));
          valueRow.push({ kind: 'pending' });
          nodes.set(cellKey(rowIndex, colIndex), {
            row: rowIndex,
            col: colIndex,
            source: read.source,
            formula,
            deps: [],
          });
        }
      }
    }
    result.push(resultRow);
    values.push(valueRow);
  }

  for (const node of nodes.values()) {
    const deps: string[] = [];
    for (const ref of node.formula.refs) {
      const key = cellKey(ref.row - 1, ref.col - 1);
      if (nodes.has(key) && !deps.includes(key)) {
        deps.push(key);
      }
    }
    node.deps = deps;
  }

  const cycles = findCycles(nodes);
  for (const key of cycles) {
    const node = nodes.get(key);
    if (!node) {
      continue;
    }
    result[node.row][node.col] = errorCell(node.source, FORMULA_ERRORS.cycle);
    values[node.row][node.col] = { kind: 'error', error: FORMULA_ERRORS.cycle };
  }

  function lookup(col: number, row: number): EvalResult {
    const line = values[row - 1];
    if (!line || col < 1 || col > line.length) {
      return { ok: false, error: FORMULA_ERRORS.ref };
    }
    const found = line[col - 1];
    if (!found || found.kind === 'text' || found.kind === 'unparsed') {
      return { ok: false, error: FORMULA_ERRORS.ref };
    }
    if (found.kind === 'blank') {
      return { ok: true, value: 0 };
    }
    if (found.kind === 'number') {
      return { ok: true, value: found.value };
    }
    if (found.kind === 'error') {
      return { ok: false, error: found.error };
    }
    return { ok: false, error: FORMULA_ERRORS.cycle };
  }

  for (const key of evaluationOrder(nodes, cycles)) {
    const node = nodes.get(key);
    if (!node) {
      continue;
    }
    const outcome = evalExpr(node.formula.expr, lookup);
    if (outcome.ok) {
      result[node.row][node.col] = valueCell(node.source, outcome.value);
      values[node.row][node.col] = { kind: 'number', value: outcome.value };
    } else {
      result[node.row][node.col] = errorCell(node.source, outcome.error);
      values[node.row][node.col] = { kind: 'error', error: outcome.error };
    }
  }

  return result;
}
