import { u16le } from './binary.js';

// GIF87a and GIF89a blocks, per spike S-06. An image descriptor is a frame.
// Extension sub-blocks, including a Netscape loop count, are skipped by length.
// LZW data is skipped by sub-block length. Bytes after the trailer are not frames.
// A file with no trailer is refused. No pixel buffer is allocated.

export interface GifFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GifWalk {
  ok: boolean;
  reason: string | null;
  canvasWidth: number;
  canvasHeight: number;
  frames: GifFrame[];
}

function empty(reason: string, canvasWidth = 0, canvasHeight = 0, frames: GifFrame[] = []): GifWalk {
  return { ok: false, reason, canvasWidth, canvasHeight, frames };
}

function readSubBlocks(bytes: Uint8Array, pos: number): { pos: number } | null {
  while (pos < bytes.length) {
    const size = bytes[pos];
    if (size === undefined) {
      return null;
    }
    pos += 1;
    if (size === 0) {
      return { pos };
    }
    if (pos + size > bytes.length) {
      return null;
    }
    pos += size;
  }
  return null;
}

export function walkGif(bytes: Uint8Array): GifWalk {
  if (bytes.length < 6) {
    return empty(bytes.length === 0 ? 'not-gif' : 'truncated');
  }
  const header = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0, bytes[4] ?? 0, bytes[5] ?? 0);
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return empty('not-gif');
  }
  if (bytes.length < 13) {
    return empty('truncated');
  }
  const canvasWidth = u16le(bytes, 6);
  const canvasHeight = u16le(bytes, 8);
  const packed = bytes[10] ?? 0;
  let pos = 13;
  if ((packed & 0x80) !== 0) {
    const tableBytes = (1 << ((packed & 0x07) + 1)) * 3;
    if (pos + tableBytes > bytes.length) {
      return empty('truncated', canvasWidth, canvasHeight);
    }
    pos += tableBytes;
  }

  const frames: GifFrame[] = [];
  let sawTrailer = false;
  let hardReason: string | null = null;

  while (pos < bytes.length && !sawTrailer) {
    const marker = bytes[pos];
    pos += 1;
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      if (pos >= bytes.length) {
        hardReason = 'truncated';
        break;
      }
      pos += 1;
      const subs = readSubBlocks(bytes, pos);
      if (!subs) {
        hardReason = 'truncated';
        break;
      }
      pos = subs.pos;
      continue;
    }
    if (marker !== 0x2c) {
      hardReason = 'bad-block';
      break;
    }
    if (pos + 9 > bytes.length) {
      hardReason = 'truncated';
      break;
    }
    const frame: GifFrame = {
      x: u16le(bytes, pos),
      y: u16le(bytes, pos + 2),
      width: u16le(bytes, pos + 4),
      height: u16le(bytes, pos + 6),
    };
    const imagePacked = bytes[pos + 8] ?? 0;
    pos += 9;
    if ((imagePacked & 0x80) !== 0) {
      const tableBytes = (1 << ((imagePacked & 0x07) + 1)) * 3;
      if (pos + tableBytes > bytes.length) {
        hardReason = 'truncated';
        break;
      }
      pos += tableBytes;
    }
    if (pos >= bytes.length) {
      hardReason = 'truncated';
      break;
    }
    pos += 1;
    const imageData = readSubBlocks(bytes, pos);
    if (!imageData) {
      hardReason = 'truncated';
      break;
    }
    pos = imageData.pos;
    if (frame.width < 1 || frame.height < 1) {
      hardReason = hardReason ?? 'bad-frame';
    }
    frames.push(frame);
  }

  if (hardReason) {
    return empty(hardReason, canvasWidth, canvasHeight, frames);
  }
  if (!sawTrailer) {
    return empty('missing-trailer', canvasWidth, canvasHeight, frames);
  }
  if (frames.length === 0) {
    return empty('no-frames', canvasWidth, canvasHeight);
  }
  return { ok: true, reason: null, canvasWidth, canvasHeight, frames };
}
