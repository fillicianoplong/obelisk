import { BUNDLED_FONT_FAMILY_NAMES } from './fonts/manifest.js';

/** Bundled text fonts (SRS Fonts reference). Settings and the Format menu share this list. */
export const BUNDLED_FONT_FAMILIES: readonly string[] = BUNDLED_FONT_FAMILY_NAMES;

const BUNDLED_FONT_SET: ReadonlySet<string> = new Set(BUNDLED_FONT_FAMILIES);

export function isBundledFontFamily(value: string): boolean {
  return BUNDLED_FONT_SET.has(value);
}