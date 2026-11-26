import type { TableCell } from '../../../../shared/schema/types.js';

/** Errors a formula cell can show. The spellings are the Table math reference. */
export const FORMULA_ERRORS = {
  div0: '#DIV/0!',
  ref: '#REF!',
  cycle: '#CYCLE!',
} as const;

export type FormulaError = (typeof FORMULA_ERRORS)[keyof typeof FORMULA_ERRORS];

/**
 * One cell after formulas are computed.
 * `editing` is the formula while the cell is edited; `display` is the value
 * otherwise. A formula that does not parse keeps its text and sets `underline`.
 */
export interface EvaluatedCell {
  display: string;
  editing: string;
  underline: boolean;
  error: FormulaError | null;
  /** Literal number or a formula that produced a number. Blank is null, not 0. */
  value: number | null;
  /** Empty text cell. A formula that reads it counts it as 0. */
  blank: boolean;
}

/** A row or column insert or delete. Indexes are 1-based, matching A1. */
export type StructureChange =
  | { kind: 'insert-rows'; row: number; count?: number }
  | { kind: 'delete-rows'; row: number; count?: number }
  | { kind: 'insert-columns'; column: number; count?: number }
  | { kind: 'delete-columns'; column: number; count?: number };

export type ShiftResult =
  | { ok: true; rows: TableCell[][] }
  | { ok: false; reason: 'out-of-range' | 'too-big' };
