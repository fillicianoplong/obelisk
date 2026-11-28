import {
  REDUCED_MOTION_QUERY,
  applyReducedMotion,
  readReducedMotion,
} from '../shared/reduced-motion.js';

export interface ReducedMotionMedia {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ReducedMotionInstallTarget {
  documentElement: { dataset: { reducedMotion?: string } };
  matchMedia(query: string): ReducedMotionMedia;
}

export function installReducedMotion(target: ReducedMotionInstallTarget | null): void {
  if (target === null) {
    return;
  }
  const root = target.documentElement;
  const media = target.matchMedia(REDUCED_MOTION_QUERY);
  const sync = () => {
    applyReducedMotion(root, readReducedMotion(target));
  };
  sync();
  media.addEventListener('change', sync);
}