import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from './load-renderer.mjs';

const pageScrollUrl = new URL('../../../src/renderer/editor/layout/page-scroll.ts', import.meta.url);

test('a narrow page starts at the left edge unless the reader scrolled or the caret is outside', async () => {
  const { PAGE_ORIGIN_SCROLL_LEFT, pageHorizontalScrollLeft } = await loadRenderer(pageScrollUrl);
  assert.equal(PAGE_ORIGIN_SCROLL_LEFT, 0);

  const origin = pageHorizontalScrollLeft({
    userScrolled: false,
    scrollLeft: 120,
    clientWidth: 640,
    caretX: 140,
    caretWidth: 0,
  });
  assert.equal(origin, 0);

  const wide = pageHorizontalScrollLeft({
    userScrolled: false,
    scrollLeft: 0,
    clientWidth: 1280,
    caretX: 500,
    caretWidth: 1,
  });
  assert.equal(wide, 0);

  const held = pageHorizontalScrollLeft({
    userScrolled: true,
    scrollLeft: 80,
    clientWidth: 640,
    caretX: 200,
    caretWidth: 0,
  });
  assert.equal(held, 80);

  const follow = pageHorizontalScrollLeft({
    userScrolled: false,
    scrollLeft: 0,
    clientWidth: 640,
    caretX: 900,
    caretWidth: 0,
  });
  assert.equal(follow, 260);

  const followHeld = pageHorizontalScrollLeft({
    userScrolled: true,
    scrollLeft: 80,
    clientWidth: 640,
    caretX: 900,
    caretWidth: 0,
  });
  assert.equal(followHeld, 260);

  const unknown = pageHorizontalScrollLeft({
    userScrolled: false,
    scrollLeft: 40,
    clientWidth: 640,
    caretX: null,
    caretWidth: 0,
  });
  assert.equal(unknown, 0);
});

test('resize keeps the left edge, and a reader scroll is kept', async () => {
  const { bindPageOriginScroll } = await loadRenderer(pageScrollUrl);
  const previous = globalThis.ResizeObserver;
  let resize = () => {};
  let watching = true;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resize = () => {
        if (watching) {
          callback();
        }
      };
    }

    observe() {}

    disconnect() {
      watching = false;
    }
  };

  const scrollListeners = new Set();
  const selectionListeners = new Set();
  let caretContentX = 160;
  const region = {
    clientWidth: 640,
    clientLeft: 0,
    scrollValue: 180,
    get scrollLeft() {
      return this.scrollValue;
    },
    set scrollLeft(value) {
      this.scrollValue = value;
      for (const listener of scrollListeners) {
        listener({ isTrusted: false });
      }
    },
    getBoundingClientRect() {
      return { left: 8 };
    },
    addEventListener(_type, listener) {
      scrollListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      scrollListeners.delete(listener);
    },
    ownerDocument: {
      addEventListener(_type, listener) {
        selectionListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        selectionListeners.delete(listener);
      },
    },
  };

  try {
    const unbind = bindPageOriginScroll(region, () => {
      const left = 8 + caretContentX - region.scrollValue;
      return { left, right: left };
    });
    assert.equal(region.scrollLeft, 0);

    region.scrollValue = 210;
    resize();
    assert.equal(region.scrollLeft, 0);

    region.scrollValue = 96;
    for (const listener of scrollListeners) {
      listener({ isTrusted: true });
    }
    region.scrollValue = 240;
    resize();
    assert.equal(region.scrollLeft, 96);

    caretContentX = 900;
    for (const listener of selectionListeners) {
      listener({ isTrusted: true });
    }
    assert.equal(region.scrollLeft, 260);

    unbind();
    region.scrollValue = 400;
    resize();
    assert.equal(region.scrollLeft, 400);
  } finally {
    if (previous === undefined) {
      delete globalThis.ResizeObserver;
    } else {
      globalThis.ResizeObserver = previous;
    }
  }
});
