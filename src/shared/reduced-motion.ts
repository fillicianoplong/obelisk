export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const MOTION_DURATION_MS = {
  instant: 0,
  fast: 83,
  normal: 167,
  slow: 250,
} as const;

export type MotionDurationToken = keyof typeof MOTION_DURATION_MS;

export interface ReducedMotionWindow {
  matchMedia(query: string): { matches: boolean };
}

export interface ReducedMotionRoot {
  dataset: { reducedMotion?: string };
}

export function readReducedMotion(win: ReducedMotionWindow): boolean {
  return win.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function applyReducedMotion(root: ReducedMotionRoot, reduced: boolean): void {
  if (reduced) {
    root.dataset.reducedMotion = '';
    return;
  }
  delete root.dataset.reducedMotion;
}

export function durationMs(token: MotionDurationToken, reduced: boolean): number {
  if (reduced) {
    return 0;
  }
  return MOTION_DURATION_MS[token];
}

/** DOM scroll APIs: keep smooth scrolling off when motion is reduced. */
export function scrollBehaviorOption(reduced: boolean): ScrollBehavior {
  return reduced ? 'auto' : 'auto';
}

/** Animated GIF and WebP assets play in the editor only when motion is allowed (OD-18). */
export function editorAnimatedImagePlays(frameCount: number, reduced: boolean): boolean {
  return !reduced && frameCount > 1;
}