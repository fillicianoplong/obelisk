export interface WalkFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  disposal: number | null;
  blend: number | null;
  transparent: boolean;
  interlace: boolean;
  hasLocalPalette: boolean;
  bitstreamWidth: number | null;
  bitstreamHeight: number | null;
  alpha: boolean;
  lossless: boolean | null;
}

export interface ImageWalk {
  format: 'gif' | 'webp';
  ok: boolean;
  reason: string | null;
  canvasWidth: number;
  canvasHeight: number;
  frames: WalkFrame[];
  loopCount: number | null;
  repeatsForever: boolean;
  animated: boolean;
  hasAlpha: boolean;
  trailingBytes: number;
  framesPastContainer: number;
  decodedPixelBytes: 0;
  notes: string[];
}

export function emptyWalk(format: 'gif' | 'webp', reason: string): ImageWalk {
  return {
    format,
    ok: false,
    reason,
    canvasWidth: 0,
    canvasHeight: 0,
    frames: [],
    loopCount: null,
    repeatsForever: false,
    animated: false,
    hasAlpha: false,
    trailingBytes: 0,
    framesPastContainer: 0,
    decodedPixelBytes: 0,
    notes: [],
  };
}

export function frameShell(index: number): WalkFrame {
  return {
    index,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    durationMs: 0,
    disposal: null,
    blend: null,
    transparent: false,
    interlace: false,
    hasLocalPalette: false,
    bitstreamWidth: null,
    bitstreamHeight: null,
    alpha: false,
    lossless: null,
  };
}
