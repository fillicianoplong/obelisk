/** Shared linkedom setup for EditorView tests that load the color-styles plugin. */

import assert from 'node:assert/strict';

export function stubConstructableStyleSheets(window, document) {
  if (typeof window.CSSStyleSheet === 'function') {
    try {
      const probe = new window.CSSStyleSheet();
      if (probe && 'adoptedStyleSheets' in document) {
        return;
      }
    } catch {
      // Fall through to the stub.
    }
  }
  class TestStyleSheet {
    constructor() {
      this.cssRules = [];
    }

    insertRule(rule, index = 0) {
      this.cssRules.splice(index, 0, { cssText: rule });
      return index;
    }

    deleteRule(index) {
      this.cssRules.splice(index, 1);
    }
  }
  window.CSSStyleSheet = TestStyleSheet;
  Object.defineProperty(document, 'adoptedStyleSheets', {
    configurable: true,
    writable: true,
    value: [],
  });
}

function emptyDomSelection() {
  return {
    rangeCount: 0,
    anchorNode: null,
    focusNode: null,
    anchorOffset: 0,
    focusOffset: 0,
    isCollapsed: true,
    getRangeAt() {
      throw new Error('There is no selection range.');
    },
  };
}

function wireDocumentSelection(document, window) {
  const getSelection = () => emptyDomSelection();
  document.getSelection = getSelection;
  window.getSelection = getSelection;
}

function stubEditorViewport(window) {
  if (typeof window.innerHeight !== 'number') {
    window.innerHeight = 768;
  }
  if (typeof window.innerWidth !== 'number') {
    window.innerWidth = 1024;
  }
  if (typeof window.scrollX !== 'number') {
    window.scrollX = 0;
  }
  if (typeof window.scrollY !== 'number') {
    window.scrollY = 0;
  }
  if (typeof window.scrollTo !== 'function') {
    window.scrollTo = () => {};
  }
}

export function installDomGlobals(document, window) {
  stubEditorViewport(window);
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    KeyboardEvent: globalThis.KeyboardEvent,
    innerHeight: globalThis.innerHeight,
    innerWidth: globalThis.innerWidth,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.innerHeight = window.innerHeight;
  globalThis.innerWidth = window.innerWidth;
  if (document.defaultView !== window) {
    Object.defineProperty(document, 'defaultView', {
      configurable: true,
      writable: true,
      value: window,
    });
  }
  if (window.document !== document) {
    window.document = document;
  }
  if (typeof window.KeyboardEvent === 'function') {
    globalThis.KeyboardEvent = window.KeyboardEvent;
  }
  if (typeof window.getComputedStyle === 'function') {
    globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  } else {
    globalThis.getComputedStyle = () => ({
      getPropertyValue: () => '',
    });
  }
  return () => {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.Node = saved.Node;
    globalThis.HTMLElement = saved.HTMLElement;
    globalThis.KeyboardEvent = saved.KeyboardEvent;
    globalThis.innerHeight = saved.innerHeight;
    globalThis.innerWidth = saved.innerWidth;
    globalThis.getComputedStyle = saved.getComputedStyle;
  };
}

/** Minimal KeyboardEvent shape for prosemirror-keymap / w3c-keyname. */
export function syntheticKeyDown(key, extra = {}) {
  const keyCode = key === 'Tab' ? 9 : key === 'Enter' ? 13 : 0;
  return {
    type: 'keydown',
    key,
    code: key,
    keyCode,
    which: keyCode,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    bubbles: true,
    cancelable: true,
    ...extra,
  };
}

/** Run the same handleKeyDown chain as a keydown on the editor view. */
export function dispatchEditorKeyDown(view, key, extra = {}) {
  const event = syntheticKeyDown(key, extra);
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event));
  assert.equal(handled, true, `the editor did not handle keydown ${key}`);
}

export function prepareEditorDom(document, window) {
  stubConstructableStyleSheets(window, document);
  stubEditorViewport(window);
  wireDocumentSelection(document, window);
  return installDomGlobals(document, window);
}
