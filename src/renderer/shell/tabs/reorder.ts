/** Squared distance past which a tab press counts as a drag, not a click. */
export const TAB_DRAG_START_PX = 4;

export function tabDragExceeded(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= TAB_DRAG_START_PX * TAB_DRAG_START_PX;
}

export interface TabBox {
  id: string;
  left: number;
  right: number;
}

/** Target index in the full tab list for the dragged tab. */
export function dropIndexFromPointer(
  tabs: readonly TabBox[],
  draggedId: string,
  clientX: number,
): number {
  const from = tabs.findIndex((tab) => tab.id === draggedId);
  if (from === -1) {
    return from;
  }
  const dragged = tabs[from];
  if (clientX >= dragged.left && clientX <= dragged.right) {
    return from;
  }
  const others = tabs.filter((tab) => tab.id !== draggedId);
  if (others.length === 0) {
    return from;
  }
  let slot = others.length;
  for (let index = 0; index < others.length; index += 1) {
    const tab = others[index];
    const mid = (tab.left + tab.right) / 2;
  if (clientX < mid) {
      slot = index;
      break;
    }
  }
  if (slot === others.length) {
    return tabs.length;
  }
  let seen = 0;
  for (let index = 0; index < tabs.length; index += 1) {
    if (tabs[index].id === draggedId) {
      continue;
    }
    if (seen === slot) {
      return index;
    }
    seen += 1;
  }
  return from;
}

export function reorderTabIds(ids: readonly string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveTabKeyboard(ids: readonly string[], tabId: string, delta: -1 | 1): string[] | null {
  const index = ids.indexOf(tabId);
  if (index === -1) {
    return null;
  }
  const target = index + delta;
  if (target < 0 || target >= ids.length) {
    return null;
  }
  return reorderTabIds(ids, index, target);
}

/** Scroll an overflowing tab list while dragging near its horizontal edges. */
export function scrollTabsFromDragEdge(
  list: { scrollWidth: number; clientWidth: number; scrollLeft: number },
  listRect: { left: number; right: number },
  clientX: number,
  edgePx = 48,
  stepPx = 16,
): void {
  if (list.scrollWidth <= list.clientWidth) {
    return;
  }
  const nearLeft = clientX < listRect.left + edgePx;
  const nearRight = clientX > listRect.right - edgePx;
  if (nearLeft) {
    list.scrollLeft = Math.max(0, list.scrollLeft - stepPx);
  } else if (nearRight) {
    const max = list.scrollWidth - list.clientWidth;
    list.scrollLeft = Math.min(max, list.scrollLeft + stepPx);
  }
}