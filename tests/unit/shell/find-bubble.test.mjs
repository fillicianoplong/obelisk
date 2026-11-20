import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { EditorView } from 'prosemirror-view';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { prepareEditorDom } from '../editor/dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const historyUrl = new URL('../../../src/renderer/editor/history/groups.ts', import.meta.url);
const blockCommandsUrl = new URL('../../../src/renderer/editor/block-commands.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);
const findUrl = new URL('../../../src/renderer/editor/find/find-plugin.ts', import.meta.url);
const findBarUrl = new URL('../../../src/renderer/shell/find/FindBar.tsx', import.meta.url);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const savedWindow = globalThis.window;
const savedDocument = globalThis.document;
const primed = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
Object.defineProperty(primed.document, 'oninput', {
  configurable: true,
  writable: true,
  value: null,
});
globalThis.window = primed.window;
globalThis.document = primed.document;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
globalThis.window = savedWindow;
globalThis.document = savedDocument;

function absoluteClasses(css) {
  const names = new Set();
  const pattern = /\.([A-Za-z0-9_-]+)\s*\{[^}]*position:\s*absolute/g;
  for (const match of css.matchAll(pattern)) {
    names.add(match[1]);
  }
  return names;
}

function canvasOffset(page, canvas, absolute) {
  let offset = 0;
  for (const child of page.children) {
    if (child === canvas) {
      return offset;
    }
    const outOfFlow = [...child.classList].some((name) => absolute.has(name));
    if (!outOfFlow) {
      offset += 40;
    }
  }
  throw new Error('The document canvas is not in the page.');
}

function ensureWindowTimers(window) {
  const timers = {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  };
  for (const [name, fn] of Object.entries(timers)) {
    if (typeof window[name] !== 'function') {
      window[name] = fn;
    }
  }
}

function ensureDomFocus(window) {
  const focus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function patchedFocus() {
    if (typeof focus !== 'function') {
      return;
    }
    try {
      focus.call(this);
    } catch {
      // Some DOM stubs reject the focus options the bubble passes.
    }
  };
  const proto = window.HTMLInputElement.prototype;
  if (typeof proto.select !== 'function') {
    proto.select = function select() {};
  }
}

function dispatchKey(target, key, extra = {}) {
  const view = target.ownerDocument?.defaultView ?? globalThis.window;
  const init = {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  };
  const event = new view.KeyboardEvent('keydown', init);
  for (const name of ['key', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
    if (event[name] !== init[name]) {
      Object.defineProperty(event, name, { configurable: true, value: init[name] });
    }
  }
  target.dispatchEvent(event);
}

async function mountedBubble(text) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { markCloseHistoryGroup } = await loadRenderer(historyUrl);
  const { insertTextBlock } = await loadRenderer(blockCommandsUrl);
  const { newBlockId } = await loadRenderer(blockIdUrl);
  const { findCommands } = await loadRenderer(findUrl);
  const { FindBar } = await loadRenderer(findBarUrl);
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  ensureWindowTimers(window);
  ensureDomFocus(window);
  const host = document.createElement('div');
  document.body.append(host);
  const page = document.createElement('section');
  page.className = 'page-region';
  page.dataset.region = 'page';
  document.body.append(page);
  const state = createTabEditorState();
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  view.dom.editorView = view;
  view.dispatch(markCloseHistoryGroup(insertTextBlock(view.state.tr, 'paragraph', newBlockId, { text })));
  const root = createRoot(page);
  const render = async (visible) => {
    await act(async () => {
      root.render(createElement(FindBar, {
        visible,
        onVisibilityChange() {},
      }));
    });
  };
  return {
    act,
    document,
    findCommands,
    page,
    render,
    view,
    window,
    async close() {
      await act(async () => {
        root.unmount();
      });
      view.destroy();
      restore();
    },
  };
}

test('opening the find bubble does not change the document canvas offset', async () => {
  const shellCss = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const findCss = await readFile(path.join(root, 'src/renderer/shell/find/find-bar.css'), 'utf8');
  assert.equal(shellCss.includes('shell-with-find'), false);
  assert.equal(shellCss.includes('--size-find-bar'), false);
  const grid = shellCss.match(/\.shell\s*\{[^}]*grid-template-rows:\s*([^;]+);/);
  assert.ok(grid, 'the shell grid is missing');
  assert.equal(grid[1].includes('find'), false);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*position:\s*absolute/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*top:\s*var\(--space-s\)/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*right:\s*var\(--space-l\)/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*padding:\s*var\(--size-find-padding\)/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*border-radius:\s*var\(--radius-overlay\)/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*background:\s*var\(--color-surface-raised\)/);
  assert.match(findCss, /\.find-bubble\s*\{[^}]*box-shadow:\s*var\(--shadow-menu\)/);
  assert.match(findCss, /\.find-bubble-row\s*\{[^}]*gap:\s*var\(--space-xs\)/);
  assert.equal(findCss.includes('margin-inline-start'), false);
  assert.match(findCss, /\.find-bubble-input\s*\{[^}]*outline:\s*none/);
  assert.match(findCss, /\.find-bubble-field:has\(\.find-bubble-input:focus\)\s*\{[^}]*border-color:\s*var\(--color-accent\)/);
  assert.match(findCss, /\.find-bubble-icon:focus-visible,\s*\n\.find-bubble-toggle:focus-visible\s*\{[^}]*outline:\s*var\(--size-focus-ring\)/);
  const forced = findCss.slice(findCss.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /solid Highlight/);

  const absolute = absoluteClasses(findCss);
  assert.equal(absolute.has('find-bubble'), true);
  const { document, window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  try {
    const page = document.createElement('section');
    page.className = 'page-region';
    const canvas = document.createElement('div');
    canvas.className = 'page-canvas';
    page.append(canvas);
    const before = canvasOffset(page, canvas, absolute);
    const bubble = document.createElement('div');
    bubble.className = 'find-bubble';
    page.insertBefore(bubble, canvas);
    assert.equal(canvasOffset(page, canvas, absolute), before);
    assert.equal(before, 0);
    const inFlow = document.createElement('div');
    page.insertBefore(inFlow, canvas);
    assert.equal(canvasOffset(page, canvas, absolute), 40);
  } finally {
    restore();
  }
});

test('every find bubble button and toggle has an accessible name', async () => {
  const mounted = await mountedBubble('cat one cat two');
  try {
    mounted.findCommands.open(mounted.view, { showReplace: true, query: 'cat' });
    await mounted.render(true);
    const buttons = [...mounted.document.querySelectorAll('.find-bubble button')];
    assert.ok(buttons.length >= 8);
    const names = new Map();
    for (const button of buttons) {
      const label = button.getAttribute('aria-label');
      assert.equal(typeof label, 'string');
      assert.ok(label.trim().length > 0, 'a find bubble button is missing its accessible name');
      names.set(label, button.getAttribute('title'));
    }
    assert.equal(names.get('Hide replace'), 'Hide replace (Ctrl+F)');
    assert.equal(names.get('Match case'), 'Match case');
    assert.equal(names.get('Whole word'), 'Whole word');
    assert.equal(names.get('Previous'), 'Previous (Shift+Enter)');
    assert.equal(names.get('Next'), 'Next (Enter)');
    assert.equal(names.get('Close'), 'Close (Escape)');
    assert.equal(names.get('Replace'), 'Replace (Enter)');
    assert.equal(names.get('Replace all'), 'Replace all (Ctrl+Alt+Enter)');
    assert.equal(mounted.document.querySelector('[aria-label="Match case"]').getAttribute('aria-pressed'), 'false');
    assert.equal(mounted.document.querySelector('[aria-label="Whole word"]').getAttribute('aria-pressed'), 'false');
    assert.equal(mounted.document.querySelector('[aria-label="Whole word"]').classList.contains('find-bubble-toggle-word'), true);
    assert.equal(mounted.document.querySelector('.find-bubble-input').getAttribute('aria-label'), 'Find');
    assert.equal(mounted.document.querySelector('input[type="text"]').getAttribute('aria-label'), 'Replace');
    const bubble = mounted.page.querySelector('.find-bubble');
    assert.equal(bubble.parentElement, mounted.page);
  } finally {
    await mounted.close();
  }
});

test('Enter in the Replace field replaces the current match and moves to the next', async () => {
  const text = 'cat one cat two';
  const mounted = await mountedBubble(text);
  try {
    mounted.findCommands.open(mounted.view, { showReplace: true, query: 'cat' });
    mounted.findCommands.patch(mounted.view, { replacement: 'dog', wholeWord: true });
    await mounted.render(true);
    const find = mounted.document.querySelector('input[type="search"]');
    const replace = mounted.document.querySelector('input[type="text"]');
    assert.ok(find);
    assert.ok(replace);
    find.focus();
    await mounted.act(async () => {
      dispatchKey(find, 'Enter');
    });
    assert.equal(mounted.view.state.doc.textContent, text);
    assert.equal(mounted.findCommands.snapshot(mounted.view.state).currentIndex, 1);
    await mounted.act(async () => {
      dispatchKey(find, 'Enter', { shiftKey: true });
    });
    assert.equal(mounted.view.state.doc.textContent, text);
    assert.equal(mounted.findCommands.snapshot(mounted.view.state).currentIndex, 0);

    replace.focus();
    await mounted.act(async () => {
      dispatchKey(replace, 'Enter');
    });
    assert.equal(mounted.view.state.doc.textContent, 'dog one cat two');
    const after = mounted.findCommands.snapshot(mounted.view.state);
    assert.equal(after.matchCount, 1);
    assert.equal(after.currentIndex, 0);
    await mounted.act(async () => {
      dispatchKey(replace, 'Enter', { ctrlKey: true, altKey: true });
    });
    assert.equal(mounted.view.state.doc.textContent, 'dog one dog two');
  } finally {
    await mounted.close();
  }
});

test('Ctrl+F hides the replace row and Ctrl+H shows it', async () => {
  const mounted = await mountedBubble('cat one cat two');
  try {
    mounted.findCommands.open(mounted.view, { showReplace: false, query: 'cat' });
    await mounted.render(true);
    assert.equal(mounted.document.querySelector('input[type="text"]'), null);
    assert.equal(mounted.document.querySelector('[aria-label="Show replace"]') !== null, true);

    await mounted.act(async () => {
      dispatchKey(mounted.window, 'h', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(mounted.document.querySelector('input[type="text"]'));
    assert.equal(mounted.findCommands.snapshot(mounted.view.state).showReplace, true);

    await mounted.act(async () => {
      dispatchKey(mounted.window, 'f', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(mounted.document.querySelector('input[type="text"]'), null);
    assert.equal(mounted.findCommands.snapshot(mounted.view.state).showReplace, false);
  } finally {
    await mounted.close();
  }
});
