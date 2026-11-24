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
  let win: Window | null = null;
  if (typeof Window !== 'undefined' && target instanceof Window) {
    win = target;
  } else if ('defaultView' in target) {
    win = target.defaultView;
  }
  const stopDisposition = win
    ? watchWindowDisposition(win, options.isOpen, () => {
        (options.onBlur ?? options.onOutside)(new Event('blur'));
      })
    : () => {};
  target.addEventListener('pointerdown', onPress, true);
  target.addEventListener('mousedown', onPress, true);
  target.addEventListener('contextmenu', onPress, true);
  return () => {
    stopDisposition();
    target.removeEventListener('pointerdown', onPress, true);
    target.removeEventListener('mousedown', onPress, true);
    target.removeEventListener('contextmenu', onPress, true);
  };
}

/**
 * Close open menus when the window is minimized, gives focus to another app,
 * or changes size. A hover inside the window is not one of these.
 */
export function watchWindowDisposition(
  target: Window,
  isOpen: () => boolean,
  onChange: () => void,
): () => void {
  const close = (): void => {
    if (isOpen()) {
      onChange();
    }
  };
  const onBlur = (event: Event): void => {
    if (event.target === target) {
      close();
    }
  };
  const onResize = (): void => {
    close();
  };
  const onVisibility = (): void => {
    if (target.document.hidden) {
      close();
    }
  };
  target.addEventListener('blur', onBlur);
  target.addEventListener('resize', onResize);
  target.document.addEventListener('visibilitychange', onVisibility);
  return () => {
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('resize', onResize);
    target.document.removeEventListener('visibilitychange', onVisibility);
  };
}
