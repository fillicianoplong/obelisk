// Entry names are the central-directory bytes, read as Latin-1. yauzl is not
// asked to rewrite them: a backslash has to stay a backslash so the reason
// can name it (ADR-013, spike S-08).

const IMAGE_NAME = /^images\/[0-9a-f]{64}\.(png|jpg|gif|webp)$/;

const DEVICE_BASES = new Set(['CON', 'PRN', 'AUX', 'NUL']);

function isDeviceSegment(segment: string): boolean {
  const base = segment.split('.')[0]?.toUpperCase() ?? '';
  if (DEVICE_BASES.has(base)) {
    return true;
  }
  return /^COM[1-9]$/.test(base) || /^LPT[1-9]$/.test(base);
}

/**
 * A hostile shape, or null when the name is not one of those shapes.
 * The allowlist is a separate check so a case duplicate is reported as itself.
 */
export function hostileNameReason(name: string): string | null {
  if (name.length === 0) {
    return 'empty-name';
  }
  if (name.includes('\0')) {
    return 'nul-in-name';
  }
  if (name.startsWith('\\\\') || name.startsWith('//')) {
    return 'network-path';
  }
  if (/^[A-Za-z]:/.test(name)) {
    return 'drive-letter';
  }
  if (name.includes(':')) {
    return 'stream-suffix';
  }
  const segments = name.split(/[/\\]/);
  if (segments.includes('..')) {
    return 'dot-dot';
  }
  if (name.startsWith('/') || name.startsWith('\\')) {
    return 'leading-slash';
  }
  if (name.includes('\\')) {
    return 'backslash';
  }
  if (segments.some((segment) => segment.toLowerCase().endsWith('.zip'))) {
    return 'nested-zip';
  }
  if (segments.some((segment) => isDeviceSegment(segment))) {
    return 'device-name';
  }
  return null;
}

export function allowedEntryName(name: string): boolean {
  return name === 'manifest.json' || name === 'document.json' || IMAGE_NAME.test(name);
}
