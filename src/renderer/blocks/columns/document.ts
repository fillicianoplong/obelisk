import type { JsonObject } from '../../../shared/ipc/types.js';
import type { Column, ColumnsBlock, NestedBlock, ParagraphBlock } from '../../../shared/schema/types.js';
import { COLUMN_MAX, COLUMN_MIN } from '../../../shared/schema/limits.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';

export function evenShares(count: number): number[] {
  const clamped = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, count));
  const each = Math.round((1 / clamped) * 1000) / 1000;
  return Array.from({ length: clamped }, () => each);
}

export function emptyParagraph(id = ''): ParagraphBlock {
  return {
    type: 'paragraph',
    id,
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [],
  };
}

export function defaultColumnsBody(columnCount = 2): Omit<ColumnsBlock, 'id' | 'type'> {
  const count = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, columnCount));
  const columns: Column[] = Array.from({ length: count }, () => ({
    share: 0,
    blocks: [emptyParagraph()],
  }));
  const shares = evenShares(count);
  for (let index = 0; index < count; index += 1) {
    columns[index]!.share = shares[index] ?? 0.5;
  }
  return { columns };
}

export function columnsPayloadFromBlock(block: JsonObject): JsonObject {
  return {
    columns: Array.isArray(block.columns) ? block.columns : [],
  };
}

export function columnsBlockFromPayload(blockId: string, payload: JsonObject): ColumnsBlock {
  const raw = Array.isArray(payload.columns) ? payload.columns : [];
  const columns: Column[] = raw.map((entry) => {
    const record = entry as JsonObject;
    const share = typeof record.share === 'number' ? record.share : 0.5;
    const blocks = Array.isArray(record.blocks) ? record.blocks as unknown as NestedBlock[] : [];
    return { share, blocks: blocks.length > 0 ? blocks : [emptyParagraph()] };
  });
  return { type: 'columns', id: blockId, columns };
}

export function columnsPayloadString(block: JsonObject): string {
  return stringifyPayload(columnsPayloadFromBlock(block));
}

export function parseColumnsPayload(attrs: { payload?: unknown; blockId?: unknown }): ColumnsBlock | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return null;
  }
  const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : '';
  return columnsBlockFromPayload(blockId, payload);
}