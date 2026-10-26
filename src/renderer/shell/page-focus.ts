// Chromium matches :focus-visible when a contenteditable is clicked.
// The page ring follows the input that moved focus, so a click leaves the caret as the indicator.

type InputModality = 'keyboard' | 'pointer';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

let modality: InputModality = 'pointer';
let listening = false;

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (MODIFIER_KEYS.has(event.key)) {
    return;
  }
  modality = 'keyboard';
}

function onPointing(event: Event): void {
  modality = 'pointer';
  const page = elementFromTarget(event.target)?.closest('.page-sheet');
  if (page instanceof HTMLElement) {
    page.removeAttribute('data-focus-source');
  }
}

function installPageFocusModality(view: Window): void {
  if (listening) {
    return;
  }
  listening = true;
  view.addEventListener('keydown', onKeyDown, true);
  view.addEventListener('pointerdown', onPointing, true);
  view.addEventListener('mousedown', onPointing, true);
}

export function pageFocusIsKeyboard(): boolean {
  return modality === 'keyboard';
}

export function applyPageFocusSource(page: HTMLElement): void {
  if (modality === 'keyboard' && page.ownerDocument.activeElement === page) {
    page.setAttribute('data-focus-source', 'keyboard');
  } else {
    page.removeAttribute('data-focus-source');
  }
}

export function bindPageFocus(page: HTMLElement): () => void {
  const view = page.ownerDocument.defaultView;
  if (view !== null) {
    installPageFocusModality(view);
  }
  const onFocus = () => {
    applyPageFocusSource(page);
  };
  const onBlur = () => {
    page.removeAttribute('data-focus-source');
  };
  page.addEventListener('focus', onFocus);
  page.addEventListener('blur', onBlur);
  return () => {
    page.removeEventListener('focus', onFocus);
    page.removeEventListener('blur', onBlur);
  };
}
