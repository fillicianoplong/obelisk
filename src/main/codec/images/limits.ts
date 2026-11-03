import {
  ANIMATION_FRAME_MAX,
  ANIMATION_PIXEL_MAX,
  IMAGE_DIMENSION_MAX,
  IMAGE_DIMENSION_MIN,
} from '../../../shared/schema/limits.js';
import type { MeasuredImage } from './measure.js';
import type { ImageReason } from './result.js';

// The same caps spike S-06 applied to the sizes from the container walk.
// The pixel sum uses the larger of the frame box and the coded header, and
// the sum is a bigint so a huge header cannot wrap.

const ORDER: readonly ImageReason[] = [
  'header-too-large',
  'too-many-frames',
  'frame-outside',
  'pixel-budget',
  'bad-image',
];

export type Geometry =
  | { ok: true; width: number; height: number; frames: number }
  | { ok: false; reason: ImageReason };

function first(reasons: ReadonlySet<ImageReason>): ImageReason | null {
  for (const reason of ORDER) {
    if (reasons.has(reason)) {
      return reason;
    }
  }
  return null;
}

export function assessGeometry(measured: MeasuredImage): Geometry {
  const reasons = new Set<ImageReason>();
  if (!measured.ok || measured.sizeMismatch || measured.animationFlagClear) {
    reasons.add('bad-image');
  }
  if (measured.canvasWidth > IMAGE_DIMENSION_MAX || measured.canvasHeight > IMAGE_DIMENSION_MAX) {
    reasons.add('header-too-large');
  }
  if (measured.canvasWidth < IMAGE_DIMENSION_MIN || measured.canvasHeight < IMAGE_DIMENSION_MIN) {
    reasons.add('bad-image');
  }
  if (measured.frames.length > ANIMATION_FRAME_MAX) {
    reasons.add('too-many-frames');
  }
  if (measured.frames.length < 1) {
    reasons.add('bad-image');
  }

  const haveCanvas = measured.canvasWidth >= IMAGE_DIMENSION_MIN && measured.canvasHeight >= IMAGE_DIMENSION_MIN;
  let pixels = 0n;
  for (const frame of measured.frames) {
    if (frame.width < 1 || frame.height < 1) {
      reasons.add('bad-image');
    }
    if (haveCanvas && frame.width >= 1 && frame.height >= 1) {
      const right = frame.x + frame.width;
      const bottom = frame.y + frame.height;
      if (frame.x < 0 || frame.y < 0 || right > measured.canvasWidth || bottom > measured.canvasHeight) {
        reasons.add('frame-outside');
      }
    }
    let areaWidth = frame.width;
    let areaHeight = frame.height;
    if (frame.codedWidth !== null && frame.codedHeight !== null) {
      if (frame.codedWidth > IMAGE_DIMENSION_MAX || frame.codedHeight > IMAGE_DIMENSION_MAX) {
        reasons.add('header-too-large');
      }
      if (frame.codedWidth < 1 || frame.codedHeight < 1) {
        reasons.add('bad-image');
      }
      if (frame.codedWidth !== frame.width || frame.codedHeight !== frame.height) {
        reasons.add('bad-image');
      }
      areaWidth = Math.max(frame.width, frame.codedWidth);
      areaHeight = Math.max(frame.height, frame.codedHeight);
    }
    if (areaWidth > 0 && areaHeight > 0) {
      pixels += BigInt(areaWidth) * BigInt(areaHeight);
    }
  }
  if (pixels > BigInt(ANIMATION_PIXEL_MAX)) {
    reasons.add('pixel-budget');
  }

  const reason = first(reasons);
  if (reason) {
    return { ok: false, reason };
  }
  return {
    ok: true,
    width: measured.canvasWidth,
    height: measured.canvasHeight,
    frames: measured.frames.length,
  };
}
