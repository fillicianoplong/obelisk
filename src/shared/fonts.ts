/** Bundled text fonts (SRS Fonts reference). Settings and the Format menu share this list. */
export const BUNDLED_FONT_FAMILIES = [
  'Liberation Serif',
  'Liberation Sans',
  'Liberation Mono',
  'Caladea',
  'Carlito',
  'DejaVu Serif',
  'DejaVu Sans',
  'DejaVu Sans Mono',
  'Linux Libertine G',
  'Linux Biolinum G',
  'Noto Serif',
  'Noto Sans',
  'Dancing Script',
] as const;

const BUNDLED_FONT_SET: ReadonlySet<string> = new Set(BUNDLED_FONT_FAMILIES);

export function isBundledFontFamily(value: string): boolean {
  return BUNDLED_FONT_SET.has(value);
}