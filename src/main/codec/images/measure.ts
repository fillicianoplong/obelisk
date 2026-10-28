import { walkGif } from './gif.js';
import { readJpegSize } from './jpeg.js';
import { readPngSize } from './png.js';
import { walkWebp } from './webp.js';

// One measured image: the canvas, each frame's box, and any coded size the
// container header declared. Built from the header walk, not from pixels.

export interface MeasuredFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  codedWidth: number | null;
  codedHeight: number | null;
}

export interface MeasuredImage {
  ok: boolean;
  canvasWidth: number;
  canvasHeight: number;
  frames: MeasuredFrame[];
  sizeMismatch: boolean;
  animationFlagClear: boolean;
}

function failed(): MeasuredImage {
  return {
    ok: false,
    canvasWidth: 0,
    canvasHeight: 0,
    frames: [],
    sizeMismatch: false,
    animationFlagClear: false,
  };
}

function fromRaster(width: number, height: number): MeasuredImage {
  return {
    ok: true,
    canvasWidth: width,
    canvasHeight: height,
    frames: [{ x: 0, y: 0, width, height, codedWidth: null, codedHeight: null }],
    sizeMismatch: false,
    animationFlagClear: false,
  };
}

export function measureImage(type: 'png' | 'jpeg' | 'gif' | 'webp', bytes: Uint8Array): MeasuredImage {
  if (type === 'png') {
    const header = readPngSize(bytes);
    return header.ok ? fromRaster(header.size.width, header.size.height) : failed();
  }
  if (type === 'jpeg') {
    const header = readJpegSize(bytes);
    return header.ok ? fromRaster(header.size.width, header.size.height) : failed();
  }
  if (type === 'gif') {
    const walk = walkGif(bytes);
    return {
      ok: walk.ok,
      canvasWidth: walk.canvasWidth,
      canvasHeight: walk.canvasHeight,
      frames: walk.frames.map((frame) => ({
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        codedWidth: null,
        codedHeight: null,
      })),
      sizeMismatch: false,
      animationFlagClear: false,
    };
  }
  const walk = walkWebp(bytes);
  return {
    ok: walk.ok,
    canvasWidth: walk.canvasWidth,
    canvasHeight: walk.canvasHeight,
    frames: walk.frames,
    sizeMismatch: walk.sizeMismatch,
    animationFlagClear: walk.animationFlagClear,
  };
}
