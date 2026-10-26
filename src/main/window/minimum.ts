// Effective pixels, the same unit as the 1280 by 800 window.
// At 200% that window has 640 by 400 of room, and the window stops there.

export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;

export const MINIMUM_WINDOW_WIDTH = 640;
export const MINIMUM_WINDOW_HEIGHT = 400;

export interface WindowSize {
  width: number;
  height: number;
}

export function defaultWindowSize(): WindowSize {
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  };
}

export function minimumWindowSize(): WindowSize {
  return {
    width: MINIMUM_WINDOW_WIDTH,
    height: MINIMUM_WINDOW_HEIGHT,
  };
}

// A resize below the minimum stays at 640 by 400. Larger sizes pass through.
export function clampWindowSize(size: WindowSize): WindowSize {
  return {
    width: Math.max(MINIMUM_WINDOW_WIDTH, size.width),
    height: Math.max(MINIMUM_WINDOW_HEIGHT, size.height),
  };
}

export interface MinimumWindowTarget {
  setMinimumSize(width: number, height: number): void;
}

export function applyMinimumWindowSize(window: MinimumWindowTarget): void {
  const minimum = minimumWindowSize();
  window.setMinimumSize(minimum.width, minimum.height);
}
