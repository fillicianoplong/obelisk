import { deflateSync, inflateSync } from 'node:zlib';

export interface PngImage {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  pixels: Uint8Array;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) {
    return left;
  }
  if (upDistance <= diagonal) {
    return up;
  }
  return upLeft;
}

export function readPng(bytes: Uint8Array): PngImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('not a png');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const length = u32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4] ?? 0, bytes[pos + 5] ?? 0, bytes[pos + 6] ?? 0, bytes[pos + 7] ?? 0);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error('truncated png');
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = u32(data, 0);
      height = u32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos = dataEnd + 4;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported png ${bitDepth}/${colorType}/${interlace}`);
  }
  if (width < 1 || height < 1) {
    throw new Error('bad png size');
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of idat) {
    compressed.set(part, offset);
    offset += part.length;
  }
  const raw = inflateSync(compressed);
  const pixels = new Uint8Array(width * height * 4);
  const prior = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  let rawPos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawPos];
    rawPos += 1;
    if (filter === undefined || rawPos + stride > raw.length) {
      throw new Error('truncated png rows');
    }
    const row = raw.subarray(rawPos, rawPos + stride);
    rawPos += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] ?? 0 : 0;
      const up = prior[i] ?? 0;
      const upLeft = i >= channels ? prior[i - channels] ?? 0 : 0;
      const value = row[i] ?? 0;
      let decoded = value;
      if (filter === 1) {
        decoded = (value + left) & 0xff;
      } else if (filter === 2) {
        decoded = (value + up) & 0xff;
      } else if (filter === 3) {
        decoded = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        decoded = (value + paeth(left, up, upLeft)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`bad png filter ${filter}`);
      }
      current[i] = decoded;
    }
    prior.set(current);
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = current[source] ?? 0;
      pixels[target + 1] = current[source + 1] ?? 0;
      pixels[target + 2] = current[source + 2] ?? 0;
      pixels[target + 3] = channels === 4 ? current[source + 3] ?? 0 : 255;
    }
  }
  return { width, height, colorType, bitDepth, pixels };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out[0] = (data.length >>> 24) & 0xff;
  out[1] = (data.length >>> 16) & 0xff;
  out[2] = (data.length >>> 8) & 0xff;
  out[3] = data.length & 0xff;
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out[8 + data.length] = (crc >>> 24) & 0xff;
  out[9 + data.length] = (crc >>> 16) & 0xff;
  out[10 + data.length] = (crc >>> 8) & 0xff;
  out[11 + data.length] = crc & 0xff;
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1);
  }
  const compressed = deflateSync(raw);
  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
