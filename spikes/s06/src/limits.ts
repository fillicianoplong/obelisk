import type { ImageWalk } from './image-info';

export const MAX_DIMENSION = 8000;
export const MAX_FRAMES = 1000;
export const MAX_PIXELS = 250_000_000;

export interface LimitVerdict {
  accept: boolean;
  reasons: string[];
  pixelCount: string;
}

export function assess(walk: ImageWalk): LimitVerdict {
  const reasons: string[] = [];
  if (!walk.ok) {
    reasons.push(walk.reason ?? 'not-well-formed');
  } else if (walk.frames.length === 0) {
    reasons.push('no-frames');
  }
  const haveCanvas = walk.canvasWidth > 0 && walk.canvasHeight > 0;
  if (
    haveCanvas &&
    (walk.canvasWidth > MAX_DIMENSION ||
      walk.canvasHeight > MAX_DIMENSION ||
      walk.canvasWidth < 1 ||
      walk.canvasHeight < 1)
  ) {
    reasons.push('bad-canvas');
  }
  if (walk.frames.length > MAX_FRAMES) {
    reasons.push('too-many-frames');
  }
  let pixels = 0n;
  let badFrame = false;
  let outside = false;
  let bitstreamOversize = false;
  let mismatch = false;
  for (const frame of walk.frames) {
    if (frame.width < 1 || frame.height < 1) {
      badFrame = true;
    }
    if (haveCanvas && frame.width >= 1 && frame.height >= 1) {
      const right = frame.x + frame.width;
      const bottom = frame.y + frame.height;
      if (frame.x < 0 || frame.y < 0 || right > walk.canvasWidth || bottom > walk.canvasHeight) {
        outside = true;
      }
    }
    const codedWidth = frame.bitstreamWidth;
    const codedHeight = frame.bitstreamHeight;
    let areaWidth = frame.width;
    let areaHeight = frame.height;
    if (codedWidth !== null && codedHeight !== null) {
      if (codedWidth > MAX_DIMENSION || codedHeight > MAX_DIMENSION || codedWidth < 1 || codedHeight < 1) {
        bitstreamOversize = true;
      }
      if (codedWidth !== frame.width || codedHeight !== frame.height) {
        mismatch = true;
      }
      areaWidth = Math.max(frame.width, codedWidth);
      areaHeight = Math.max(frame.height, codedHeight);
    }
    if (areaWidth > 0 && areaHeight > 0) {
      pixels += BigInt(areaWidth) * BigInt(areaHeight);
    }
  }
  if (badFrame) {
    reasons.push('bad-frame');
  }
  if (outside) {
    reasons.push('frame-outside');
  }
  if (bitstreamOversize) {
    reasons.push('bitstream-oversize');
  }
  if (mismatch) {
    reasons.push('size-mismatch');
  }
  if (pixels > BigInt(MAX_PIXELS)) {
    reasons.push('pixel-budget');
  }
  const unique = [...new Set(reasons)].sort();
  return {
    accept: unique.length === 0,
    reasons: unique,
    pixelCount: pixels.toString(),
  };
}
