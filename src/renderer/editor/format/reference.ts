import { DEFAULT_FONT_SIZE_PT, FONT_SIZES_PT } from '../../../shared/schema/limits.js';

export const DEFAULT_FONT_FAMILY = 'Liberation Serif';

export const FONT_SIZE_PT = FONT_SIZES_PT;

export const DEFAULT_FONT_SIZE = DEFAULT_FONT_SIZE_PT;

/** Default colors when the user picks Text color or Highlight from the menu. */
export const DEFAULT_TEXT_COLOR = '#B3261E';
export const DEFAULT_HIGHLIGHT_COLOR = '#F3E3A1';

export const BUNDLED_FONT_FAMILIES: readonly string[] = [
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
];

const FONT_BY_MENU_ID: Record<string, string> = {
  'format-font-liberation-serif': 'Liberation Serif',
  'format-font-liberation-sans': 'Liberation Sans',
  'format-font-liberation-mono': 'Liberation Mono',
  'format-font-caladea': 'Caladea',
  'format-font-carlito': 'Carlito',
  'format-font-dejavu-serif': 'DejaVu Serif',
  'format-font-dejavu-sans': 'DejaVu Sans',
  'format-font-dejavu-mono': 'DejaVu Sans Mono',
  'format-font-libertine': 'Linux Libertine G',
  'format-font-biolinum': 'Linux Biolinum G',
  'format-font-noto-serif': 'Noto Serif',
  'format-font-noto-sans': 'Noto Sans',
  'format-font-dancing': 'Dancing Script',
};

export function fontFamilyFromMenuId(menuId: string): string | null {
  return FONT_BY_MENU_ID[menuId] ?? null;
}

export function fontSizeFromMenuId(menuId: string): number | null {
  const match = /^format-size-(\d+)$/.exec(menuId);
  if (match === null) {
    return null;
  }
  const size = Number(match[1]);
  return (FONT_SIZE_PT as readonly number[]).includes(size) ? size : null;
}
