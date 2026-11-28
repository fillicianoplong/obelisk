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

const BAD_IMAGE = 'That file is not a supported image.';
const TOO_LARGE = 'That image is too large.';
const SVG = 'SVG images are not supported.';
const DIMENSIONS = 'That image has dimensions this app cannot use.';

export function inspectFileImageBytes(bytes: Uint8Array): InspectFileImageResult {
  if (bytes.byteLength < IMAGE_MIN_BYTES || bytes.byteLength > IMAGE_MAX_BYTES) {
    return {
      status: 'refused',
      reason: 'too-large',
      message: TOO_LARGE,
    };
  }
  const sniffed = sniffImage(bytes);
  if (sniffed === 'svg') {
    return { status: 'refused', reason: 'svg', message: SVG };
  }
  if (sniffed !== 'png' && sniffed !== 'jpeg' && sniffed !== 'gif' && sniffed !== 'webp') {
    return { status: 'refused', reason: 'bad-image', message: BAD_IMAGE };
  }
  const geometry = assessGeometry(measureImage(sniffed, bytes));
  if (!geometry.ok) {
    if (geometry.reason === 'header-too-large') {
      return { status: 'refused', reason: geometry.reason, message: DIMENSIONS };
    }
    return { status: 'refused', reason: geometry.reason, message: BAD_IMAGE };
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