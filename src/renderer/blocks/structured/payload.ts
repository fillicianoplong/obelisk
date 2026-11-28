import type { JsonObject } from '../../../shared/ipc/types.js';

/** JSON stored on structured_block nodes for block types that are not plain ProseMirror text. */
export function stringifyPayload(payload: JsonObject): string {
  return JSON.stringify(payload);
}

export function parsePayload(raw: unknown): JsonObject | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    return null;
  }
  return null;
}

export function payloadEqual(left: JsonObject | null, right: JsonObject | null): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}