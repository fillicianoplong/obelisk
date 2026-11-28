export interface BundledFontFace {
  readonly file: string;
  readonly family: string;
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
}

export interface BundledFontFamily {
  readonly family: string;
  readonly licenseFile: string;
  readonly menuId: string;
}

/** Families shipped in the app under OFL or equivalent redistribution terms (OD-08). */
export const BUNDLED_FONT_FAMILIES: readonly BundledFontFamily[] = [
  { family: 'Liberation Serif', licenseFile: 'OFL.txt', menuId: 'format-font-liberation-serif' },
  { family: 'Liberation Sans', licenseFile: 'OFL-LiberationSans.txt', menuId: 'format-font-liberation-sans' },
  { family: 'Liberation Mono', licenseFile: 'OFL-LiberationMono.txt', menuId: 'format-font-liberation-mono' },
  { family: 'Caladea', licenseFile: 'OFL-Caladea.txt', menuId: 'format-font-caladea' },
  { family: 'Carlito', licenseFile: 'OFL-Carlito.txt', menuId: 'format-font-carlito' },
  { family: 'Linux Libertine G', licenseFile: 'OFL-Libertine.txt', menuId: 'format-font-libertine' },
  { family: 'Linux Biolinum G', licenseFile: 'OFL-Libertine.txt', menuId: 'format-font-biolinum' },
  { family: 'Noto Serif', licenseFile: 'OFL-NotoSerif.txt', menuId: 'format-font-noto-serif' },
  { family: 'Noto Sans', licenseFile: 'OFL-NotoSans.txt', menuId: 'format-font-noto-sans' },
  { family: 'Dancing Script', licenseFile: 'OFL-DancingScript.txt', menuId: 'format-font-dancing' },
];

export const BUNDLED_FONT_FAMILY_NAMES: readonly string[] = BUNDLED_FONT_FAMILIES.map((row) => row.family);