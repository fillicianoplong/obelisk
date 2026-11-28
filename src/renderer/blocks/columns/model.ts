import type { JsonObject } from '../../../shared/ipc/types.js';
import type { Column, ColumnsBlock, NestedBlock } from '../../../shared/schema/types.js';
import {
  COLUMN_MAX,
  COLUMN_MIN,
  COLUMN_SHARE_MIN,
  COLUMN_SHARE_SUM_TOLERANCE,
} from '../../../shared/schema/limits.js';
import { emptyParagraph, evenShares } from './document.js';

const FORBIDDEN_NESTED = new Set(['columns', 'pageBreak']);

export function canNestBlock(block: NestedBlock): boolean {
  return !FORBIDDEN_NESTED.has(block.type);
}

export function normalizeShares(columns: Column[]): Column[] {
  const sum = columns.reduce((total, column) => total + column.share, 0);
  if (sum <= 0) {
    const shares = evenShares(columns.length);
    return columns.map((column, index) => ({ ...column, share: shares[index] ?? 0.5 }));
  }
  if (Math.abs(sum - 1) <= COLUMN_SHARE_SUM_TOLERANCE) {
    return columns;
  }
  return columns.map((column) => ({ ...column, share: column.share / sum }));
}

export function clampShares(columns: Column[]): Column[] {
  let next = columns.map((column) => ({
    ...column,
    share: Math.max(COLUMN_SHARE_MIN, column.share),
  }));
  next = normalizeShares(next);
  for (let pass = 0; pass < 8; pass += 1) {
    const offender = next.find((column) => column.share < COLUMN_SHARE_MIN - 1e-6);
    if (offender === undefined) {
      break;
    }
    offender.share = COLUMN_SHARE_MIN;
    const others = next.filter((column) => column !== offender);
    const pool = 1 - COLUMN_SHARE_MIN;
    const otherSum = others.reduce((total, column) => total + column.share, 0);
    if (otherSum <= 0) {
      const shares = evenShares(next.length);
      return next.map((column, index) => ({ ...column, share: shares[index] ?? 0.5 }));
    }
    for (const column of others) {
      column.share = (column.share / otherSum) * pool;
    }
  }
  return normalizeShares(next);
}

export function setEvenWidths(columns: ColumnsBlock): ColumnsBlock {
  const shares = evenShares(columns.columns.length);
  return {
    ...columns,
    columns: columns.columns.map((column, index) => ({
      ...column,
      share: shares[index] ?? column.share,
    })),
  };
}

export function addColumn(columns: ColumnsBlock): ColumnsBlock | null {
  if (columns.columns.length >= COLUMN_MAX) {
    return null;
  }
  const count = columns.columns.length + 1;
  const shares = evenShares(count);
  return {
    ...columns,
    columns: [
      ...columns.columns.map((column, index) => ({ ...column, share: shares[index] ?? column.share })),
      { share: shares[count - 1] ?? 0.25, blocks: [emptyParagraph()] },
    ],
  };
}

export function removeColumn(columns: ColumnsBlock, columnIndex: number): ColumnsBlock | null {
  if (columns.columns.length <= COLUMN_MIN) {
    return null;
  }
  const nextColumns = columns.columns.filter((_, index) => index !== columnIndex);
  const shares = evenShares(nextColumns.length);
  return {
    ...columns,
    columns: nextColumns.map((column, index) => ({ ...column, share: shares[index] ?? column.share })),
  };
}

export function resizePair(
  columns: ColumnsBlock,
  leftIndex: number,
  leftShare: number,
  rightShare: number,
): ColumnsBlock | null {
  if (leftIndex < 0 || leftIndex >= columns.columns.length - 1) {
    return null;
  }
  if (leftShare < COLUMN_SHARE_MIN || rightShare < COLUMN_SHARE_MIN) {
    return null;
  }
  const next = columns.columns.map((column) => ({
    ...column,
    blocks: column.blocks.slice(),
  }));
  next[leftIndex]!.share = leftShare;
  next[leftIndex + 1]!.share = rightShare;
  return { ...columns, columns: clampShares(next) };
}

export function insertNestedBlock(
  columns: ColumnsBlock,
  columnIndex: number,
  blockIndex: number,
  block: NestedBlock,
): ColumnsBlock | null {
  if (!canNestBlock(block)) {
    return null;
  }
  if (columnIndex < 0 || columnIndex >= columns.columns.length) {
    return null;
  }
  const next = columns.columns.map((column) => ({
    ...column,
    blocks: column.blocks.slice(),
  }));
  const column = next[columnIndex];
  if (column === undefined) {
    return null;
  }
  const at = Math.max(0, Math.min(blockIndex, column.blocks.length));
  column.blocks.splice(at, 0, block);
  return { ...columns, columns: next };
}

export function removeNestedBlock(
  columns: ColumnsBlock,
  columnIndex: number,
  blockIndex: number,
): ColumnsBlock | null {
  const next = columns.columns.map((column) => ({
    ...column,
    blocks: column.blocks.slice(),
  }));
  const column = next[columnIndex];
  if (column === undefined || blockIndex < 0 || blockIndex >= column.blocks.length) {
    return null;
  }
  column.blocks.splice(blockIndex, 1);
  if (column.blocks.length === 0) {
    column.blocks.push(emptyParagraph());
  }
  return { ...columns, columns: next };
}

export function moveNestedBetweenColumns(
  columns: ColumnsBlock,
  fromColumn: number,
  fromIndex: number,
  toColumn: number,
  toIndex: number,
): ColumnsBlock | null {
  const next = columns.columns.map((column) => ({
    ...column,
    blocks: column.blocks.slice(),
  }));
  const source = next[fromColumn];
  const target = next[toColumn];
  if (source === undefined || target === undefined) {
    return null;
  }
  if (fromIndex < 0 || fromIndex >= source.blocks.length) {
    return null;
  }
  const [block] = source.blocks.splice(fromIndex, 1);
  if (block === undefined) {
    return null;
  }
  if (source.blocks.length === 0) {
    source.blocks.push(emptyParagraph());
  }
  const at = Math.max(0, Math.min(toIndex, target.blocks.length));
  target.blocks.splice(at, 0, block);
  return { ...columns, columns: next };
}

export function unsplitToSingleBlock(columns: ColumnsBlock): NestedBlock | null {
  const flat = columns.columns.flatMap((column) => column.blocks);
  if (flat.length !== 1) {
    return null;
  }
  return flat[0] ?? null;
}

export function nestedBlockFromTopLevelJson(block: JsonObject): NestedBlock | null {
  const type = block.type;
  if (typeof type !== 'string' || FORBIDDEN_NESTED.has(type)) {
    return null;
  }
  if (type === 'columns') {
    return null;
  }
  const id = typeof block.id === 'string' ? block.id : '';
  const clone = { ...block, id } as NestedBlock;
  return canNestBlock(clone) ? clone : null;
}

export function columnCountForInsert(requested?: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return COLUMN_MIN;
  }
  return Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.floor(requested)));
}