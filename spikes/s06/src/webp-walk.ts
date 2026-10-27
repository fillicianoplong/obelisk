import { emptyWalk, frameShell, type ImageWalk, type WalkFrame } from './image-info';

const VP8X_ANIMATION = 0x02;
const VP8X_ALPHA = 0x10;

interface Chunk {
  tag: string;
  data: Uint8Array;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

export function readChunks(bytes: Uint8Array, start: number, end: number): { chunks: Chunk[]; pos: number; truncated: boolean } {
  const chunks: Chunk[] = [];
  let pos = start;
  const limit = Math.min(end, bytes.length);
  while (pos + 8 <= limit) {
    const tag = fourcc(bytes, pos);
    const size = u32(bytes, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > limit || dataEnd > bytes.length) {
      return { chunks, pos, truncated: true };
    }
    chunks.push({ tag, data: bytes.subarray(dataStart, dataEnd) });
    pos = dataEnd + (size & 1);
    if ((size & 1) === 1 && pos > limit) {
      return { chunks, pos: dataEnd, truncated: true };
    }
  }
  if (pos < limit) {
    return { chunks, pos, truncated: true };
  }
  return { chunks, pos, truncated: false };
}

interface BitstreamSize {
  width: number;
  height: number;
  alpha: boolean;
  lossless: boolean;
}

function peekVp8(data: Uint8Array): BitstreamSize | null {
  if (data.length < 10) {
    return null;
  }
  const tag = u24(data, 0);
  const keyframe = (tag & 1) === 0;
  if (!keyframe) {
    return null;
  }
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    return null;
  }
  const width = u16(data, 6) & 0x3fff;
  const height = u16(data, 8) & 0x3fff;
  if (width < 1 || height < 1) {
    return null;
  }
  return { width, height, alpha: false, lossless: false };
}

function peekVp8l(data: Uint8Array): BitstreamSize | null {
  if (data.length < 5 || data[0] !== 0x2f) {
    return null;
  }
  const bits =
    ((data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16) | ((data[4] ?? 0) << 24)) >>> 0;
  const version = bits >>> 29;
  if (version !== 0) {
    return null;
  }
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  const alpha = ((bits >>> 28) & 1) === 1;
  return { width, height, alpha, lossless: true };
}

function peekFramePayload(data: Uint8Array): { size: BitstreamSize | null; alphaChunk: boolean; reason: string | null } {
  const inner = readChunks(data, 0, data.length);
  if (inner.truncated && inner.chunks.length === 0) {
    return { size: null, alphaChunk: false, reason: 'truncated' };
  }
  let alphaChunk = false;
  let size: BitstreamSize | null = null;
  for (const chunk of inner.chunks) {
    if (chunk.tag === 'ALPH') {
      alphaChunk = true;
      continue;
    }
    if (chunk.tag === 'VP8 ') {
      size = peekVp8(chunk.data);
      if (!size) {
        return { size: null, alphaChunk, reason: 'bad-bitstream' };
      }
      continue;
    }
    if (chunk.tag === 'VP8L') {
      size = peekVp8l(chunk.data);
      if (!size) {
        return { size: null, alphaChunk, reason: 'bad-bitstream' };
      }
    }
  }
  if (!size) {
    return { size: null, alphaChunk, reason: inner.truncated ? 'truncated' : 'bad-bitstream' };
  }
  if (alphaChunk) {
    size = { ...size, alpha: true };
  }
  return { size, alphaChunk, reason: inner.truncated ? 'truncated' : null };
}

function applySize(frame: WalkFrame, size: BitstreamSize): void {
  frame.bitstreamWidth = size.width;
  frame.bitstreamHeight = size.height;
  frame.alpha = size.alpha;
  frame.lossless = size.lossless;
  frame.transparent = size.alpha;
}

