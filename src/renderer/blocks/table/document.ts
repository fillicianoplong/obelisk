import type { JsonObject } from '../../../shared/ipc/types.js';
import type { TableBlock, TableCell, TableRow } from '../../../shared/schema/types.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';

const TEXT_AREA_IN = 6.5;

export function columnWidthsForCount(count: number): number[] {
  const each = Math.round((TEXT_AREA_IN / count) * 1000) / 1000;
  const width = each > 0 && each <= 11 ? each : 1;
  return Array.from({ length: count }, () => width);
}

function blankCell(): TableCell {
  return { kind: 'text', content: [] };
}

function blankRow(columns: number): TableRow {
  return { cells: Array.from({ length: columns }, blankCell) };
}

/** Default insert: 3 columns × 4 rows with a header row (FR-45). */
export function defaultTableBody(): Omit<TableBlock, 'id' | 'type'> {
  const columns = 3;
  const rowCount = 4;
  return {
    headerRow: true,
    columnWidths: columnWidthsForCount(columns),
    rows: Array.from({ length: rowCount }, () => blankRow(columns)),
  };
}

export function tablePayloadFromBlock(block: JsonObject): JsonObject {
  return {
    headerRow: block.headerRow === true,
    columnWidths: Array.isArray(block.columnWidths) ? block.columnWidths : [],
    rows: Array.isArray(block.rows) ? block.rows : [],
  };
}

export function tableBlockFromPayload(blockId: string, payload: JsonObject): TableBlock {
  return {
    type: 'table',
    id: blockId,
    headerRow: payload.headerRow === true,
    columnWidths: Array.isArray(payload.columnWidths)
      ? payload.columnWidths.filter((value): value is number => typeof value === 'number')
      : [],
    rows: Array.isArray(payload.rows) ? payload.rows as unknown as TableRow[] : [],
  };
}

export function tablePayloadString(block: JsonObject): string {
  return stringifyPayload(tablePayloadFromBlock(block));
}

export function rowsAsGrid(rows: TableRow[]): TableCell[][] {
  return rows.map((row) => (Array.isArray(row.cells) ? row.cells.slice() : []));
}

export function gridToRows(grid: TableCell[][]): TableRow[] {
  return grid.map((cells) => ({ cells: cells.map((cell) => (
    cell.kind === 'formula'
      ? { kind: 'formula' as const, source: cell.source }
      : { kind: 'text' as const, content: cell.kind === 'text' ? cell.content.slice() : [] }
  )) }));
}

export function parseTablePayload(attrs: { payload?: unknown }): TableBlock | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return null;
  }
  const blockId = typeof (attrs as { blockId?: unknown }).blockId === 'string'
    ? (attrs as { blockId: string }).blockId
    : '';
  return tableBlockFromPayload(blockId, payload);
}