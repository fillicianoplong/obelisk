export type RasterKind = 'png' | 'jpeg' | 'gif' | 'webp';

export function sniffRasterKind(bytes: Uint8Array): RasterKind {
  if (bytes.byteLength >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.byteLength >= 6) {
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (head === 'GIF87a' || head === 'GIF89a') {
      return 'gif';
    }
  }
  if (bytes.byteLength >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'webp';
  }
  return 'png';
}

export function rasterExtension(kind: RasterKind): string {
  if (kind === 'jpeg') {
    return 'jpg';
  }
  return kind;
}