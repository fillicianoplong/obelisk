import type { TableCell, TableRow } from '../../../shared/schema/types.js';
import { evaluateTable } from './math/index.js';
import { readCell } from './math/text.js';
import { rowsAsGrid, gridToRows } from './document.js';

function sortKey(cell: TableCell, evaluated: { display: string; value: number | null }): string | number {
  if (cell.kind === 'formula') {
    if (evaluated.value !== null && Number.isFinite(evaluated.value)) {
      return evaluated.value;
    }
    return evaluated.display.toLowerCase();
  }
  const read = readCell(cell);
  if (read.kind === 'number') {
    return read.value;
  }
  if (read.kind === 'blank') {
    return '';
  }
  if (read.kind === 'text') {
    return read.text.toLowerCase();
  }
  return read.source.toLowerCase();
}

function compareValues(
  left: string | number,
  right: string | number,
  ascending: boolean,
): number {
  const flip = ascending ? 1 : -1;
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * flip;
  }
  if (typeof left === 'number') {
    return -1 * flip;
  }
  if (typeof right === 'number') {
    return 1 * flip;
  }
  const cmp = String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });
  return cmp * flip;
}

/** Sort body rows by a column. Row 1 stays when headerRow is true. */
export function sortTableRows(
  rows: TableRow[],
  headerRow: boolean,
  columnIndex: number,
  ascending: boolean,
): TableRow[] {
  if (columnIndex < 0) {
    return rows;
  }
  const grid = rowsAsGrid(rows);
  const evaluated = evaluateTable(grid);
  const start = headerRow ? 1 : 0;
  if (start >= grid.length) {
    return rows;
  }
  const head = grid.slice(0, start);
  const body = grid.slice(start);
  const keys = body.map((row, rowOffset) => {
    const col = columnIndex;
    const cell = row[col] ?? { kind: 'text', content: [] };
    const ev = evaluated[start + rowOffset]?.[col] ?? { display: '', value: null };
    return sortKey(cell, ev);
  });
  const order = body.map((_, index) => index);
  order.sort((left, right) => compareValues(keys[left]!, keys[right]!, ascending));
  const sorted = order.map((index) => body[index]!);
  return gridToRows([...head, ...sorted]);
}