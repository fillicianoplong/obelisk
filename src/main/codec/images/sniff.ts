// The type is the file's first bytes, not the extension. SVG is recognized
// so it can be refused even when the name looks like a PNG, JPEG, GIF, or WebP.

export type SniffedType = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'unknown';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic[index]) {
      return false;
    }
  }
  return true;
}

function fold(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function startsFolded(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (fold(bytes[offset + index] ?? 0) !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function containsFolded(bytes: Uint8Array, offset: number, text: string): boolean {
  const end = Math.min(bytes.length, offset + 1024);
  for (let index = offset; index + text.length <= end; index += 1) {
    if (startsFolded(bytes, index, text)) {
      return true;
    }
  }
  return false;
}

function isSvg(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  while (
    offset < bytes.length &&
    (bytes[offset] === 0x20 || bytes[offset] === 0x09 || bytes[offset] === 0x0a || bytes[offset] === 0x0d)
  ) {
    offset += 1;
  }
  if (startsFolded(bytes, offset, '<svg')) {
    return true;
  }
  if (startsFolded(bytes, offset, '<!doctype svg')) {
    return true;
  }
  if (startsFolded(bytes, offset, '<?xml') || startsFolded(bytes, offset, '<!doctype')) {
    return containsFolded(bytes, offset, '<svg');
  }
  return false;
}

export function sniffImage(bytes: Uint8Array): SniffedType {
  if (startsWith(bytes, PNG)) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0, bytes[4] ?? 0, bytes[5] ?? 0);
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'gif';
    }
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
    if (riff === 'RIFF' && webp === 'WEBP') {
      return 'webp';
    }
  }
  if (isSvg(bytes)) {
    return 'svg';
  }
  return 'unknown';
}
