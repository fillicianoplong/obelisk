import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { loadRenderer } from './load-renderer.mjs';
import { dispatchEditorKeyDown, prepareEditorDom, syntheticKeyDown } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function documentWith(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks,
  };
}

function paragraph(text) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [{ type: 'text', text }],
  };
}

async function editorView(blocks) {
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(documentWith(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore };
}

function codeText(view) {
  return view.state.doc.child(0).textContent;
}

test('code blocks show tabs at tab-size 4', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.page-sheet pre\[data-code-block\]\s*\{[^}]*tab-size:\s*4;/);
});

test('Tab inserts a tab at the caret in a code block', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'abc' },
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 2)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(codeText(view), 'a\tbc');
    assert.equal(view.dom.querySelector('code').textContent, 'a\tbc');
  } finally {
    view.destroy();
    restore();
  }
});

test('Tab on one selected line replaces that selection with a tab', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'abc' },
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(codeText(view), 'a\tc');
  } finally {
    view.destroy();
    restore();
  }
});

test('Tab prefixes each line of a multi-line code selection', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'one\ntwo\nthree' },
  ]);
  try {
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(codeText(view), '\tone\n\ttwo\n\tthree');
  } finally {
    view.destroy();
    restore();
  }
});

test('Shift+Tab removes one leading tab or up to four leading spaces', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: '\tone\n    two\n  three\n        four\nplain' },
  ]);
  try {
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end)));
    dispatchEditorKeyDown(view, 'Tab', { shiftKey: true });
    assert.equal(codeText(view), 'one\ntwo\nthree\n    four\nplain');
  } finally {
    view.destroy();
    restore();
  }
});

test('Shift+Tab on the caret line does not change the other lines', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: '\tone\n    two' },
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 2)));
    dispatchEditorKeyDown(view, 'Tab', { shiftKey: true });
    assert.equal(codeText(view), 'one\n    two');
  } finally {
    view.destroy();
    restore();
  }
});

test('copy keeps tab characters and paste keeps tabs and spaces', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'a\tb  c' },
  ]);
  try {
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end)));
    const owner = view.dom.ownerDocument;
    const implementation = owner.implementation ?? {};
    implementation.createHTMLDocument = () => parseHTML('<!doctype html><html><body></body></html>').document;
    Object.defineProperty(owner, 'implementation', { configurable: true, value: implementation });
    Object.defineProperty(view.dom.ownerDocument.defaultView, 'document', { configurable: true, value: owner });
    const store = new Map();
    const event = new view.dom.ownerDocument.defaultView.Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = {
      clearData() {
        store.clear();
      },
      setData(type, value) {
        store.set(type, value);
      },
      getData(type) {
        return store.get(type) ?? '';
      },
    };
    view.dom.dispatchEvent(event);
    assert.equal(store.get('text/plain').includes('\t'), true);
    assert.equal(store.get('text/plain').includes('  '), true);
    assert.equal(store.get('text/plain').includes('a\tb  c'), true);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end, end)));
    if (typeof globalThis.ClipboardEvent !== 'function') {
      globalThis.ClipboardEvent = view.dom.ownerDocument.defaultView.Event;
    }
    view.pasteText('x\ty  z');
    assert.equal(codeText(view).includes('x\ty  z'), true);
    assert.equal(view.state.doc.child(0).type.name, 'code_block');
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape selects the code block, and Tab from there is not handled', async () => {
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'keep' },
    paragraph('After'),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 2)));
    dispatchEditorKeyDown(view, 'Escape');
    assert.deepEqual(selectedBlockRange(view.state), { from: 0, to: 0 });
    assert.equal(view.state.selection instanceof NodeSelection, true);
    const before = codeText(view);
    const handled = view.someProp('handleKeyDown', (handler) => handler(view, syntheticKeyDown('Tab')));
    assert.equal(handled, undefined);
    assert.equal(codeText(view), before);
    assert.equal(view.state.selection instanceof NodeSelection, true);
  } finally {
    view.destroy();
    restore();
  }
});

test('Tab in a paragraph still indents when a code block is in the document', async () => {
  const { view, restore } = await editorView([
    { type: 'code', id: id(4), text: 'keep' },
    paragraph('After'),
  ]);
  try {
    const paragraphPos = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paragraphPos, paragraphPos)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(view.state.doc.child(0).textContent, 'keep');
    assert.equal(view.state.doc.child(1).attrs.indentFirst, 0.5);
  } finally {
    view.destroy();
    restore();
  }
});
