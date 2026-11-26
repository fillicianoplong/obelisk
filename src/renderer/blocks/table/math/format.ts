import { FORMULA_ERRORS } from './types.js';

const DISPLAY_DECIMALS = 10;

/**
 * A computed value, up to 10 decimal places. Trailing zeros are dropped.
 * Rounding is the same half-up step `toFixed` uses. Negative zero is 0.
 */
export function formatMathValue(value: number): string {
  if (!Number.isFinite(value)) {
    return FORMULA_ERRORS.div0;
  }
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(DISPLAY_DECIMALS);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  if (trimmed === '0') {
    return '0';
  }
  return negative ? `-${trimmed}` : trimmed;
}
