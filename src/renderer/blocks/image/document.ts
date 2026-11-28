import type { JsonObject } from '../../../shared/ipc/types.js';
import type { ImageBlock } from '../../../shared/schema/types.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';

export function imagePayloadFromBlock(block: JsonObject): JsonObject {
  return {
    sha256: typeof block.sha256 === 'string' ? block.sha256 : '',
    width: typeof block.width === 'number' ? block.width : 1,
    rotation: block.rotation ?? 0,
    flipHorizontal: block.flipHorizontal === true,
    flipVertical: block.flipVertical === true,
    alt: typeof block.alt === 'string' ? block.alt : '',
  };
}

export function imageBlockFromPayload(blockId: string, payload: JsonObject): ImageBlock {
  return {
    type: 'image',
    id: blockId,
    sha256: typeof payload.sha256 === 'string' ? payload.sha256 : '',
    width: typeof payload.width === 'number' && payload.width > 0 ? payload.width : 1,
    rotation: payload.rotation === 90 || payload.rotation === 180 || payload.rotation === 270
      ? payload.rotation
      : 0,
    flipHorizontal: payload.flipHorizontal === true,
    flipVertical: payload.flipVertical === true,
    alt: typeof payload.alt === 'string' ? payload.alt : '',
  };
}

export function imagePayloadString(block: JsonObject): string {
  return stringifyPayload(imagePayloadFromBlock(block));
}

export function parseImagePayload(attrs: { blockId?: unknown; payload?: unknown }): ImageBlock | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return null;
  }
  const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : '';
  if (blockId.length === 0) {
    return null;
  }
  return imageBlockFromPayload(blockId, payload);
}