import type { JsonObject } from '../../../shared/ipc/types.js';
import { parsePayload } from '../structured/payload.js';

export interface DiagramBlockPayload {
  source: string;
}

export function defaultDiagramSource(): string {
  return '';
}

export function diagramPayloadFromBlock(block: JsonObject): DiagramBlockPayload {
  return {
    source: typeof block.source === 'string' ? block.source : defaultDiagramSource(),
  };
}

export function parseDiagramPayload(attrs: Record<string, unknown>): DiagramBlockPayload | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return { source: defaultDiagramSource() };
  }
  const source = typeof payload.source === 'string' ? payload.source : defaultDiagramSource();
  return { source };
}

export function diagramPayloadString(block: JsonObject): string {
  return JSON.stringify(diagramPayloadFromBlock(block));
}