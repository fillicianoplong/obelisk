import { crc32 } from 'node:zlib';
import { u32be } from './binary.js';

// Width and height come from IHDR. The pixel data is not read.

export interface HeaderSize {
  width: number;
  height: number;
}

export type HeaderRead = { ok: true; size: HeaderSize } | { ok: false };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngSize(bytes: Uint8Array): HeaderRead {
  if (bytes.length < 33) {
    return { ok: false };
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return { ok: false };
    }
  }
  if (u32be(bytes, 8) !== 13) {
    return { ok: false };
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return { ok: false };
  }
  const expected = crc32(Buffer.from(bytes.subarray(12, 29))) >>> 0;
  if (expected !== u32be(bytes, 29)) {
    return { ok: false };
  }
  return { ok: true, size: { width: u32be(bytes, 16), height: u32be(bytes, 20) } };
}
