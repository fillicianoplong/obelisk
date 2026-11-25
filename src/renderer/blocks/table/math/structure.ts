import { TABLE_COLUMN_MAX, TABLE_ROW_MAX } from '../../../../shared/schema/limits.js';
import type { TableCell } from '../../../../shared/schema/types.js';
import { parseFormula, type CellRef } from './parse.js';
import type { ShiftResult, StructureChange } from './types.js';

function countOf(change: StructureChange): number | null {
  const count = change.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) {
    return null;
  }
  return count;
}

function indexOf(change: StructureChange): number | null {
  const index = change.kind === 'insert-rows' || change.kind === 'delete-rows'
    ? change.row
    : change.column;
  if (!Number.isSafeInteger(index) || index < 1) {
    return null;
  }
  return index;
}

function blank(): TableCell {
  return { kind: 'text', content: [] };
}

function letterFor(col: number, sample: string): string {
  const upper = String.fromCharCode(64 + col);
  return sample === sample.toLowerCase() ? upper.toLowerCase() : upper;
}

/** Where a reference moves. Null means the cell was deleted or passed column Z. */
function shiftRef(ref: CellRef, change: StructureChange, count: number, index: number): { col: number; row: number } | null {
  let { col, row } = ref;
  if (change.kind === 'insert-rows') {
    if (row >= index) {
      row += count;
    }
  } else if (change.kind === 'delete-rows') {
    if (row >= index && row < index + count) {
      return null;
    }
    if (row >= index + count) {
      row -= count;
    }
  } else if (change.kind === 'insert-columns') {
    if (col >= index) {
      col += count;
    }
  } else if (change.kind === 'delete-columns') {
    if (col >= index && col < index + count) {
      return null;
    }
    if (col >= index + count) {
      col -= count;
    }
  }
  if (col < 1 || col > TABLE_COLUMN_MAX || row < 1) {
    return null;
  }
  return { col, row };
}

/**
 * Rewrite A1 references inside one formula. A formula that does not parse is
 * kept as text. A reference to a deleted row or column becomes #REF!.
 */
export function rewriteFormula(source: string, change: StructureChange): string {
  const count = countOf(change);
  const index = indexOf(change);
  if (count === null || index === null) {
    return source;
  }
  const parsed = parseFormula(source);
  if (!parsed) {
    return source;
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const ref of parsed.refs) {
    const next = shiftRef(ref, change, count, index);
    const replacement = next === null ? '#REF!' : `${letterFor(next.col, ref.letters)}${next.row}`;
    if (replacement !== source.slice(ref.start, ref.end)) {
      edits.push({ start: ref.start, end: ref.end, text: replacement });
    }
  }
  edits.sort((left, right) => right.start - left.start);
  let text = source;
  for (const edit of edits) {
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  }
  return text;
}

function rectangle(rows: readonly (readonly TableCell[])[]): { height: number; width: number } | null {
  if (rows.length === 0) {
    return null;
  }
  const width = rows[0]?.length ?? 0;
  if (width === 0) {
    return null;
  }
  for (const row of rows) {
    if (row.length !== width) {
      return null;
    }
  }
  return { height: rows.length, width };
}

function rewriteGrid(rows: readonly (readonly TableCell[])[], change: StructureChange): TableCell[][] {
  return rows.map((row) => row.map((cell) => {
    if (cell.kind === 'text') {
      return { kind: 'text', content: cell.content.slice() };
    }
    return { kind: 'formula', source: rewriteFormula(cell.source, change) };
  }));
}

/**
 * Move the cells and rewrite formulas for one insert or delete.
 * The grid must stay within 200 rows and 26 columns, and must keep at least
 * one row and one column. The input grid is not changed.
 */
export function shiftTable(
  rows: readonly (readonly TableCell[])[],
  change: StructureChange,
): ShiftResult {
  const count = countOf(change);
  const index = indexOf(change);
  const size = rectangle(rows);
  if (count === null || index === null || !size) {
    return { ok: false, reason: 'out-of-range' };
  }
  const next = rewriteGrid(rows, change);
  if (change.kind === 'insert-rows') {
    if (index > size.height + 1) {
      return { ok: false, reason: 'out-of-range' };
    }
    if (size.height + count > TABLE_ROW_MAX) {
      return { ok: false, reason: 'too-big' };
    }
    const added = Array.from({ length: count }, () => Array.from({ length: size.width }, blank));
    next.splice(index - 1, 0, ...added);
    return { ok: true, rows: next };
  }
  if (change.kind === 'delete-rows') {
    if (index + count - 1 > size.height || size.height - count < 1) {
      return { ok: false, reason: 'out-of-range' };
    }
    next.splice(index - 1, count);
    return { ok: true, rows: next };
  }
  if (change.kind === 'insert-columns') {
    if (index > size.width + 1) {
      return { ok: false, reason: 'out-of-range' };
    }
    if (size.width + count > TABLE_COLUMN_MAX) {
      return { ok: false, reason: 'too-big' };
    }
    for (const row of next) {
      const added = Array.from({ length: count }, blank);
      row.splice(index - 1, 0, ...added);
    }
    return { ok: true, rows: next };
  }
  if (index + count - 1 > size.width || size.width - count < 1) {
    return { ok: false, reason: 'out-of-range' };
  }
  for (const row of next) {
    row.splice(index - 1, count);
  }
  return { ok: true, rows: next };
}
