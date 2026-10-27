import { useLayoutEffect } from 'react';
import { bindRegionCycle } from './bind.js';

export function FocusCycle() {
  useLayoutEffect(() => bindRegionCycle(window), []);
  return null;
}
