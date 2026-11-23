// Header walks for pasted image bytes. Pixels are not decoded. SVG is
// recognized so it can be dropped. The checks match the file-format image
// walk: type from the first bytes, size from the header, GIF blocks and
// WebP chunks for frames.

import {
  ANIMATION_FRAME_MAX,
  ANIMATION_PIXEL_MAX,
  IMAGE_DIMENSION_MAX,
  IMAGE_DIMENSION_MIN,
} from '../../shared/schema/limits.js';

export type SniffedType = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'unknown';

export interface WalkedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  codedWidth: number | null;
  codedHeight: number | null;
}

export interface WalkedImage {
  ok: boolean;
  width: number;
  height: number;
  frames: WalkedFrame[];
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

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
    const header = String.fromCharCode(
      bytes[0] ?? 0,
      bytes[1] ?? 0,
      bytes[2] ?? 0,
      bytes[3] ?? 0,
      bytes[4] ?? 0,
      bytes[5] ?? 0,
    );
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

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33 || !startsWith(bytes, PNG)) {
    return null;
  }
  if (u32be(bytes, 8) !== 13) {
    return null;
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  if (crc32(bytes.subarray(12, 29)) !== u32be(bytes, 29)) {
    return null;
  }
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function hasNoLength(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      return null;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) {
      pos += 1;
    }
    if (pos >= bytes.length) {
      return null;
    }
    const marker = bytes[pos] ?? 0;
    pos += 1;
    if (marker === 0xda || marker === 0xd9 || marker === 0x00) {
      return null;
    }
    if (hasNoLength(marker)) {
      continue;
    }
    if (pos + 2 > bytes.length) {
      return null;
    }
    const length = u16be(bytes, pos);
    if (length < 2 || pos + length > bytes.length) {
      return null;
    }
    if (isStartOfFrame(marker)) {
      if (length < 7) {
        return null;
      }
      return { height: u16be(bytes, pos + 3), width: u16be(bytes, pos + 5) };
    }
    pos += length;
  }
  return null;
}

function readSubBlocks(bytes: Uint8Array, pos: number): number | null {
  while (pos < bytes.length) {
    const size = bytes[pos];
    if (size === undefined) {
      return null;
    }
    pos += 1;
    if (size === 0) {
      return pos;
    }
    if (pos + size > bytes.length) {
      return null;
    }
    pos += size;
  }
  return null;
}

function walkGif(bytes: Uint8Array): WalkedImage | null {
  if (bytes.length < 13) {
    return null;
  }
  const header = String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0,
    bytes[4] ?? 0,
    bytes[5] ?? 0,
  );
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return null;
  }
  const canvasWidth = u16le(bytes, 6);
  const canvasHeight = u16le(bytes, 8);
  const packed = bytes[10] ?? 0;
  let pos = 13;
  if ((packed & 0x80) !== 0) {
    const tableBytes = (1 << ((packed & 0x07) + 1)) * 3;
    if (pos + tableBytes > bytes.length) {
      return null;
    }
    pos += tableBytes;
  }
  const frames: WalkedFrame[] = [];
  let sawTrailer = false;
  while (pos < bytes.length && !sawTrailer) {
    const marker = bytes[pos];
    pos += 1;
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      if (pos >= bytes.length) {
        return null;
      }
      pos += 1;
      const next = readSubBlocks(bytes, pos);
      if (next === null) {
        return null;
      }
      pos = next;
      continue;
    }
    if (marker !== 0x2c || pos + 9 > bytes.length) {
      return null;
    }
    const frame: WalkedFrame = {
      x: u16le(bytes, pos),
      y: u16le(bytes, pos + 2),
      width: u16le(bytes, pos + 4),
      height: u16le(bytes, pos + 6),
      codedWidth: null,
      codedHeight: null,
    };
    const imagePacked = bytes[pos + 8] ?? 0;
    pos += 9;
    if ((imagePacked & 0x80) !== 0) {
      const tableBytes = (1 << ((imagePacked & 0x07) + 1)) * 3;
      if (pos + tableBytes > bytes.length) {
        return null;
      }
      pos += tableBytes;
    }
    if (pos >= bytes.length) {
      return null;
    }
    pos += 1;
    const imageData = readSubBlocks(bytes, pos);
    if (imageData === null || frame.width < 1 || frame.height < 1) {
      return null;
    }
    pos = imageData;
    frames.push(frame);
  }
  if (!sawTrailer || frames.length === 0) {
    return null;
  }
  return { ok: true, width: canvasWidth, height: canvasHeight, frames };
}

