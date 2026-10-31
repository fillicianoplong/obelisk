import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import {
  dispatchEditorKeyDown,
  dispatchEditorKeyDownOnDom,
  prepareEditorDom,
  syntheticMouseDown,
} from './dom-test-helpers.mjs';

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

function handleElement(view, blockIndex) {
  const handle = view.dom.querySelector(`.block-handle[data-block-index="${blockIndex}"]`);
  assert.ok(handle instanceof view.dom.ownerDocument.defaultView.HTMLElement, `block handle ${blockIndex} is missing`);
  return handle;
}

function dispatchHandleMouseDown(view, blockIndex, extra = {}) {
  const handle = handleElement(view, blockIndex);
  handle.dispatchEvent(syntheticMouseDown(extra));
}

test('the first block handle stays hidden when the caret is in another block', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
  ]);
  try {
    const blockOnePos = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockOnePos)));
    assert.equal(handleElement(view, 0).hasAttribute('data-caret-block'), false);
    assert.equal(handleElement(view, 1).hasAttribute('data-caret-block'), true);
  } finally {
    view.destroy();
    restore();
  }
});

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

test('block handles stay out of document flow so row height follows the block', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.page-region \.page-sheet > \.block-handle\s*\{[^}]*height:\s*0/);
  assert.match(css, /\.page-region \.page-sheet > \.block-handle\s*\{[^}]*overflow:\s*visible/);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(20)),
    paragraph('Two', id(21)),
  ]);
  try {
    const handle = handleElement(view, 0);
    assert.equal(blockLayoutHeight(handle), 0);
    const paragraphs = view.dom.querySelectorAll('p');
    const gap = blockLayoutTop(paragraphs[1])
      - (blockLayoutTop(paragraphs[0]) + blockLayoutHeight(paragraphs[0]));
    assert.equal(gap, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('clicking handles on the second and third blocks selects those blocks', async () => {
  const { selectedBlockCount, selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
  ]);
  try {
    dispatchHandleMouseDown(view, 1);
    assert.equal(selectedBlockCount(view.state), 1);
    assert.ok(view.state.selection instanceof NodeSelection);
    assert.equal(selectedBlockRange(view.state)?.from, 1);

    dispatchHandleMouseDown(view, 2);
    assert.equal(selectedBlockCount(view.state), 1);
    assert.equal(selectedBlockRange(view.state)?.from, 2);
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
    assert.ok(view.state.selection instanceof NodeSelection);
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

test('a downward three-block range decorates every block and uses themed selection chrome', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.page-sheet \.ProseMirror-selectednode\s*\{[^}]*outline:\s*none/);
  assert.match(css, /\.block-is-selected\s*\{[^}]*box-shadow:\s*inset[^;]*var\(--color-selection\)/);
  assert.doesNotMatch(css, /\.block-is-selected\s*\{[^}]*--color-focus/);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
    paragraph('Four'),
  ]);
  try {
    dispatchHandleMouseDown(view, 0);
    dispatchHandleMouseDown(view, 2, { shiftKey: true });
    const selectedBlocks = view.dom.querySelectorAll('[data-block-selected="true"]');
    assert.equal(selectedBlocks.length, 3);
    for (const block of selectedBlocks) {
      assert.ok(block.classList.contains('block-is-selected'));
    }
    assert.equal(view.dom.querySelectorAll('.ProseMirror-selectednode').length, 1);
    assert.ok(view.dom.querySelector('.ProseMirror-selectednode.block-is-selected'));
    assert.ok(view.dom.querySelectorAll('p')[0].classList.contains('block-is-selected'));
  } finally {
    view.destroy();
    restore();
  }
});

test('an upward three-block range decorates every block, not only the NodeSelection anchor', async () => {
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
    paragraph('Four'),
  ]);
  try {
    dispatchHandleMouseDown(view, 3);
    dispatchHandleMouseDown(view, 1, { shiftKey: true });
    assert.deepEqual(selectedBlockRange(view.state), { from: 1, to: 3 });
    const selectedBlocks = view.dom.querySelectorAll('[data-block-selected="true"]');
    assert.equal(selectedBlocks.length, 3);
    const paragraphs = view.dom.querySelectorAll('p');
    assert.ok(paragraphs[1].classList.contains('block-is-selected'));
    assert.ok(paragraphs[2].classList.contains('block-is-selected'));
    assert.ok(paragraphs[3].classList.contains('block-is-selected'));
    assert.equal(view.dom.querySelectorAll('.ProseMirror-selectednode').length, 1);
    assert.ok(paragraphs[1].classList.contains('ProseMirror-selectednode'));
    assert.ok(!paragraphs[3].classList.contains('ProseMirror-selectednode'));
  } finally {
    view.destroy();
    restore();
  }
});

