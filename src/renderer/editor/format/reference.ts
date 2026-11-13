import {
  ALIGNMENTS,
  DEFAULT_FONT_SIZE_PT,
  FONT_SIZES_PT,
  INDENT_FIRST_MAX_IN,
  INDENT_HANGING_MAX_IN,
  INDENT_LEFT_MAX_IN,
  INDENT_LEFT_MIN_IN,
  INDENT_STEP_IN,
  LINE_SPACINGS,
  SPACE_BEFORE_AFTER_PT,
} from '../../../shared/schema/limits.js';

export const DEFAULT_FONT_FAMILY = 'Liberation Serif';

export { ALIGNMENTS, INDENT_LEFT_MAX_IN, INDENT_LEFT_MIN_IN, INDENT_STEP_IN, LINE_SPACINGS, SPACE_BEFORE_AFTER_PT };

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

export function stepIndentInches(
  current: number,
  deltaSteps: number,
  min = INDENT_LEFT_MIN_IN,
  max = INDENT_LEFT_MAX_IN,
): number {
  const steps = Math.round(current / INDENT_STEP_IN);
  const nextSteps = Math.max(Math.round(min / INDENT_STEP_IN), Math.min(Math.round(max / INDENT_STEP_IN), steps + deltaSteps));
  return nextSteps * INDENT_STEP_IN;
}

function indentFromMenuId(
  menuId: string,
  prefix: string,
  min: number,
  max: number,
): number | null {
  const match = new RegExp(`^${prefix}-(\\d+(?:-\\d+)?)$`).exec(menuId);
  if (match === null) {
    return null;
  }
  const inches = Number(match[1].replace('-', '.'));
  if (!Number.isFinite(inches) || inches < min || inches > max) {
    return null;
  }
  const steps = inches / INDENT_STEP_IN;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    return null;
  }
  return inches;
}

export function alignmentFromMenuId(menuId: string): (typeof ALIGNMENTS)[number] | null {
  const map: Record<string, (typeof ALIGNMENTS)[number]> = {
    'format-align-left': 'left',
    'format-align-center': 'center',
    'format-align-right': 'right',
    'format-align-justify': 'justify',
  };
  return map[menuId] ?? null;
}

export function lineSpacingFromMenuId(menuId: string): (typeof LINE_SPACINGS)[number] | null {
  const map: Record<string, (typeof LINE_SPACINGS)[number]> = {
    'format-line-single': 'single',
    'format-line-115': '1.15',
    'format-line-150': '1.5',
    'format-line-double': 'double',
  };
  return map[menuId] ?? null;
}

export function spaceBeforeFromMenuId(menuId: string): (typeof SPACE_BEFORE_AFTER_PT)[number] | null {
  const match = /^format-space-before-(\d+)$/.exec(menuId);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return (SPACE_BEFORE_AFTER_PT as readonly number[]).includes(value) ? value as (typeof SPACE_BEFORE_AFTER_PT)[number] : null;
}

export function spaceAfterFromMenuId(menuId: string): (typeof SPACE_BEFORE_AFTER_PT)[number] | null {
  const match = /^format-space-after-(\d+)$/.exec(menuId);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return (SPACE_BEFORE_AFTER_PT as readonly number[]).includes(value) ? value as (typeof SPACE_BEFORE_AFTER_PT)[number] : null;
}

export function leftIndentFromMenuId(menuId: string): number | null {
  return indentFromMenuId(menuId, 'format-indent-left', INDENT_LEFT_MIN_IN, INDENT_LEFT_MAX_IN);
}

export function firstLineIndentFromMenuId(menuId: string): number | null {
  return indentFromMenuId(menuId, 'format-indent-first', INDENT_LEFT_MIN_IN, INDENT_FIRST_MAX_IN);
}

export function hangingIndentFromMenuId(menuId: string): number | null {
  return indentFromMenuId(menuId, 'format-indent-hanging', INDENT_LEFT_MIN_IN, INDENT_HANGING_MAX_IN);
}
