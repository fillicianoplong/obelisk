export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function chunkBytes(tag: string, data: Uint8Array): Uint8Array {
  if (tag.length !== 4) {
    throw new Error(`chunk tag must be 4 characters: ${tag}`);
  }
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let index = 0; index < 4; index += 1) {
    out[index] = tag.charCodeAt(index);
  }
  const size = data.length;
  out[4] = size & 0xff;
  out[5] = (size >>> 8) & 0xff;
  out[6] = (size >>> 16) & 0xff;
  out[7] = (size >>> 24) & 0xff;
  out.set(data, 8);
  return out;
}

export function webpFile(chunks: Array<{ tag: string; data: Uint8Array }>): Uint8Array {
  const body = concat(chunks.map((chunk) => chunkBytes(chunk.tag, chunk.data)));
  const out = new Uint8Array(12 + body.length);
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46;
  const size = body.length + 4;
  out[4] = size & 0xff;
  out[5] = (size >>> 8) & 0xff;
  out[6] = (size >>> 16) & 0xff;
  out[7] = (size >>> 24) & 0xff;
  out[8] = 0x57;
  out[9] = 0x45;
  out[10] = 0x42;
  out[11] = 0x50;
  out.set(body, 12);
  return out;
}

export function vp8xData(options: {
  width: number;
  height: number;
  animation?: boolean;
  alpha?: boolean;
}): Uint8Array {
  const data = new Uint8Array(10);
  let flags = 0;
  if (options.animation) {
    flags |= 0x02;
  }
  if (options.alpha) {
    flags |= 0x10;
  }
  data[0] = flags;
  const widthMinus = options.width - 1;
  const heightMinus = options.height - 1;
  data[4] = widthMinus & 0xff;
  data[5] = (widthMinus >>> 8) & 0xff;
  data[6] = (widthMinus >>> 16) & 0xff;
  data[7] = heightMinus & 0xff;
  data[8] = (heightMinus >>> 8) & 0xff;
  data[9] = (heightMinus >>> 16) & 0xff;
  return data;
}

export function animData(loop: number): Uint8Array {
  const data = Uint8Array.from([255, 255, 255, 255, loop & 0xff, (loop >>> 8) & 0xff]);
  return data;
}

export function vp8KeyHeader(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = 0x10;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload[6] = width & 0xff;
  payload[7] = (width >>> 8) & 0x3f;
  payload[8] = height & 0xff;
  payload[9] = (height >>> 8) & 0x3f;
  return payload;
}

export function anmfData(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  inner: Uint8Array;
}): Uint8Array {
  const out = new Uint8Array(16 + frame.inner.length);
  write24(out, 0, frame.x / 2);
  write24(out, 3, frame.y / 2);
  write24(out, 6, frame.width - 1);
  write24(out, 9, frame.height - 1);
  write24(out, 12, frame.durationMs);
  out[15] = 0x02;
  out.set(frame.inner, 16);
  return out;
}

function write24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

export function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

export function bareGif(options: {
  width: number;
  height: number;
  frames: Array<{ x: number; y: number; width: number; height: number }>;
}): Uint8Array {
  const parts: number[] = [];
  const push16 = (value: number): void => {
    parts.push(value & 0xff, (value >>> 8) & 0xff);
  };
  parts.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  push16(options.width);
  push16(options.height);
  parts.push(0, 0, 0);
  for (const frame of options.frames) {
    parts.push(0x2c);
    push16(frame.x);
    push16(frame.y);
    push16(frame.width);
    push16(frame.height);
    parts.push(0, 2, 0);
  }
  parts.push(0x3b);
  return Uint8Array.from(parts);
}

export function gifExtension(label: number, blocks: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x21, label)];
  for (const block of blocks) {
    if (block.length > 255) {
      throw new Error('GIF sub-block is longer than 255 bytes');
    }
    parts.push(Uint8Array.of(block.length), block);
  }
  parts.push(Uint8Array.of(0));
  return concat(parts);
}