export function walkWebp(bytes: Uint8Array): ImageWalk {
  if (bytes.length < 12) {
    return emptyWalk('webp', bytes.length === 0 ? 'not-webp' : 'truncated');
  }
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
    return emptyWalk('webp', 'not-webp');
  }
  const riffSize = u32(bytes, 4);
  const riffEnd = 8 + riffSize;
  const parsed = readChunks(bytes, 12, riffEnd);
  const walk = emptyWalk('webp', 'truncated');
  let canvasFromVp8x = false;
  let animationFlag = false;
  let alphaFlag = false;
  let hardReason: string | null = parsed.truncated ? 'truncated' : null;
  let stillSize: BitstreamSize | null = null;

  for (const chunk of parsed.chunks) {
    if (chunk.tag === 'VP8X') {
      if (chunk.data.length < 10) {
        hardReason = hardReason ?? 'truncated';
        continue;
      }
      const flags = chunk.data[0] ?? 0;
      animationFlag = (flags & VP8X_ANIMATION) !== 0;
      alphaFlag = (flags & VP8X_ALPHA) !== 0;
      walk.canvasWidth = 1 + u24(chunk.data, 4);
      walk.canvasHeight = 1 + u24(chunk.data, 7);
      canvasFromVp8x = true;
      if (alphaFlag) {
        walk.hasAlpha = true;
      }
      continue;
    }
    if (chunk.tag === 'ANIM') {
      if (chunk.data.length < 6) {
        hardReason = hardReason ?? 'truncated';
        continue;
      }
      walk.loopCount = u16(chunk.data, 4);
      walk.repeatsForever = walk.loopCount === 0;
      continue;
    }
    if (chunk.tag === 'ANMF') {
      if (chunk.data.length < 16) {
        hardReason = hardReason ?? 'bad-frame';
        continue;
      }
      const frame = frameShell(walk.frames.length);
      frame.x = u24(chunk.data, 0) * 2;
      frame.y = u24(chunk.data, 3) * 2;
      frame.width = 1 + u24(chunk.data, 6);
      frame.height = 1 + u24(chunk.data, 9);
      frame.durationMs = u24(chunk.data, 12);
      const bits = chunk.data[15] ?? 0;
      frame.disposal = bits & 1;
      frame.blend = (bits >> 1) & 1;
      const payload = chunk.data.subarray(16);
      const peeked = peekFramePayload(payload);
      if (peeked.reason) {
        hardReason = hardReason ?? peeked.reason;
      }
      if (peeked.size) {
        applySize(frame, peeked.size);
        if (peeked.size.alpha || peeked.alphaChunk) {
          walk.hasAlpha = true;
        }
        if (peeked.size.width !== frame.width || peeked.size.height !== frame.height) {
          hardReason = hardReason ?? 'size-mismatch';
        }
      }
      if (frame.width < 1 || frame.height < 1) {
        hardReason = hardReason ?? 'bad-frame';
      }
      walk.frames.push(frame);
      continue;
    }
    if (chunk.tag === 'VP8 ' || chunk.tag === 'VP8L' || chunk.tag === 'ALPH') {
      if (chunk.tag === 'ALPH') {
        walk.hasAlpha = true;
        continue;
      }
      const size = chunk.tag === 'VP8 ' ? peekVp8(chunk.data) : peekVp8l(chunk.data);
      if (!size) {
        hardReason = hardReason ?? 'bad-bitstream';
        continue;
      }
      if (alphaFlag) {
        size.alpha = true;
      }
      stillSize = size;
      if (size.alpha) {
        walk.hasAlpha = true;
      }
    }
  }

  if (!canvasFromVp8x && stillSize) {
    walk.canvasWidth = stillSize.width;
    walk.canvasHeight = stillSize.height;
  }
  if (walk.frames.length === 0 && stillSize) {
    const frame = frameShell(0);
    frame.width = stillSize.width;
    frame.height = stillSize.height;
    applySize(frame, stillSize);
    walk.frames.push(frame);
    if (canvasFromVp8x && (stillSize.width !== walk.canvasWidth || stillSize.height !== walk.canvasHeight)) {
      hardReason = hardReason ?? 'size-mismatch';
    }
  }
  if (animationFlag && walk.frames.length === 0) {
    hardReason = hardReason ?? 'animation-flag-empty';
  }
  if (!animationFlag && walk.frames.length > 0 && stillSize === null) {
    walk.notes.push('animation-flag-clear');
  }
  walk.animated =
    walk.frames.length > 1 ||
    (animationFlag && walk.frames.length > 0) ||
    walk.notes.includes('animation-flag-clear');

  if (riffEnd < bytes.length) {
    walk.trailingBytes = bytes.length - riffEnd;
    const extra = readChunks(bytes, riffEnd, bytes.length);
    walk.framesPastContainer = extra.chunks.filter((chunk) => chunk.tag === 'ANMF').length;
    if (walk.framesPastContainer > 0) {
      walk.notes.push('anmf-after-riff');
    }
  } else if (riffEnd > bytes.length) {
    walk.trailingBytes = 0;
    hardReason = hardReason ?? 'truncated';
  }

  if (hardReason) {
    walk.ok = false;
    walk.reason = hardReason;
    return walk;
  }
  if (walk.frames.length === 0) {
    walk.ok = false;
    walk.reason = 'no-frames';
    return walk;
  }
  walk.ok = true;
  walk.reason = null;
  return walk;
}

export function naiveAnmfCount(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    if (bytes[i] === 0x41 && bytes[i + 1] === 0x4e && bytes[i + 2] === 0x4d && bytes[i + 3] === 0x46) {
      count += 1;
    }
  }
  return count;
}
