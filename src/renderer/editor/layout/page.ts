// Letter page geometry. The running sizes are the page tokens.
// CSS treats 1 in as 96 px, so 8.5 in is 816 px at 100% zoom.

export const CSS_PX_PER_INCH = 96;

export const PAGE_WIDTH_IN = 8.5;
export const PAGE_HEIGHT_IN = 11;
export const PAGE_MARGIN_IN = 1;
export const PAGE_HEADER_OFFSET_IN = 0.5;
export const PAGE_GAP_PX = 24;

export const PAGE_FONT_FAMILY = 'Liberation Serif';
export const PAGE_FONT_SIZE = '12pt';

export const PAGE_WIDTH_TOKEN = '--page-width';
export const PAGE_HEIGHT_TOKEN = '--page-height';
export const PAGE_MARGIN_TOKEN = '--page-margin';
export const PAGE_HEADER_OFFSET_TOKEN = '--page-header-offset';
export const PAGE_GAP_TOKEN = '--page-gap';
export const PAGE_FONT_TOKEN = '--font-page';
export const PAGE_FONT_SIZE_TOKEN = '--font-size-page';

export const PAGE_FONT_FILES = [
  'LiberationSerif-Regular.ttf',
  'LiberationSerif-Bold.ttf',
  'LiberationSerif-Italic.ttf',
  'LiberationSerif-BoldItalic.ttf',
] as const;

export const PAGE_FONT_LICENSE = 'OFL.txt';

export function cssInches(inches: number): string {
  return `${inches}in`;
}

export function cssPixelsAt96Dpi(inches: number): number {
  return inches * CSS_PX_PER_INCH;
}

export interface PageFrameStyle {
  width: string;
  height: string;
  minWidth: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
}

export function pageFrameStyle(): PageFrameStyle {
  return {
    width: `var(${PAGE_WIDTH_TOKEN})`,
    height: `var(${PAGE_HEIGHT_TOKEN})`,
    minWidth: `var(${PAGE_WIDTH_TOKEN})`,
    minHeight: `var(${PAGE_HEIGHT_TOKEN})`,
    maxWidth: `var(${PAGE_WIDTH_TOKEN})`,
    maxHeight: `var(${PAGE_HEIGHT_TOKEN})`,
  };
}

// The header starts 0.5 in from the top edge. The body margin is 1 in,
// so this empty band is the space between those two, in line with the side margins.
export interface PageHeaderStyle {
  top: string;
  height: string;
  left: string;
  right: string;
}

export function pageHeaderStyle(): PageHeaderStyle {
  return {
    top: `var(${PAGE_HEADER_OFFSET_TOKEN})`,
    height: `calc(var(${PAGE_MARGIN_TOKEN}) - var(${PAGE_HEADER_OFFSET_TOKEN}))`,
    left: `var(${PAGE_MARGIN_TOKEN})`,
    right: `var(${PAGE_MARGIN_TOKEN})`,
  };
}