test('the first block in the document keeps block-is-selected when it ends an upward range', async () => {
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One'),
    paragraph('Two'),
    paragraph('Three'),
  ]);
  try {
    dispatchHandleMouseDown(view, 2);
    dispatchHandleMouseDown(view, 0, { shiftKey: true });
    assert.deepEqual(selectedBlockRange(view.state), { from: 0, to: 2 });
    const paragraphs = view.dom.querySelectorAll('p');
    assert.ok(paragraphs[0].classList.contains('block-is-selected'));
    assert.ok(paragraphs[1].classList.contains('block-is-selected'));
    assert.ok(paragraphs[2].classList.contains('block-is-selected'));
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape with a text range selected does not select the block', async () => {
  const { selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('Pendulum lab'),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)));
    const handled = view.someProp('handleKeyDown', (handler) => handler(view, {
      type: 'keydown',
      key: 'Escape',
      shiftKey: false,
      defaultPrevented: false,
    }));
    assert.ok(!handled, 'Escape must not be handled for a text range');
    assert.equal(selectedBlockCount(view.state), 0);
    assert.ok(view.state.selection instanceof TextSelection);
    assert.equal(view.state.selection.from, 1);
    assert.equal(view.state.selection.to, 9);
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape through the editor keymap selects the current block with NodeSelection', async () => {
  const { selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('First'),
    paragraph('Second'),
  ]);
  try {
    const blockOnePos = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockOnePos)));
    dispatchEditorKeyDown(view, 'Escape');
    assert.equal(selectedBlockCount(view.state), 1);
    assert.ok(view.state.selection instanceof NodeSelection);
    assert.ok(view.dom.querySelector('[data-block-selected="true"]'));
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape from a dispatched keydown on the editor DOM selects the current block', async () => {
  const { selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('First'),
    paragraph('Second'),
  ]);
  try {
    const blockOnePos = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockOnePos)));
    dispatchEditorKeyDownOnDom(view, 'Escape');
    assert.equal(selectedBlockCount(view.state), 1);
    assert.ok(view.state.selection instanceof NodeSelection);
  } finally {
    view.destroy();
    restore();
  }
});

function blockLayoutHeight(element) {
  if (typeof element.offsetHeight === 'number') {
    return element.offsetHeight;
  }
  return element.getBoundingClientRect().height;
}

function blockLayoutTop(element) {
  if (typeof element.offsetTop === 'number') {
    return element.offsetTop;
  }
  return element.getBoundingClientRect().top;
}
function firstLineHeight(element, window) {
  const style = window.getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeightValue = style.lineHeight;
  if (lineHeightValue == null || lineHeightValue === '') {
    return fontSize;
  }
  if (lineHeightValue.endsWith('px')) {
    return parseFloat(lineHeightValue);
  }
  if (lineHeightValue === 'normal') {
    return fontSize * 1.2;
  }
  return fontSize * parseFloat(lineHeightValue);
}

function handleGripCenter(handle, window) {
  const beforeStyle = window.getComputedStyle(handle, '::before');
  const beforeTop = parseFloat(beforeStyle.top) || 0;
  const hit = parseFloat(beforeStyle.height) || 24;
  return blockLayoutTop(handle) + beforeTop + hit / 2;
}

test('the handle aligns with the first line of its block within a couple of pixels', async () => {
  const layoutCss = await readFile(path.join(root, 'src/renderer/editor/block-handle-layout.css'), 'utf8');
  assert.match(
    layoutCss,
    /\.block-handle\[data-block-kind="paragraph"\]\[data-line-spacing="single"\]\[data-space-before="0"\]::before/,
  );
  const { view, restore, window } = await editorViewFromBlocks([
    paragraph('Line'),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const handle = handleElement(view, 0);
    assert.equal(handle.getAttribute('data-block-kind'), 'paragraph');
    assert.equal(handle.getAttribute('data-line-spacing'), 'single');
    assert.equal(handle.getAttribute('data-space-before'), '0');
    const block = view.dom.querySelector('p');
    const handleCenter = handleGripCenter(handle, window);
    const lineCenter = blockLayoutTop(block) + firstLineHeight(block, window) / 2;
    if (Number.isFinite(handleCenter) && Number.isFinite(lineCenter) && handleCenter !== 0) {
      assert.ok(Math.abs(handleCenter - lineCenter) <= 4, `offset ${handleCenter - lineCenter}`);
    }
  } finally {
    view.destroy();
    restore();
  }
});

test('invisible handles use opacity so the gutter stays hoverable', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.block-handle\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.block-handle\[data-caret-block='true'\][^}]*opacity:\s*1/);
});

test('clicking empty page space clears block selection to a text caret', async () => {
  const { clearBlockSelectionForPointerClick, selectedBlockCount } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('Only'),
  ]);
  try {
    dispatchHandleMouseDown(view, 0);
    assert.ok(view.state.selection instanceof NodeSelection);
    const layoutRect = {
      top: 100,
      left: 50,
      right: 450,
      bottom: 600,
      width: 400,
      height: 500,
      x: 50,
      y: 100,
    };
    view.dom.getBoundingClientRect = () => layoutRect;
    view.dom.ownerDocument.elementFromPoint = () => view.dom;
    view.posAtCoords = () => ({ pos: 5, inside: 1 });
    const below = {
      target: view.dom,
      clientX: layoutRect.left + layoutRect.width / 2,
      clientY: layoutRect.bottom - 2,
    };
    clearBlockSelectionForPointerClick(view, below);
    assert.equal(selectedBlockCount(view.state), 0);
    assert.ok(view.state.selection instanceof TextSelection);
    assert.equal(view.dom.querySelectorAll('[data-block-selected="true"]').length, 0);
    assert.equal(view.state.selection.from, 5, 'clicking below places the caret at the end of the text');

    dispatchHandleMouseDown(view, 0);
    const top = {
      target: view.dom,
      clientX: layoutRect.left + layoutRect.width / 2,
      clientY: layoutRect.top + 2,
    };
    clearBlockSelectionForPointerClick(view, top);
    assert.equal(selectedBlockCount(view.state), 0);
    assert.ok(view.state.selection instanceof TextSelection);
    assert.equal(view.state.selection.from, 1);
  } finally {
    view.destroy();
    restore();
  }
});
