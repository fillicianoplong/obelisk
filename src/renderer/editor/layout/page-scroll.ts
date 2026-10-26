// A narrow window opens on the page's left edge. The canvas padding is the
// scrollport padding, so position 0 shows that padding and the left margin.
// A wider window centers the sheet in CSS, and this position stays 0.

export const PAGE_ORIGIN_SCROLL_LEFT = 0;

export interface PageScrollInput {
  /** The reader moved the horizontal scroll off the left edge. */
  userScrolled: boolean;
  scrollLeft: number;
  clientWidth: number;
  /** Caret distance from the scroll origin. Null when the caret is not measured. */
  caretX: number | null;
  caretWidth: number;
}

export function pageHorizontalScrollLeft(input: PageScrollInput): number {
  const base = input.userScrolled ? input.scrollLeft : PAGE_ORIGIN_SCROLL_LEFT;
  if (input.caretX === null || caretInView(base, input.caretX, input.caretWidth, input.clientWidth)) {
    return base;
  }
  return scrollLeftToShowCaret(input.caretX, input.caretWidth, input.clientWidth);
}

function caretInView(scrollLeft: number, caretX: number, caretWidth: number, clientWidth: number): boolean {
  const caretEnd = caretX + caretWidth;
  return caretX >= scrollLeft && caretEnd <= scrollLeft + clientWidth;
}

function scrollLeftToShowCaret(caretX: number, caretWidth: number, clientWidth: number): number {
  const caretEnd = caretX + caretWidth;
  if (caretEnd > clientWidth) {
    return Math.max(PAGE_ORIGIN_SCROLL_LEFT, caretEnd - clientWidth);
  }
  return Math.max(PAGE_ORIGIN_SCROLL_LEFT, caretX);
}

export interface CaretViewportBox {
  left: number;
  right: number;
}

// Keeps the left edge in view. A resize does not move the scroll unless the
// reader has scrolled, or the caret would sit outside the window.
export function bindPageOriginScroll(
  region: HTMLElement,
  caretInViewport: () => CaretViewportBox | null,
): () => void {
  let heldScrollLeft: number | null = null;
  let applying = false;

  const apply = () => {
    if (region.clientWidth <= 0) {
      return;
    }
    const caret = readCaret(region, caretInViewport);
    const next = pageHorizontalScrollLeft({
      userScrolled: heldScrollLeft !== null,
      scrollLeft: heldScrollLeft ?? PAGE_ORIGIN_SCROLL_LEFT,
      clientWidth: region.clientWidth,
      caretX: caret === null ? null : caret.x,
      caretWidth: caret === null ? 0 : caret.width,
    });
    if (region.scrollLeft === next) {
      return;
    }
    applying = true;
    region.scrollLeft = next;
    applying = false;
  };

  const onScroll = (event: Event) => {
    if (applying || !event.isTrusted) {
      return;
    }
    heldScrollLeft = region.scrollLeft > PAGE_ORIGIN_SCROLL_LEFT ? region.scrollLeft : null;
  };

  const onSelection = () => {
    apply();
  };

  const observer = new ResizeObserver(() => {
    apply();
  });
  region.addEventListener('scroll', onScroll);
  region.ownerDocument.addEventListener('selectionchange', onSelection);
  observer.observe(region);
  apply();

  return () => {
    observer.disconnect();
    region.removeEventListener('scroll', onScroll);
    region.ownerDocument.removeEventListener('selectionchange', onSelection);
  };
}

function readCaret(
  region: HTMLElement,
  caretInViewport: () => CaretViewportBox | null,
): { x: number; width: number } | null {
  let box: CaretViewportBox | null;
  try {
    box = caretInViewport();
  } catch {
    return null;
  }
  if (box === null) {
    return null;
  }
  const origin = region.getBoundingClientRect().left + region.clientLeft;
  return {
    x: box.left - origin + region.scrollLeft,
    width: Math.max(0, box.right - box.left),
  };
}
