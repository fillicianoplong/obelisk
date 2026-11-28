export const PAGELESS_WIDTHS = ['narrow', 'medium', 'wide'] as const;
export const DEFAULT_PAGELESS_WIDTH = 'medium';
export const PAGELESS_COLUMN_IN = {
  narrow: 5,
  medium: 6.5,
  wide: 7.5,
} as const;

export type PagelessWidth = (typeof PAGELESS_WIDTHS)[number];

export function pagelessWidthFromUnknown(value: unknown): PagelessWidth {
  if (typeof value === 'string' && (PAGELESS_WIDTHS as readonly string[]).includes(value)) {
    return value as PagelessWidth;
  }
  return DEFAULT_PAGELESS_WIDTH;
}

export function pagelessColumnIn(width: PagelessWidth): number {
  return PAGELESS_COLUMN_IN[width];
}

export function pagelessWidthLabel(width: PagelessWidth): string {
  if (width === 'narrow') {
    return 'Narrow';
  }
  if (width === 'wide') {
    return 'Wide';
  }
  return 'Medium';
}