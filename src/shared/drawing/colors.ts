import { DEFAULT_INK } from './strokes.js';

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Ink shown on screen; export and print use stored document colours. */
export function strokeDisplayColor(storedColor: string, darkTheme: boolean): string {
  if (!COLOR_PATTERN.test(storedColor)) {
    return storedColor;
  }
  if (darkTheme && storedColor.toLowerCase() === DEFAULT_INK) {
    return '#E6EAF0';
  }
  return storedColor;
}

/** Colours written to PNG/PDF (document colours, never themed). */
export function strokeExportColor(storedColor: string): string {
  return storedColor;
}

export function pageThemeIsDark(doc: Document): boolean {
  const root = doc.documentElement;
  const attr = root.getAttribute('data-theme');
  if (attr === 'dark') {
    return true;
  }
  if (attr === 'light') {
    return false;
  }
  return doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches === true;
}