/**
 * NFR-23 modules: file format, save, and table math (SRS §7.5, OBL-81).
 * Paths are repo-relative with forward slashes.
 */
export const NFR23_MODULE_PREFIXES = [
  'src/main/codec/',
  'src/main/file/',
  'src/shared/schema/',
  'src/renderer/blocks/table/math/',
];

export function isNfr23Module(modulePath) {
  const normalized = String(modulePath).replaceAll('\\', '/');
  return NFR23_MODULE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}