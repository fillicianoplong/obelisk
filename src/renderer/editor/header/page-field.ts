import { CSS_PX_PER_INCH, PAGE_HEADER_OFFSET_IN } from '../layout/page.js';

export type PageFieldKind = 'page' | 'pages';
export type PageFieldFormat = 'decimal' | 'roman' | 'page-of-n';

const ROMAN: readonly [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

export function romanNumeral(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  let text = '';
  for (const [amount, glyph] of ROMAN) {
    while (remaining >= amount) {
      text += glyph;
      remaining -= amount;
    }
  }
  return text;
}

export function pageFieldText(
  kind: PageFieldKind,
  format: PageFieldFormat,
  page: number,
  total: number,
): string {
  const pages = Math.max(1, Math.floor(total));
  const current = Math.min(pages, Math.max(1, Math.floor(page)));
  if (kind === 'pages') {
    return String(pages);
  }
  if (format === 'roman') {
    return romanNumeral(current);
  }
  if (format === 'page-of-n') {
    return `Page ${current} of ${pages}`;
  }
  return String(current);
}

// An empty band reserves nothing. A line reserves 0.5 in plus its own height,
// and the body starts at whichever is larger, the margin or that line.
export function reservedMarginIn(marginIn: number, contentPx: number, zoomPercent: number): number {
  if (!Number.isFinite(contentPx) || contentPx <= 1) {
    return marginIn;
  }
  const factor = Number.isFinite(zoomPercent) && zoomPercent > 0 ? zoomPercent / 100 : 1;
  const contentIn = contentPx / (CSS_PX_PER_INCH * factor);
  return Math.max(marginIn, PAGE_HEADER_OFFSET_IN + contentIn);
}
