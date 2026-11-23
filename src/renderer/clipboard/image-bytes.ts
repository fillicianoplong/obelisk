import { ALT_TEXT_MAX_CHARS, IMAGE_MAX_BYTES, IMAGE_MIN_BYTES } from '../../shared/schema/limits.js';
import type { PastedImageAsset } from './types.js';
import { acceptWalk, sniffImage, walkImage } from './image-walk.js';
import { limitText, stripUnsafe } from './text.js';

export interface InspectedImage {
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  width: number;
  height: number;
  frames: number;
}

const TEXT_WIDTH_IN = 6.5;
const PX_PER_IN = 96;

export function inspectImageBytes(bytes: Uint8Array): InspectedImage | null {
  if (bytes.length < IMAGE_MIN_BYTES || bytes.length > IMAGE_MAX_BYTES) {
    return null;
  }
  const sniffed = sniffImage(bytes);
  if (sniffed !== 'png' && sniffed !== 'jpeg' && sniffed !== 'gif' && sniffed !== 'webp') {
    return null;
  }
  const walked = walkImage(sniffed, bytes);
  if (!acceptWalk(walked)) {
    return null;
  }
  return {
    type: sniffed,
    width: walked.width,
    height: walked.height,
    frames: walked.frames.length,
  };
}

/** Smaller of the pixel width and the default Letter text width, in inches. */
export function displayInches(pixels: number): number {
  const natural = pixels / PX_PER_IN;
  const capped = Math.min(natural, TEXT_WIDTH_IN);
  const rounded = Math.round(capped * 1000) / 1000;
  if (rounded <= 0) {
    return 0.001;
  }
  return rounded;
}

export function cleanAlt(value: string): string {
  const cleaned = stripUnsafe(value).replace(/\s+/g, ' ').trim();
  return limitText(cleaned, ALT_TEXT_MAX_CHARS);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function rememberImage(
  bytes: Uint8Array,
  assets: Map<string, PastedImageAsset>,
): Promise<PastedImageAsset | null> {
  const inspected = inspectImageBytes(bytes);
  if (!inspected) {
    return null;
  }
  const sha256 = await sha256Hex(bytes);
  const existing = assets.get(sha256);
  if (existing) {
    return existing;
  }
  const asset: PastedImageAsset = {
    sha256,
    bytes,
    type: inspected.type,
    pixelWidth: inspected.width,
    pixelHeight: inspected.height,
    frames: inspected.frames,
  };
  assets.set(sha256, asset);
  return asset;
}

/** Image bytes embedded in HTML. Remote, file, and SVG sources are refused. */
export function imageBytesFromDataUrl(value: string): Uint8Array | null {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const meta = (match[1] ?? '').toLowerCase();
  const payload = match[2] ?? '';
  if (meta.includes('svg') || !meta.startsWith('image/')) {
    return null;
  }
  const base64 = meta.split(';').some((part) => part.trim() === 'base64');
  if (base64) {
    const cleaned = payload.replace(/\s/g, '');
    if (cleaned.length === 0 || cleaned.length % 4 === 1) {
      return null;
    }
    const estimated = Math.floor(cleaned.length * 3 / 4);
    if (estimated > IMAGE_MAX_BYTES + 2) {
      return null;
    }
    try {
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      return null;
    }
  }
  if (payload.length > IMAGE_MAX_BYTES) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(payload);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index) & 0xff;
    }
    return bytes;
  } catch {
    return null;
  }
}
