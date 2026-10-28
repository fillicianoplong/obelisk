import { crc32 } from 'node:zlib';

// Small image headers. Frame counts and sizes come from the container, the
// same way spike S-06 counted GIF blocks and WebP chunks, so a 1,001-frame
// GIF and a 250-million-pixel WebP stay a few kilobytes.

export function gifFrames(width, height, frames) {
  const parts = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
  const push16 = (value) => {
    parts.push(value & 0xff, (value >>> 8) & 0xff);
  };
  push16(width);
  push16(height);
  parts.push(0, 0, 0);
  for (const frame of frames) {
    parts.push(0x2c);
    push16(frame.x);
    push16(frame.y);
    push16(frame.width);
    push16(frame.height);
    parts.push(0, 2, 0);
  }
  parts.push(0x3b);
  return Buffer.from(parts);
}

export function pngHeader(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 2;
  const type = Buffer.from('IHDR');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0);
  return Buffer.concat([signature, length, type, data, crc]);
}

export function jpegHeader(width, height) {
  const sofLength = 11;
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    (sofLength >>> 8) & 0xff, sofLength & 0xff,
    8,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    1, 1, 0x11, 0,
  ]);
}

function chunkBytes(tag, data) {
  const pad = data.length & 1;
  const out = Buffer.alloc(8 + data.length + pad);
  out.write(tag, 0, 4, 'ascii');
  out.writeUInt32LE(data.length, 4);
  data.copy(out, 8);
  return out;
}

function webpFile(chunks) {
  const body = Buffer.concat(chunks.map((chunk) => chunkBytes(chunk.tag, chunk.data)));
  const out = Buffer.alloc(12 + body.length);
  out.write('RIFF', 0, 4, 'ascii');
  out.writeUInt32LE(body.length + 4, 4);
  out.write('WEBP', 8, 4, 'ascii');
  body.copy(out, 12);
  return out;
}

function vp8x(width, height, animation) {
  const data = Buffer.alloc(10);
  if (animation) {
    data[0] = 0x02;
  }
  const widthMinus = width - 1;
  const heightMinus = height - 1;
  data[4] = widthMinus & 0xff;
  data[5] = (widthMinus >>> 8) & 0xff;
  data[6] = (widthMinus >>> 16) & 0xff;
  data[7] = heightMinus & 0xff;
  data[8] = (heightMinus >>> 8) & 0xff;
  data[9] = (heightMinus >>> 16) & 0xff;
  return data;
}

function anim() {
  return Buffer.from([255, 255, 255, 255, 0, 0]);
}

function write24(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function vp8KeyHeader(width, height) {
  const payload = Buffer.alloc(10);
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

function anmf(frame, inner) {
  const out = Buffer.alloc(16 + inner.length);
  write24(out, 0, frame.x / 2);
  write24(out, 3, frame.y / 2);
  write24(out, 6, frame.width - 1);
  write24(out, 9, frame.height - 1);
  write24(out, 12, frame.durationMs);
  out[15] = 0x02;
  inner.copy(out, 16);
  return out;
}

export function animatedWebp(count, width, height) {
  const inner = chunkBytes('VP8 ', vp8KeyHeader(width, height));
  const frames = Array.from({ length: count }, () => ({
    tag: 'ANMF',
    data: anmf({ x: 0, y: 0, width, height, durationMs: 20 }, inner),
  }));
  return webpFile([
    { tag: 'VP8X', data: vp8x(width, height, true) },
    { tag: 'ANIM', data: anim() },
    ...frames,
  ]);
}

export function stillWebp(width, height) {
  return webpFile([
    { tag: 'VP8X', data: vp8x(width, height, false) },
    { tag: 'VP8 ', data: vp8KeyHeader(width, height) },
  ]);
}

export const SVG_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
