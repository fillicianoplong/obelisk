import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { undoDepth, undo } from 'prosemirror-history';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import {
  dispatchEditorKeyDown,
  prepareEditorDom,
  syntheticMouseDown,
  syntheticMouseMove,
  syntheticMouseUp,
} from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);

/** @type {Awaited<ReturnType<typeof loadRenderer>>} */
let blockHandleModule;

test.before(async () => {
  blockHandleModule = await loadRenderer(blockHandleUrl);
});

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
  const shellCss = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${shellCss}\n${css}`;
  document.head.append(style);
  const region = document.createElement('div');
  region.className = 'page-region';
  const host = document.createElement('div');
  region.append(host);
  document.body.append(region);
  const state = createTabEditorState(editorDocFromDocument(documentWithBlocks(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore, document, window };
}

function handleRoot(view) {
  return view.dom.closest('.page-region') ?? view.dom.parentElement ?? view.dom;
}

function visibleHandleCount(view) {
  const handles = handleRoot(view).querySelectorAll('.block-handle-layer .block-handle');
  return [...handles].filter((handle) => !handle.hidden).length;
}

function handleElement(view, blockIndex) {
  blockHandleModule.setBlockHandleHover(view, blockIndex);
  const handle = handleRoot(view).querySelector(
    `.block-handle-layer .block-handle[data-block-index="${blockIndex}"]`,
  );
  assert.ok(handle instanceof view.dom.ownerDocument.defaultView.HTMLElement, `block handle ${blockIndex} is missing`);
  return handle;
}

function dispatchHandleMouseDown(view, blockIndex, extra = {}) {
  handleElement(view, blockIndex).dispatchEvent(syntheticMouseDown(extra));
}

function blockTexts(view) {
  const texts = [];
  for (let index = 0; index < view.state.doc.childCount; index += 1) {
    texts.push(view.state.doc.child(index).textContent);
  }
  return texts;
}

function layoutParagraphs(view, tops) {
  const paragraphs = view.dom.querySelectorAll('p');
  assert.equal(paragraphs.length, tops.length);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const top = tops[index];
    paragraphs[index].getBoundingClientRect = () => ({
      top,
      bottom: top + 20,
      left: 0,
      right: 400,
      width: 400,
      height: 20,
      x: 0,
      y: top,
    });
  }
}

test('Alt+Shift+Up twice moves a selected block up two places', async () => {
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
    paragraph('Three', id(12)),
    paragraph('Four', id(13)),
  ]);
  try {
    dispatchHandleMouseDown(view, 2);
    assert.deepEqual(selectedBlockRange(view.state), { from: 2, to: 2 });
    dispatchEditorKeyDown(view, 'ArrowUp', { altKey: true, shiftKey: true });
    assert.deepEqual(blockTexts(view), ['One', 'Three', 'Two', 'Four']);
    dispatchEditorKeyDown(view, 'ArrowUp', { altKey: true, shiftKey: true });
    assert.deepEqual(blockTexts(view), ['Three', 'One', 'Two', 'Four']);
    assert.deepEqual(selectedBlockRange(view.state), { from: 0, to: 0 });
  } finally {
    view.destroy();
    restore();
  }
});

test('Alt+Shift+Up twice moves the caret block when nothing is block-selected', async () => {
  const { emptyBlockHandleState, blockHandlePluginKey } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
    paragraph('Four'),
  ]);
  try {
    let pos = 0;
    pos += view.state.doc.child(0).nodeSize;
    pos += view.state.doc.child(1).nodeSize;
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, pos + 1))
        .setMeta(blockHandlePluginKey, emptyBlockHandleState()),
    );
    dispatchEditorKeyDown(view, 'ArrowUp', { altKey: true, shiftKey: true });
    dispatchEditorKeyDown(view, 'ArrowUp', { altKey: true, shiftKey: true });
    assert.deepEqual(blockTexts(view), ['Three', 'One', 'Two', 'Four']);
  } finally {
    view.destroy();
    restore();
  }
});

test('Alt+Shift+Up on the first block does not move it', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('First'),
    paragraph('Second'),
  ]);
  try {
    dispatchHandleMouseDown(view, 0);
    const before = blockTexts(view);
    const handled = view.someProp('handleKeyDown', (handler) => handler(view, {
      type: 'keydown',
      key: 'ArrowUp',
      altKey: true,
      shiftKey: true,
      defaultPrevented: false,
    }));
    assert.ok(handled !== true);
    assert.deepEqual(blockTexts(view), before);
  } finally {
    view.destroy();
    restore();
  }
});

test('Alt+Shift+Down on the last block does not move it', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('First'),
    paragraph('Last'),
  ]);
  try {
    dispatchHandleMouseDown(view, 1);
    const before = blockTexts(view);
    const handled = view.someProp('handleKeyDown', (handler) => handler(view, {
      type: 'keydown',
      key: 'ArrowDown',
      altKey: true,
      shiftKey: true,
      defaultPrevented: false,
    }));
    assert.ok(handled !== true);
    assert.deepEqual(blockTexts(view), before);
  } finally {
    view.destroy();
    restore();
  }
});

test('Ctrl+D duplicates two selected blocks below in order with new ids', async () => {
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { editorBlockSnapshot } = await loadRenderer(mappingUrl);
  const { isBlockId } = await loadRenderer(blockIdUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
    paragraph('Three', id(12)),
    paragraph('Four', id(13)),
  ]);
  try {
    dispatchHandleMouseDown(view, 1);
    dispatchHandleMouseDown(view, 2, { shiftKey: true });
    assert.deepEqual(selectedBlockRange(view.state), { from: 1, to: 2 });
    dispatchEditorKeyDown(view, 'd', { ctrlKey: true });
    assert.deepEqual(blockTexts(view), ['One', 'Two', 'Three', 'Two', 'Three', 'Four']);
    assert.deepEqual(selectedBlockRange(view.state), { from: 3, to: 4 });
    assert.equal(view.dom.querySelectorAll('[data-block-selected="true"]').length, 2);
    const snapshot = editorBlockSnapshot(view.state.doc);
    assert.equal(snapshot[1].id, id(11));
    assert.equal(snapshot[2].id, id(12));
    assert.notEqual(snapshot[3].id, id(11));
    assert.notEqual(snapshot[4].id, id(12));
    assert.ok(isBlockId(snapshot[3].id));
    assert.ok(isBlockId(snapshot[4].id));
  } finally {
    view.destroy();
    restore();
  }
});

test('each move and duplicate is a single undo step and keeps block selection', async () => {
  const { selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('A'),
    paragraph('B'),
    paragraph('C'),
  ]);
  try {
    dispatchHandleMouseDown(view, 1);
    const depthBefore = undoDepth(view.state);
    dispatchEditorKeyDown(view, 'ArrowUp', { altKey: true, shiftKey: true });
    assert.equal(undoDepth(view.state), depthBefore + 1);
    assert.equal(selectedBlockCount(view.state), 1);
    undo(view.state, view.dispatch.bind(view));
    assert.deepEqual(blockTexts(view), ['A', 'B', 'C']);

    dispatchHandleMouseDown(view, 1);
    dispatchEditorKeyDown(view, 'd', { ctrlKey: true });
    assert.equal(undoDepth(view.state), depthBefore + 1);
    assert.equal(selectedBlockCount(view.state), 1);
  } finally {
    view.destroy();
    restore();
  }
});

test('dragging a handle moves blocks to the drop point through handle handlers', async () => {
  const { dropIndexFromClientY } = await loadRenderer(blockHandleUrl);
  const { view, restore, document } = await editorViewFromBlocks([
    paragraph('Alpha'),
    paragraph('Beta'),
    paragraph('Gamma'),
  ]);
  try {
    layoutParagraphs(view, [100, 140, 180]);
    assert.equal(dropIndexFromClientY(view, 90), 0);
    assert.equal(dropIndexFromClientY(view, 120), 1);
    assert.equal(dropIndexFromClientY(view, 200), 3);

    dispatchHandleMouseDown(view, 1);
    layoutParagraphs(view, [100, 140, 180]);
    assert.ok(view.state.selection instanceof NodeSelection);
    document.dispatchEvent(syntheticMouseMove({ clientX: 10, clientY: 90 }));
    assert.ok(view.dom.hasAttribute('data-block-drag'));
    const layer = handleRoot(view).querySelector('.block-handle-layer');
    assert.ok(layer instanceof view.dom.ownerDocument.defaultView.HTMLElement);
    assert.equal(layer.hidden, true);
    assert.equal(visibleHandleCount(view), 0);
    assert.ok(view.dom.querySelector('.block-drop-indicator'));
    assert.equal(view.dom.querySelector('.block-drop-indicator')?.hasAttribute('style'), false);
    layoutParagraphs(view, [100, 140, 180]);
    document.dispatchEvent(syntheticMouseUp({ clientX: 10, clientY: 90 }));
    assert.equal(view.dom.hasAttribute('data-block-drag'), false);
    assert.deepEqual(blockTexts(view), ['Beta', 'Alpha', 'Gamma']);
    assert.ok(view.dom.querySelector('[data-block-selected="true"]'));
  } finally {
    view.destroy();
    restore();
  }
});

test('dropping a block onto itself leaves the document unchanged', async () => {
  const { view, restore, document } = await editorViewFromBlocks([
    paragraph('Only'),
    paragraph('Other'),
  ]);
  try {
    layoutParagraphs(view, [50, 90]);
    dispatchHandleMouseDown(view, 0);
    const before = view.state.doc;
    document.dispatchEvent(syntheticMouseMove({ clientX: 0, clientY: 55 }));
    document.dispatchEvent(syntheticMouseUp({ clientX: 0, clientY: 55 }));
    assert.ok(before.eq(view.state.doc));
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape during a handle drag cancels without changing the document', async () => {
  const { view, restore, document, window } = await editorViewFromBlocks([
    paragraph('Stay'),
    paragraph('Here'),
  ]);
  try {
    layoutParagraphs(view, [40, 80]);
    dispatchHandleMouseDown(view, 0);
    const before = view.state.doc;
    document.dispatchEvent(syntheticMouseMove({ clientX: 0, clientY: 100 }));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(before.eq(view.state.doc));
    assert.equal(view.dom.hasAttribute('data-block-drag'), false);
    assert.equal(view.dom.querySelector('.block-drop-indicator'), null);
  } finally {
    view.destroy();
    restore();
  }
});
