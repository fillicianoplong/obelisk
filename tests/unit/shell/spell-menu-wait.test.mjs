import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { prepareEditorDom } from '../editor/dom-test-helpers.mjs';

const pluginUrl = new URL('../../../src/renderer/shell/contextmenu/editor-plugin.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const modeUrl = new URL('../../../src/renderer/editor/spellcheck-mode.ts', import.meta.url);

test('the text menu reads the misspelled word under the caret', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const buckets = new Map();
  void window.addEventListener;
  void window.dispatchEvent;
  window.addEventListener = (type, fn) => {
    const list = buckets.get(type) ?? [];
    list.push(fn);
    buckets.set(type, list);
  };
  window.dispatchEvent = (event) => {
    for (const fn of buckets.get(event.type) ?? []) {
      fn(event);
    }
    return true;
  };
  window.obelisk = {
    'spell:suggest': (request) => Promise.resolve(request.word === 'hllo'
      ? { status: 'ok', misspelled: true, suggestions: ['hello', 'hollo', 'hallo', 'hullo', 'halo', 'extra'] }
      : { status: 'ok', misspelled: false, suggestions: [] }),
    'spell:check': () => Promise.resolve({ status: 'ok', misspelled: [] }),
  };
  const opened = [];
  window.addEventListener('obelisk:context-menu-request', (event) => {
    opened.push(event.detail);
  });
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { publishContextMenu } = await loadRenderer(pluginUrl);
  const { setSpellcheckEnabled } = await loadRenderer(modeUrl);
  setSpellcheckEnabled(true);
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView(host, {
    state: insertText(createTabEditorState(), 'Say hllo there'),
    attributes: { class: 'page-sheet', spellcheck: 'true' },
  });
  try {
    assert.equal(view.dom.getAttribute('spellcheck'), 'false');
    const hllo = view.state.doc.textContent.indexOf('hllo');
    const inside = 1 + hllo + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    await publishContextMenu(view, {
      tabId: 'tab-1',
      kind: 'text',
      blockType: 'paragraph',
      blockIndex: 0,
      clientX: 12,
      clientY: 12,
      keyboard: false,
      selectionAnchor: inside,
      selectionHead: inside,
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].spelling.word, 'hllo');
    assert.deepEqual(opened[0].spelling.suggestions, ['hello', 'hollo', 'hallo', 'hullo', 'halo']);
    setSpellcheckEnabled(false);
    opened.length = 0;
    await publishContextMenu(view, {
      tabId: 'tab-1',
      kind: 'text',
      blockType: 'paragraph',
      blockIndex: 0,
      clientX: 12,
      clientY: 12,
      keyboard: false,
      selectionAnchor: inside,
      selectionHead: inside,
    });
    assert.equal(opened[0].spelling, null);
    assert.equal(view.dom.getAttribute('spellcheck'), 'false');
  } finally {
    setSpellcheckEnabled(true);
    view.destroy();
    restore();
  }
});

test('spelling underlines use the highlight rule', async () => {
  const css = await readFile(new URL('../../../src/renderer/editor/editor.css', import.meta.url), 'utf8');
  assert.match(css, /::highlight\(obk-spelling\) \{[^}]*text-decoration-style:\s*wavy/);
  assert.match(css, /::highlight\(obk-spelling\) \{[^}]*text-decoration-color:\s*var\(--color-spelling\)/);
});
