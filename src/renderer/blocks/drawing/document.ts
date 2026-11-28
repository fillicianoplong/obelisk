import type { JsonObject } from '../../../shared/ipc/types.js';
import type { DrawingBlock, Stroke } from '../../../shared/schema/types.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';

/** Default pad size in block pixel space (fits the letter text column at 96 dpi). */
export const DEFAULT_DRAWING_WIDTH = 624;
export const DEFAULT_DRAWING_HEIGHT = 280;

export function defaultDrawingBody(): Omit<DrawingBlock, 'id' | 'type'> {
  return {
    width: DEFAULT_DRAWING_WIDTH,
    height: DEFAULT_DRAWING_HEIGHT,
    strokes: [],
  };
}

export function drawingPayloadFromBlock(block: JsonObject): JsonObject {
  return {
    width: typeof block.width === 'number' ? block.width : DEFAULT_DRAWING_WIDTH,
    height: typeof block.height === 'number' ? block.height : DEFAULT_DRAWING_HEIGHT,
    strokes: Array.isArray(block.strokes) ? block.strokes : [],
  };
}

export function drawingBlockFromPayload(blockId: string, payload: JsonObject): DrawingBlock {
  const strokes = Array.isArray(payload.strokes) ? payload.strokes as unknown as Stroke[] : [];
  return {
    type: 'drawing',
    id: blockId,
    width: typeof payload.width === 'number' ? payload.width : DEFAULT_DRAWING_WIDTH,
    height: typeof payload.height === 'number' ? payload.height : DEFAULT_DRAWING_HEIGHT,
    strokes,
  };
}

export function drawingPayloadString(block: JsonObject): string {
  return stringifyPayload(drawingPayloadFromBlock(block));
}

export function parseDrawingPayload(attrs: { payload?: unknown; blockId?: unknown }): DrawingBlock | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return null;
  }
  const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : '';
  return drawingBlockFromPayload(blockId, payload);
}