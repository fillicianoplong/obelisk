import { u16le, u24le, u32le } from './binary.js';

// WebP RIFF chunks, per spike S-06. The RIFF size is the end of the container,
// so an ANMF chunk past it is not a frame. ANMF x and y are in 2-pixel units.
// The VP8 or VP8L header inside a frame is peeked for the coded size. The
// residual is not decoded. A coded size that disagrees with the ANMF box is
// recorded so the pixel sum can use the larger box. ANMF chunks with the VP8X
// animation bit clear are still counted, and the file is refused later.

const VP8X_ANIMATION = 0x02;

export interface WebpFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  codedWidth: number | null;
  codedHeight: number | null;
}

export interface WebpWalk {
  ok: boolean;
  reason: string | null;
  canvasWidth: number;
  canvasHeight: number;
  frames: WebpFrame[];
  sizeMismatch: boolean;
  animationFlagClear: boolean;
}

interface Chunk {
  tag: string;
  data: Uint8Array;
}

interface BitstreamSize {
  width: number;
  height: number;
}

function empty(reason: string): WebpWalk {
  return {
    ok: false,
    reason,
    canvasWidth: 0,
    canvasHeight: 0,
    frames: [],
    sizeMismatch: false,
    animationFlagClear: false,
  };
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function readChunks(
  bytes: Uint8Array,
  start: number,
  end: number,
): { chunks: Chunk[]; truncated: boolean } {
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

function peekVp8(data: Uint8Array): BitstreamSize | null {
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

function peekVp8l(data: Uint8Array): BitstreamSize | null {
  if (data.length < 5 || data[0] !== 0x2f) {
    return null;
  }
  const bits =
    ((data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16) | ((data[4] ?? 0) << 24)) >>> 0;
  if (bits >>> 29 !== 0) {
    return null;
  }
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  return { width, height };
}

function peekFramePayload(data: Uint8Array): { size: BitstreamSize | null; reason: string | null } {
  const inner = readChunks(data, 0, data.length);
  if (inner.truncated && inner.chunks.length === 0) {
    return { size: null, reason: 'truncated' };
  }
  let size: BitstreamSize | null = null;
  for (const chunk of inner.chunks) {
    if (chunk.tag === 'ALPH') {
      continue;
    }
    if (chunk.tag === 'VP8 ') {
      size = peekVp8(chunk.data);
      if (!size) {
        return { size: null, reason: 'bad-bitstream' };
      }
      continue;
    }
    if (chunk.tag === 'VP8L') {
      size = peekVp8l(chunk.data);
      if (!size) {
        return { size: null, reason: 'bad-bitstream' };
      }
    }
  }
  if (!size) {
    return { size: null, reason: inner.truncated ? 'truncated' : 'bad-bitstream' };
  }
  return { size, reason: inner.truncated ? 'truncated' : null };
}

export function walkWebp(bytes: Uint8Array): WebpWalk {
  if (bytes.length < 12) {
    return empty(bytes.length === 0 ? 'not-webp' : 'truncated');
  }
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
    return empty('not-webp');
  }
  const riffEnd = 8 + u32le(bytes, 4);
  const parsed = readChunks(bytes, 12, riffEnd);
  const frames: WebpFrame[] = [];
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasFromVp8x = false;
  let animationFlag = false;
  let hardReason: string | null = parsed.truncated ? 'truncated' : null;
  let stillSize: BitstreamSize | null = null;
  let sizeMismatch = false;

  for (const chunk of parsed.chunks) {
    if (chunk.tag === 'VP8X') {
      if (chunk.data.length < 10) {
        hardReason = hardReason ?? 'truncated';
        continue;
      }
      animationFlag = ((chunk.data[0] ?? 0) & VP8X_ANIMATION) !== 0;
      canvasWidth = 1 + u24le(chunk.data, 4);
      canvasHeight = 1 + u24le(chunk.data, 7);
      canvasFromVp8x = true;
      continue;
    }
    if (chunk.tag === 'ANIM') {
      if (chunk.data.length < 6) {
        hardReason = hardReason ?? 'truncated';
      }
      continue;
    }
    if (chunk.tag === 'ANMF') {
      if (chunk.data.length < 16) {
        hardReason = hardReason ?? 'bad-frame';
        continue;
      }
      const frame: WebpFrame = {
        x: u24le(chunk.data, 0) * 2,
        y: u24le(chunk.data, 3) * 2,
        width: 1 + u24le(chunk.data, 6),
        height: 1 + u24le(chunk.data, 9),
        codedWidth: null,
        codedHeight: null,
      };
      const peeked = peekFramePayload(chunk.data.subarray(16));
      if (peeked.reason) {
        hardReason = hardReason ?? peeked.reason;
      }
      if (peeked.size) {
        frame.codedWidth = peeked.size.width;
        frame.codedHeight = peeked.size.height;
        if (peeked.size.width !== frame.width || peeked.size.height !== frame.height) {
          sizeMismatch = true;
          hardReason = hardReason ?? 'size-mismatch';
        }
      }
      if (frame.width < 1 || frame.height < 1) {
        hardReason = hardReason ?? 'bad-frame';
      }
      frames.push(frame);
      continue;
    }
    if (chunk.tag === 'VP8 ' || chunk.tag === 'VP8L') {
      const size = chunk.tag === 'VP8 ' ? peekVp8(chunk.data) : peekVp8l(chunk.data);
      if (!size) {
        hardReason = hardReason ?? 'bad-bitstream';
        continue;
      }
      stillSize = size;
    }
  }

  if (!canvasFromVp8x && stillSize) {
    canvasWidth = stillSize.width;
    canvasHeight = stillSize.height;
  }
  if (frames.length === 0 && stillSize) {
    const frame: WebpFrame = {
      x: 0,
      y: 0,
      width: stillSize.width,
      height: stillSize.height,
      codedWidth: stillSize.width,
      codedHeight: stillSize.height,
    };
    frames.push(frame);
    if (canvasFromVp8x && (stillSize.width !== canvasWidth || stillSize.height !== canvasHeight)) {
      sizeMismatch = true;
      hardReason = hardReason ?? 'size-mismatch';
    }
  }
  if (animationFlag && frames.length === 0) {
    hardReason = hardReason ?? 'animation-flag-empty';
  }
  const animationFlagClear = !animationFlag && frames.length > 0 && stillSize === null;
  if (riffEnd > bytes.length) {
    hardReason = hardReason ?? 'truncated';
  }
  if (hardReason) {
    return {
      ok: false,
      reason: hardReason,
      canvasWidth,
      canvasHeight,
      frames,
      sizeMismatch,
      animationFlagClear,
    };
  }
  if (frames.length === 0) {
    return {
      ok: false,
      reason: 'no-frames',
      canvasWidth,
      canvasHeight,
      frames,
      sizeMismatch,
      animationFlagClear,
    };
  }
  return {
    ok: true,
    reason: null,
    canvasWidth,
    canvasHeight,
    frames,
    sizeMismatch,
    animationFlagClear,
  };
}
