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
 * Reasons for names the archive must refuse before any other name rule.
 * Returns null when the name is not one of these hostile shapes.
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

/** Fails the process if a listed bad name is classified as something else. */
export function assertNameRules(): void {
  const cases: Array<[string, string]> = [
    ['../evil.txt', 'dot-dot'],
    ['images/../../out.txt', 'dot-dot'],
    ['/etc/passwd', 'leading-slash'],
    ['images\\evil.png', 'backslash'],
    ['C:/evil.txt', 'drive-letter'],
    ['C:\\evil.txt', 'drive-letter'],
    ['D:evil.txt', 'drive-letter'],
    ['\\\\server\\share\\evil.txt', 'network-path'],
    ['//server/share/evil.txt', 'network-path'],
    ['manifest.json:Zone.Identifier', 'stream-suffix'],
    ['document.json::$DATA', 'stream-suffix'],
    ['CON', 'device-name'],
    ['CON.txt', 'device-name'],
    ['con', 'device-name'],
    ['images/CON.png', 'device-name'],
    ['nested.zip', 'nested-zip'],
  ];
  for (const [name, expected] of cases) {
    const actual = hostileNameReason(name);
    if (actual !== expected) {
      throw new Error(
        `Name rule mismatch for ${JSON.stringify(name)}: ${String(actual)}, expected ${expected}.`,
      );
    }
  }
  if (!allowedEntryName('manifest.json') || !allowedEntryName('document.json')) {
    throw new Error('manifest.json and document.json must be allowed names.');
  }
  const hash = 'ab'.repeat(32);
  if (!allowedEntryName(`images/${hash}.png`)) {
    throw new Error('A lowercase hash image name must be allowed.');
  }
  if (allowedEntryName('Manifest.json') || allowedEntryName('extra.txt')) {
    throw new Error('Names outside the allowlist must be refused.');
  }
}
