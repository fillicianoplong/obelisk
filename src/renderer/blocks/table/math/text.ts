import type { TableCell } from '../../../../shared/schema/types.js';

/** Digits, or digits plus a fraction. Sign is separate. No thousands separators. */
const CELL_NUMBER = /^[+-]?(?:\d+\.\d+|\d+)$/;

export type ReadCell =
  | { kind: 'blank' }
  | { kind: 'number'; value: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'formula'; source: string };

function trimEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === ' ' || text[start] === '\t')) {
    start += 1;
  }
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
    end -= 1;
  }
  return text.slice(start, end);
}

/**
 * A text cell is a number only when its text and link runs are one decimal
 * number. A date chip or an inline equation makes the cell text. Whitespace
 * alone is empty, which formulas count as 0.
 */
export function readCell(cell: TableCell): ReadCell {
  if (cell.kind === 'formula') {
    return { kind: 'formula', source: cell.source };
  }
  let text = '';
  let literal = true;
  for (const item of cell.content) {
    if (item.type === 'text' || item.type === 'link') {
      text += item.text;
    } else {
      literal = false;
    }
  }
  if (!literal) {
    return { kind: 'text', text };
  }
  const trimmed = trimEdges(text);
  if (trimmed === '') {
    return { kind: 'blank' };
  }
  if (CELL_NUMBER.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return { kind: 'number', value, text };
    }
  }
  return { kind: 'text', text };
}
