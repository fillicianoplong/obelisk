// F6 leaves the menu bar without a pointer event. A pointer event would mark
// the page as clicked and hide its keyboard ring.

type LeaveListener = () => void;

const listeners = new Set<LeaveListener>();

export function onMenuRegionLeave(listener: LeaveListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function leaveMenuRegion(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
