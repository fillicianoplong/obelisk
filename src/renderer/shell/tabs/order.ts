export type TabCycleDirection = 1 | -1;

export type TabFocusKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

function requireTab(ids: readonly string[], id: string): number {
  const index = ids.indexOf(id);
  if (index === -1) {
    throw new RangeError(`Unknown tab ${id}.`);
  }
  return index;
}

/**
 * Ctrl+Tab moves to the next tab and Ctrl+Shift+Tab to the previous one.
 * Both wrap at the ends.
 */
export function tabAfterCycle(
  ids: readonly string[],
  activeId: string,
  direction: TabCycleDirection,
): string {
  if (ids.length === 0) {
    throw new RangeError('There are no tabs to cycle.');
  }
  const index = requireTab(ids, activeId);
  const next = (index + direction) % ids.length;
  return ids[next < 0 ? next + ids.length : next];
}

/**
 * Left and Right move to the neighbor and stop at the ends.
 * Home and End jump to the first and last tab.
 */
export function tabAfterFocusKey(ids: readonly string[], focusedId: string, key: TabFocusKey): string {
  if (ids.length === 0) {
    throw new RangeError('There are no tabs to focus.');
  }
  const index = requireTab(ids, focusedId);
  if (key === 'Home') {
    return ids[0];
  }
  if (key === 'End') {
    return ids[ids.length - 1];
  }
  if (key === 'ArrowRight') {
    return ids[Math.min(index + 1, ids.length - 1)];
  }
  return ids[Math.max(index - 1, 0)];
}
