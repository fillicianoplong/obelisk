export const CONTRAST_CAPTION_BACKGROUND = '3d-face';
export const CONTRAST_CAPTION_SYMBOL = 'button-text';

export type ContrastCaptionName = typeof CONTRAST_CAPTION_BACKGROUND | typeof CONTRAST_CAPTION_SYMBOL;

export interface ContrastCaptionColors {
  background: string;
  symbol: string;
}

const HEX = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:1|0|0?\.\d+))?\s*\)$/;

export function normalizeCaptionColor(value: string): string | null {
  const trimmed = value.trim();
  const hex = HEX.exec(trimmed);
  if (hex) {
    return `#${hex[1].toUpperCase()}`;
  }
  const rgb = RGB.exec(trimmed);
  if (!rgb) {
    return null;
  }
  const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (parts.some((part) => part > 255)) {
    return null;
  }
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// Electron names Windows ButtonFace and ButtonText as 3d-face and button-text.
export function contrastCaptionColors(
  getColor: (name: ContrastCaptionName) => string,
): ContrastCaptionColors | null {
  try {
    const background = normalizeCaptionColor(getColor(CONTRAST_CAPTION_BACKGROUND));
    const symbol = normalizeCaptionColor(getColor(CONTRAST_CAPTION_SYMBOL));
    if (background === null || symbol === null) {
      return null;
    }
    return { background, symbol };
  } catch {
    return null;
  }
}

export function readSystemCaptionColors(
  platform: NodeJS.Platform,
  getColor: (name: ContrastCaptionName) => string,
): ContrastCaptionColors | null {
  if (platform !== 'win32') {
    return null;
  }
  return contrastCaptionColors(getColor);
}
