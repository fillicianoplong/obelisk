// Cell formulas for table blocks. The Table math reference is the contract.
// This module has no DOM. The table block owns the view, the menu, and sorting.

export { evaluateTable } from './evaluate.js';
export { formatMathValue } from './format.js';
export { rewriteFormula, shiftTable } from './structure.js';
export { FORMULA_ERRORS } from './types.js';
export type { EvaluatedCell, FormulaError, ShiftResult, StructureChange } from './types.js';
