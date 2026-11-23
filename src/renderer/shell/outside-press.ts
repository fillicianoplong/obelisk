/**
 * Shared outside-press rule for popup menus (grip menu, slash menu).
 * Listens on the window in the capture phase, so a handler that stops the
 * event, or a pointerdown whose default is prevented (which skips mousedown),
 * cannot keep the menu open. A right-click elsewhere and the window losing
 * focus close it too.
 */
export interface OutsidePressOptions {
  /** Whether the menu is open right now. Closed menus ignore every event. */
  isOpen(): boolean;
  /** True when the event should not close the menu (a press inside it). */
  isInside(target: Node | null, event: Event): boolean;
  /** Close for a press or right-click outside. */
  onOutside(event: Event): void;
  /** Close when the window loses focus. Defaults to onOutside. */
  onBlur?(event: Event): void;
}

export function watchOutsidePress(target: Window | Document, options: OutsidePressOptions): () => void {
  const onPress = (event: Event): void => {
    if (!options.isOpen()) {
      return;
    }
    const node = event.target instanceof Node ? event.target : null;
    if (options.isInside(node, event)) {
      return;
    }
    options.onOutside(event);
  };
  const onBlur = (event: Event): void => {
    // Focus moving between elements inside the page also fires blur on
    // elements, but only the window's own blur reaches this listener.
    if (event.target !== target || !options.isOpen()) {
      return;
    }
    (options.onBlur ?? options.onOutside)(event);
  };
  target.addEventListener('pointerdown', onPress, true);
  target.addEventListener('mousedown', onPress, true);
  target.addEventListener('contextmenu', onPress, true);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('pointerdown', onPress, true);
    target.removeEventListener('mousedown', onPress, true);
    target.removeEventListener('contextmenu', onPress, true);
    target.removeEventListener('blur', onBlur);
  };
}
