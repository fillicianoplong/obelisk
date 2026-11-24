export interface MenuPoint {
  left: number;
  top: number;
}

/** Fit a menu to the viewport once. Later hovers must keep this point. */
export function clampedMenuPoint(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): MenuPoint {
  const maxLeft = viewportWidth - width - margin;
  const maxTop = viewportHeight - height - margin;
  return {
    left: clientX > maxLeft ? Math.max(margin, maxLeft) : clientX,
    top: clientY > maxTop ? Math.max(margin, maxTop) : clientY,
  };
}

/** The first measurement wins. A hover or a submenu must not slide the menu. */
export function keepMenuPoint(placed: MenuPoint | null, next: MenuPoint): MenuPoint {
  return placed ?? next;
}
