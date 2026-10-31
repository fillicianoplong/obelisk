import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import { dispatchEditorKeyDown, prepareEditorDom, syntheticMouseDown } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(text, blockId = id(3)) {
  return {
    type: 'paragraph',
    id: blockId,
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [{ type: 'text', text }],
  };
}

function documentWithBlocks(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks,
  };
}

async function editorViewFromBlocks(blocks) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(documentWithBlocks(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore, document, window };
}

function handleElement(view, blockIndex) {
  const handle = view.dom.querySelector(`.block-handle[data-block-index="${blockIndex}"]`);
  assert.ok(handle instanceof view.dom.ownerDocument.defaultView.HTMLElement, `block handle ${blockIndex} is missing`);
  return handle;
}

function dispatchHandleMouseDown(view, blockIndex, extra = {}) {
  const handle = handleElement(view, blockIndex);
  handle.dispatchEvent(syntheticMouseDown(extra));
}

test('a handle appears beside the caret block and has no inline style', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const caretHandle = handleElement(view, 0);
    assert.equal(caretHandle.getAttribute('data-caret-block'), 'true');
    assert.equal(caretHandle.hasAttribute('style'), false);
    const other = handleElement(view, 1);
    assert.equal(other.hasAttribute('data-caret-block'), false);
  } finally {
    view.destroy();
    restore();
  }
});

test('clicking a handle selects that block without changing the document', async () => {
  const { selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('Alpha'),
    paragraph('Beta'),
  ]);
  try {
    const before = view.state.doc;
    dispatchHandleMouseDown(view, 1);
    assert.ok(before.eq(view.state.doc));
    assert.equal(selectedBlockCount(view.state), 1);
    assert.equal(view.dom.querySelectorAll('[data-block-selected="true"]').length, 1);
  } finally {
    view.destroy();
    restore();
  }
});

test('Shift+click on handles selects a three-block range', async () => {
  const { selectedBlockRange, selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
    paragraph('Four'),
  ]);
  try {
    dispatchHandleMouseDown(view, 0);
    assert.equal(selectedBlockCount(view.state), 1);
    dispatchHandleMouseDown(view, 2, { shiftKey: true });
    assert.equal(selectedBlockCount(view.state), 3);
    assert.deepEqual(selectedBlockRange(view.state), { from: 0, to: 2 });
    assert.equal(view.dom.querySelectorAll('[data-block-selected="true"]').length, 3);
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape through the editor keymap selects the current block', async () => {
  const { selectedBlockCount, caretBlockIndex } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('First'),
    paragraph('Second'),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(1).nodeSize + 1)));
    assert.equal(caretBlockIndex(view.state), 1);
    dispatchEditorKeyDown(view, 'Escape');
    assert.equal(selectedBlockCount(view.state), 1);
    assert.equal(caretBlockIndex(view.state), 1);
    assert.ok(view.dom.querySelector('[data-block-selected="true"]'));
  } finally {
    view.destroy();
    restore();
  }
});