interface Chunk {
  tag: string;
  data: Uint8Array;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readChunks(bytes: Uint8Array, start: number, end: number): { chunks: Chunk[]; truncated: boolean } {
  const chunks: Chunk[] = [];
  let pos = start;
  const limit = Math.min(end, bytes.length);
  while (pos + 8 <= limit) {
    const tag = fourcc(bytes, pos);
    const size = u32le(bytes, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > limit || dataEnd > bytes.length) {
      return { chunks, truncated: true };
    }
    chunks.push({ tag, data: bytes.subarray(dataStart, dataEnd) });
    pos = dataEnd + (size & 1);
    if ((size & 1) === 1 && pos > limit) {
      return { chunks, truncated: true };
    }
  }
  if (pos < limit) {
    return { chunks, truncated: true };
  }
  return { chunks, truncated: false };
}

function peekVp8(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 10) {
    return null;
  }
  const tag = (data[0] ?? 0) | ((data[1] ?? 0) << 8) | ((data[2] ?? 0) << 16);
  if ((tag & 1) !== 0) {
    return null;
  }
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    return null;
  }
  const width = u16le(data, 6) & 0x3fff;
  const height = u16le(data, 8) & 0x3fff;
  if (width < 1 || height < 1) {
    return null;
  }
  return { width, height };
}

function peekVp8l(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 5 || data[0] !== 0x2f) {
    return null;
  }
  const bits = ((data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16) | ((data[4] ?? 0) << 24)) >>> 0;
  if (bits >>> 29 !== 0) {
    return null;
  }
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function peekFramePayload(data: Uint8Array): { width: number; height: number } | null {
  const inner = readChunks(data, 0, data.length);
  if (inner.truncated && inner.chunks.length === 0) {
    return null;
  }
  let size: { width: number; height: number } | null = null;
  for (const chunk of inner.chunks) {
    if (chunk.tag === 'ALPH') {
      continue;
    }
    if (chunk.tag === 'VP8 ') {
      size = peekVp8(chunk.data);
      if (!size) {
        return null;
      }
    } else if (chunk.tag === 'VP8L') {
      size = peekVp8l(chunk.data);
      if (!size) {
        return null;
      }
    }
  }
  return size;
}

