import { TABLE_COLUMN_MAX, TABLE_ROW_MAX } from '../../../shared/schema/limits.js';
import type { TableBlock } from '../../../shared/schema/types.js';
import { shiftTable } from './math/index.js';
import type { StructureChange } from './math/types.js';
import { columnWidthsForCount, gridToRows, rowsAsGrid } from './document.js';
import { sortTableRows } from './sort.js';

function columnWidthInsert(widths: number[], index: number, count: number): number[] {
  const next = widths.slice();
  const sample = widths[Math.max(0, Math.min(index, widths.length - 1))] ?? 1;
  next.splice(index, 0, ...Array.from({ length: count }, () => sample));
  return next;
}

function columnWidthDelete(widths: number[], index: number, count: number): number[] {
  const next = widths.slice();
  next.splice(index, count);
  return next;
}

export function applyStructureChange(
  table: TableBlock,
  change: StructureChange,
): TableBlock | null {
  const grid = rowsAsGrid(table.rows);
  const shifted = shiftTable(grid, change);
  if (!shifted.ok) {
    return null;
  }
  let columnWidths = table.columnWidths;
  if (change.kind === 'insert-columns') {
    const count = change.count ?? 1;
    columnWidths = columnWidthInsert(columnWidths, change.column - 1, count);
  } else if (change.kind === 'delete-columns') {
    const count = change.count ?? 1;
    columnWidths = columnWidthDelete(columnWidths, change.column - 1, count);
  } else if (columnWidths.length === 0) {
    columnWidths = columnWidthsForCount(shifted.rows[0]?.length ?? 1);
  }
  return {
    ...table,
    columnWidths,
    rows: gridToRows(shifted.rows),
  };
}

export function toggleHeaderRow(table: TableBlock): TableBlock {
  return { ...table, headerRow: !table.headerRow };
}

export function sortTable(
  table: TableBlock,
  columnIndex: number,
  ascending: boolean,
): TableBlock {
  return {
    ...table,
    rows: sortTableRows(table.rows, table.headerRow, columnIndex, ascending),
  };
}

export function setCellText(
  table: TableBlock,
  row: number,
  col: number,
  text: string,
): TableBlock | null {
  if (row < 0 || col < 0 || row >= table.rows.length) {
    return null;
  }
  const rowData = table.rows[row];
  if (!rowData || col >= rowData.cells.length) {
    return null;
  }
  const next = structuredClone(table) as TableBlock;
  const trimmed = text;
  if (trimmed.startsWith('=')) {
    next.rows[row]!.cells[col] = { kind: 'formula', source: trimmed };
  } else if (trimmed.length === 0) {
    next.rows[row]!.cells[col] = { kind: 'text', content: [] };
  } else {
    next.rows[row]!.cells[col] = { kind: 'text', content: [{ type: 'text', text: trimmed }] };
  }
  return next;
}

export function tableDimensions(table: TableBlock): { rows: number; cols: number } {
  const rows = table.rows.length;
  const cols = table.rows[0]?.cells.length ?? table.columnWidths.length;
  return { rows, cols };
}

export function canGrowRows(table: TableBlock, count = 1): boolean {
  return table.rows.length + count <= TABLE_ROW_MAX;
}

export function canGrowColumns(table: TableBlock, count = 1): boolean {
  const cols = table.rows[0]?.cells.length ?? table.columnWidths.length;
  return cols + count <= TABLE_COLUMN_MAX;
}