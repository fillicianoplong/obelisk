import { OBELISK_BLOCKS_MIME } from '../../shared/clipboard.js';
import type { Block } from '../../shared/schema/types.js';
import { isBlockId } from '../editor/block-id.js';
import type { JsonObject } from '../../shared/ipc/types.js';
import { newBlockId } from '../editor/block-id.js';
import { cloneBlockWithNewId } from '../editor/schema/mapping.js';

export { OBELISK_BLOCKS_MIME };

export interface ObeliskClipboardPayload {
  format: 'obelisk';
  formatVersion: 1;
  blocks: JsonObject[];
}

function blockShapeOk(block: JsonObject): boolean {
  return typeof block.type === 'string'
    && typeof block.id === 'string'
    && isBlockId(block.id);
}

export function serializeObeliskClipboard(blocks: readonly JsonObject[]): string {
  const payload: ObeliskClipboardPayload = {
    format: 'obelisk',
    formatVersion: 1,
    blocks: blocks.map((block) => structuredClone(block) as JsonObject),
  };
  return JSON.stringify(payload);
}

function isBlockRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseObeliskClipboard(raw: string): JsonObject[] | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as ObeliskClipboardPayload;
  if (record.format !== 'obelisk' || record.formatVersion !== 1 || !Array.isArray(record.blocks)) {
    return null;
  }
  if (!record.blocks.every((block) => isBlockRecord(block) && blockShapeOk(block))) {
    return null;
  }
  return record.blocks;
}

export function remintObeliskBlocks(blocks: readonly JsonObject[], mint: () => string = newBlockId): Block[] {
  return blocks.map((block) => cloneBlockWithNewId(block, mint) as unknown as Block);
}