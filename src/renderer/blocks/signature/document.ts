import type { JsonObject } from '../../../shared/ipc/types.js';
import type { SignatureBlock } from '../../../shared/schema/types.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import { SIGNATURE_WIDTH_MAX_IN, SIGNATURE_WIDTH_MIN_IN } from '../../../shared/schema/limits.js';

export const DEFAULT_SIGNATURE_WIDTH = 2.5;

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIGNATURE_WIDTH;
  }
  return Math.min(SIGNATURE_WIDTH_MAX_IN, Math.max(SIGNATURE_WIDTH_MIN_IN, width));
}

export function parseSignaturePayload(attrs: Record<string, unknown>): SignatureBlock | null {
  const parsed = parsePayload(attrs.payload);
  if (parsed === null) {
    return null;
  }
  if (parsed.type !== 'signature') {
    return null;
  }
  const id = typeof attrs.blockId === 'string' && attrs.blockId.length > 0
    ? attrs.blockId
    : typeof parsed.id === 'string' ? parsed.id : '';
  const align = parsed.align === 'center' || parsed.align === 'right' ? parsed.align : 'left';
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels.filter((line): line is string => typeof line === 'string').slice(0, 2)
    : [];
  return {
    type: 'signature',
    id,
    sha256: typeof parsed.sha256 === 'string' ? parsed.sha256 : '',
    line: parsed.line === true,
    width: clampWidth(typeof parsed.width === 'number' ? parsed.width : DEFAULT_SIGNATURE_WIDTH),
    labels,
    align,
    blank: parsed.blank === true,
  };
}

export function signaturePayloadFromBlock(block: SignatureBlock): JsonObject {
  return {
    type: 'signature',
    id: block.id,
    sha256: block.sha256,
    line: block.line,
    width: block.width,
    labels: block.labels,
    align: block.align,
    blank: block.blank,
  };
}

export function signaturePayloadString(block: JsonObject): string {
  return stringifyPayload(block);
}