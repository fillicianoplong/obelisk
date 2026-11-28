import type { JsonObject } from '../../../shared/ipc/types.js';
import { parsePayload } from '../structured/payload.js';

export interface FormulaBlockPayload {
  latex: string;
}

export function defaultFormulaLatex(): string {
  return 'x';
}

export function formulaPayloadFromBlock(block: JsonObject): FormulaBlockPayload {
  return {
    latex: typeof block.latex === 'string' ? block.latex : defaultFormulaLatex(),
  };
}

export function parseFormulaPayload(attrs: Record<string, unknown>): FormulaBlockPayload | null {
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return { latex: defaultFormulaLatex() };
  }
  const latex = typeof payload.latex === 'string' ? payload.latex : defaultFormulaLatex();
  return { latex };
}

export function formulaPayloadString(block: JsonObject): string {
  return JSON.stringify(formulaPayloadFromBlock(block));
}