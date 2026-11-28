import { useLayoutEffect } from 'react';
import {
  REDUCED_MOTION_QUERY,
  applyReducedMotion,
  readReducedMotion,
} from '../../../shared/reduced-motion.js';

// Mirrors Windows Show animations through prefers-reduced-motion on :root.
export function ReducedMotionSync() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      applyReducedMotion(root, readReducedMotion(window));
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }, []);
  return null;
}