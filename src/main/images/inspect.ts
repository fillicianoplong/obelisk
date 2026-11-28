import {
  IMAGE_INSERT_BAD,
  IMAGE_INSERT_DIMENSIONS,
  IMAGE_INSERT_SVG,
  IMAGE_INSERT_TOO_LARGE,
} from '../../shared/images/messages.js';
import { IMAGE_MAX_BYTES, IMAGE_MIN_BYTES } from '../../shared/schema/limits.js';
import { assessGeometry } from '../codec/images/limits.js';
import { measureImage } from '../codec/images/measure.js';
import { sniffImage } from '../codec/images/sniff.js';

export interface InspectedFileImage {
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  width: number;
  height: number;
  frames: number;
}

export type InspectFileImageResult =
  | { status: 'ok'; inspected: InspectedFileImage }
  | { status: 'refused'; reason: string; message: string };

export function inspectFileImageBytes(bytes: Uint8Array): InspectFileImageResult {
  if (bytes.byteLength < IMAGE_MIN_BYTES || bytes.byteLength > IMAGE_MAX_BYTES) {
    return {
      status: 'refused',
      reason: 'too-large',
      message: IMAGE_INSERT_TOO_LARGE,
    };
  }
  const sniffed = sniffImage(bytes);
  if (sniffed === 'svg') {
    return { status: 'refused', reason: 'svg', message: IMAGE_INSERT_SVG };
  }
  if (sniffed !== 'png' && sniffed !== 'jpeg' && sniffed !== 'gif' && sniffed !== 'webp') {
    return { status: 'refused', reason: 'bad-image', message: IMAGE_INSERT_BAD };
  }
  const geometry = assessGeometry(measureImage(sniffed, bytes));
  if (!geometry.ok) {
    if (geometry.reason === 'header-too-large') {
      return { status: 'refused', reason: geometry.reason, message: IMAGE_INSERT_DIMENSIONS };
    }
    return { status: 'refused', reason: geometry.reason, message: IMAGE_INSERT_BAD };
  }
  return {
    status: 'ok',
    inspected: {
      type: sniffed,
      width: geometry.width,
      height: geometry.height,
      frames: geometry.frames,
    },
  };
}