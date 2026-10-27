import { emptyWalk, frameShell, type ImageWalk } from './image-info';

function readSubBlocks(
  bytes: Uint8Array,
  pos: number,
): { blocks: Uint8Array[]; pos: number } | null {
  const blocks: Uint8Array[] = [];
  while (pos < bytes.length) {
    const size = bytes[pos];
    if (size === undefined) {
      return null;
    }
    pos += 1;
    if (size === 0) {
      return { blocks, pos };
    }
    if (pos + size > bytes.length) {
      return null;
    }
    blocks.push(bytes.subarray(pos, pos + size));
    pos += size;
  }
  return null;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function isNetscape(block: Uint8Array): boolean {
  if (block.length !== 11) {
    return false;
  }
  const text = String.fromCharCode(...block);
  return text === 'NETSCAPE2.0' || text === 'ANIMEXTS1.0';
}

export function walkGif(bytes: Uint8Array): ImageWalk {
  if (bytes.length < 6) {
    return emptyWalk('gif', bytes.length === 0 ? 'not-gif' : 'truncated');
  }
  const header = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0, bytes[4] ?? 0, bytes[5] ?? 0);
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return emptyWalk('gif', 'not-gif');
  }
  if (bytes.length < 13) {
    return emptyWalk('gif', 'truncated');
  }
  const walk = emptyWalk('gif', 'truncated');
  walk.canvasWidth = u16(bytes, 6);
  walk.canvasHeight = u16(bytes, 8);
  const packed = bytes[10] ?? 0;
  const hasGlobalPalette = (packed & 0x80) !== 0;
  let pos = 13;
  if (hasGlobalPalette) {
    const colors = 1 << ((packed & 0x07) + 1);
    const tableBytes = colors * 3;
    if (pos + tableBytes > bytes.length) {
      return walk;
    }
    pos += tableBytes;
  }

  let pendingDelay = 0;
  let pendingDisposal = 0;
  let pendingTransparent = false;
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
      const label = bytes[pos];
      pos += 1;
      const subs = readSubBlocks(bytes, pos);
      if (!subs) {
        hardReason = 'truncated';
        break;
      }
      pos = subs.pos;
      if (label === 0xf9) {
        const block = subs.blocks[0];
        if (!block || block.length !== 4 || subs.blocks.length !== 1) {
          hardReason = 'bad-block';
          break;
        }
        const fields = block[0] ?? 0;
        pendingDisposal = (fields >> 2) & 0x07;
        pendingTransparent = (fields & 0x01) === 1;
        pendingDelay = (block[1] ?? 0) | ((block[2] ?? 0) << 8);
      } else if (label === 0xff) {
        const id = subs.blocks[0];
        const payload = subs.blocks[1];
        if (id && isNetscape(id) && payload && payload.length >= 3 && payload[0] === 1) {
          walk.loopCount = (payload[1] ?? 0) | ((payload[2] ?? 0) << 8);
          walk.repeatsForever = walk.loopCount === 0;
        }
      }
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
    const frame = frameShell(walk.frames.length);
    frame.x = u16(bytes, pos);
    frame.y = u16(bytes, pos + 2);
    frame.width = u16(bytes, pos + 4);
    frame.height = u16(bytes, pos + 6);
    const imagePacked = bytes[pos + 8] ?? 0;
    pos += 9;
    frame.interlace = (imagePacked & 0x40) !== 0;
    frame.hasLocalPalette = (imagePacked & 0x80) !== 0;
    if (frame.hasLocalPalette) {
      const colors = 1 << ((imagePacked & 0x07) + 1);
      const tableBytes = colors * 3;
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
    frame.durationMs = pendingDelay * 10;
    frame.disposal = pendingDisposal;
    frame.transparent = pendingTransparent;
    frame.alpha = pendingTransparent;
    if (frame.transparent) {
      walk.hasAlpha = true;
    }
    if (frame.width < 1 || frame.height < 1) {
      hardReason = hardReason ?? 'bad-frame';
    }
    walk.frames.push(frame);
  }

  walk.trailingBytes = sawTrailer ? bytes.length - pos : 0;
  walk.animated = walk.frames.length > 1;
  if (hardReason) {
    walk.ok = false;
    walk.reason = hardReason;
    return walk;
  }
  if (!sawTrailer) {
    walk.ok = false;
    walk.reason = 'missing-trailer';
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

export function naiveGifSeparatorCount(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0x2c) {
      count += 1;
    }
  }
  return count;
}