function walkWebp(bytes: Uint8Array): WalkedImage | null {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
    return null;
  }
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length) {
    return null;
  }
  const parsed = readChunks(bytes, 12, riffEnd);
  if (parsed.truncated) {
    return null;
  }
  const frames: WalkedFrame[] = [];
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasFromVp8x = false;
  let animationFlag = false;
  let still: { width: number; height: number } | null = null;
  for (const chunk of parsed.chunks) {
    if (chunk.tag === 'VP8X') {
      if (chunk.data.length < 10) {
        return null;
      }
      animationFlag = ((chunk.data[0] ?? 0) & 0x02) !== 0;
      canvasWidth = 1 + u24le(chunk.data, 4);
      canvasHeight = 1 + u24le(chunk.data, 7);
      canvasFromVp8x = true;
      continue;
    }
    if (chunk.tag === 'ANIM') {
      if (chunk.data.length < 6) {
        return null;
      }
      continue;
    }
    if (chunk.tag === 'ANMF') {
      if (chunk.data.length < 16) {
        return null;
      }
      const frame: WalkedFrame = {
        x: u24le(chunk.data, 0) * 2,
        y: u24le(chunk.data, 3) * 2,
        width: 1 + u24le(chunk.data, 6),
        height: 1 + u24le(chunk.data, 9),
        codedWidth: null,
        codedHeight: null,
      };
      const peeked = peekFramePayload(chunk.data.subarray(16));
      if (!peeked || peeked.width !== frame.width || peeked.height !== frame.height) {
        return null;
      }
      frame.codedWidth = peeked.width;
      frame.codedHeight = peeked.height;
      if (frame.width < 1 || frame.height < 1) {
        return null;
      }
      frames.push(frame);
      continue;
    }
    if (chunk.tag === 'VP8 ' || chunk.tag === 'VP8L') {
      const size = chunk.tag === 'VP8 ' ? peekVp8(chunk.data) : peekVp8l(chunk.data);
      if (!size) {
        return null;
      }
      still = size;
    }
  }
  if (!canvasFromVp8x && still) {
    canvasWidth = still.width;
    canvasHeight = still.height;
  }
  if (frames.length === 0 && still) {
    if (canvasFromVp8x && (still.width !== canvasWidth || still.height !== canvasHeight)) {
      return null;
    }
    frames.push({
      x: 0,
      y: 0,
      width: still.width,
      height: still.height,
      codedWidth: still.width,
      codedHeight: still.height,
    });
  }
  if (animationFlag && frames.length === 0) {
    return null;
  }
  if (!animationFlag && frames.length > 0 && still === null) {
    return null;
  }
  if (frames.length === 0) {
    return null;
  }
  return { ok: true, width: canvasWidth, height: canvasHeight, frames };
}

function raster(width: number, height: number): WalkedImage {
  return {
    ok: true,
    width,
    height,
    frames: [{ x: 0, y: 0, width, height, codedWidth: null, codedHeight: null }],
  };
}

function withinLimits(walked: WalkedImage): boolean {
  if (walked.width > IMAGE_DIMENSION_MAX || walked.height > IMAGE_DIMENSION_MAX) {
    return false;
  }
  if (walked.width < IMAGE_DIMENSION_MIN || walked.height < IMAGE_DIMENSION_MIN) {
    return false;
  }
  if (walked.frames.length < 1 || walked.frames.length > ANIMATION_FRAME_MAX) {
    return false;
  }
  let pixels = 0n;
  for (const frame of walked.frames) {
    if (frame.width < 1 || frame.height < 1) {
      return false;
    }
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    if (frame.x < 0 || frame.y < 0 || right > walked.width || bottom > walked.height) {
      return false;
    }
    let areaWidth = frame.width;
    let areaHeight = frame.height;
    if (frame.codedWidth !== null && frame.codedHeight !== null) {
      if (frame.codedWidth > IMAGE_DIMENSION_MAX || frame.codedHeight > IMAGE_DIMENSION_MAX) {
        return false;
      }
      if (frame.codedWidth < 1 || frame.codedHeight < 1) {
        return false;
      }
      if (frame.codedWidth !== frame.width || frame.codedHeight !== frame.height) {
        return false;
      }
      areaWidth = Math.max(frame.width, frame.codedWidth);
      areaHeight = Math.max(frame.height, frame.codedHeight);
    }
    if (areaWidth > 0 && areaHeight > 0) {
      pixels += BigInt(areaWidth) * BigInt(areaHeight);
    }
  }
  return pixels <= BigInt(ANIMATION_PIXEL_MAX);
}

export function walkImage(type: 'png' | 'jpeg' | 'gif' | 'webp', bytes: Uint8Array): WalkedImage | null {
  if (type === 'png') {
    const size = readPngSize(bytes);
    return size ? raster(size.width, size.height) : null;
  }
  if (type === 'jpeg') {
    const size = readJpegSize(bytes);
    return size ? raster(size.width, size.height) : null;
  }
  if (type === 'gif') {
    return walkGif(bytes);
  }
  return walkWebp(bytes);
}

export function acceptWalk(walked: WalkedImage | null): walked is WalkedImage {
  return walked !== null && walked.ok && withinLimits(walked);
}
