import { u16be } from './binary.js';
import type { HeaderRead } from './png.js';

// Width and height come from the first SOF marker. Scan data is not read.

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function hasNoLength(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

export function readJpegSize(bytes: Uint8Array): HeaderRead {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ok: false };
  }
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      return { ok: false };
    }
    while (pos < bytes.length && bytes[pos] === 0xff) {
      pos += 1;
    }
    if (pos >= bytes.length) {
      return { ok: false };
    }
    const marker = bytes[pos] ?? 0;
    pos += 1;
    // SOS and EOI mean the frame header was never reached. RST and TEM have no length.
    if (marker === 0xda || marker === 0xd9 || marker === 0x00) {
      return { ok: false };
    }
    if (hasNoLength(marker)) {
      continue;
    }
    if (pos + 2 > bytes.length) {
      return { ok: false };
    }
    const length = u16be(bytes, pos);
    if (length < 2 || pos + length > bytes.length) {
      return { ok: false };
    }
    if (isStartOfFrame(marker)) {
      if (length < 7) {
        return { ok: false };
      }
      return { ok: true, size: { height: u16be(bytes, pos + 3), width: u16be(bytes, pos + 5) } };
    }
    pos += length;
  }
  return { ok: false };
}
