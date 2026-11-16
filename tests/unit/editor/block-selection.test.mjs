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

function listBlock(items, blockId = id(30)) {
  return {
    type: 'list',
    id: blockId,
    style: 'bulleted',
    items,
  };
}

function dispatchHandleMouseDown(view, blockIndex, extra = {}) {
  const handle = handleElement(view, blockIndex);
  handle.dispatchEvent(syntheticMouseDown(extra));
}

test('block handles stay out of the DOM until a block is hovered', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
  ]);
  try {
    assert.equal(visibleHandleCount(view), 0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    assert.equal(visibleHandleCount(view), 0);
    blockHandleModule.setBlockHandleHover(view, 0);
    assert.equal(visibleHandleCount(view), 1);
    assert.equal(blockHandleModule.blockHoverIndex(view.state), 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('only one hover handle is mounted at a time', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(10)),
    paragraph('Two', id(11)),
  ]);
  try {
    blockHandleModule.setBlockHandleHover(view, 0);
    assert.equal(visibleHandleCount(view), 1);
    blockHandleModule.setBlockHandleHover(view, 1);
    assert.equal(visibleHandleCount(view), 1);
    const handle = handleElement(view, 1);
    assert.equal(handle.getAttribute('data-hover-active'), 'true');
    assert.equal(handleRoot(view).querySelector(`.block-handle[data-block-index="0"]`), null);
  } finally {
    view.destroy();
    restore();
  }
});

test('arrowing from a paragraph into a list below does not mount two handles', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph('This is a list of things:', id(12)),
    listBlock([{ level: 0, content: [{ type: 'text', text: 'Item' }] }], id(13)),
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const listPos = 1 + view.state.doc.child(0).nodeSize + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, listPos)));
    assert.equal(visibleHandleCount(view), 0);
    blockHandleModule.setBlockHandleHover(view, 1);
    assert.equal(visibleHandleCount(view), 1);
    assert.equal(view.dom.querySelector('[data-block-hovered="true"]')?.tagName, 'UL');
  } finally {
    view.destroy();
    restore();
  }
});

test('a hovered block gets a highlight decoration without inline style', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph('Hover me', id(14))]);
  try {
    blockHandleModule.setBlockHandleHover(view, 0);
    const highlighted = view.dom.querySelector('[data-block-hovered="true"]');
    assert.ok(highlighted instanceof view.dom.ownerDocument.defaultView.HTMLElement);
    assert.equal(highlighted.tagName, 'P');
    assert.equal(highlighted.hasAttribute('style'), false);
    assert.ok(highlighted.classList.contains('block-is-hovered'));
  } finally {
    view.destroy();
    restore();
  }
});

test('typing Enter clears hover highlight until the pointer moves again', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph('Line', id(15))]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
    blockHandleModule.setBlockHandleHover(view, 0);
    assert.equal(blockHandleModule.blockHoverIndex(view.state), 0);
    assert.ok(view.dom.querySelector('[data-block-hovered="true"]'));
    dispatchEditorKeyDownOnDom(view, 'Enter');
    assert.equal(blockHandleModule.blockHoverIndex(view.state), null);
    assert.equal(view.dom.querySelector('[data-block-hovered="true"]'), null);
    assert.equal(visibleHandleCount(view), 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('the block handle bar lives in an overlay and never mounts inside the page sheet', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.block-handle-layer\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /--block-handle-top/);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('One', id(20)),
    paragraph('Two', id(21)),
  ]);
  try {
    assert.equal(view.dom.querySelector('.block-handle'), null);
    blockHandleModule.setBlockHandleHover(view, 0);
    assert.equal(view.dom.querySelector('.block-handle'), null);
    assert.ok(handleRoot(view).querySelector('.block-handle-layer .block-handle'));
    const paragraphs = view.dom.querySelectorAll('p');
    const gap = blockLayoutTop(paragraphs[1])
      - (blockLayoutTop(paragraphs[0]) + blockLayoutHeight(paragraphs[0]));
    assert.equal(gap, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('hovering an adjacent list does not change the gap between the two lists', async () => {
  const { view, restore } = await editorViewFromBlocks([
    listBlock([{ level: 0, content: [{ type: 'text', text: 'Above' }] }], id(40)),
    listBlock([{ level: 0, content: [{ type: 'text', text: 'Below' }] }], id(41)),
  ]);
  try {
    const lists = view.dom.querySelectorAll('ul[data-list-style]');
    assert.equal(lists.length, 2);
    const gapBefore = blockLayoutTop(lists[1]) - (blockLayoutTop(lists[0]) + blockLayoutHeight(lists[0]));
    blockHandleModule.setBlockHandleHover(view, 0);
    const gapWhileHovered = blockLayoutTop(lists[1])
      - (blockLayoutTop(lists[0]) + blockLayoutHeight(lists[0]));
    assert.equal(gapWhileHovered, gapBefore);
    assert.ok(lists[0].classList.contains('block-is-hovered'));
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
test('the hover bar lines up with the hovered block top and height', async () => {
  const { blockHandleLayoutForBlock } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph('Measure me', id(55))]);
  try {
    const block = view.dom.querySelector('p');
    const region = handleRoot(view);
    const blockHeight = 48;
    const blockTop = 120;
    const regionTop = 80;
    block.getBoundingClientRect = () => ({
      top: blockTop,
      left: 200,
      right: 400,
      bottom: blockTop + blockHeight,
      width: 200,
      height: blockHeight,
      x: 200,
      y: blockTop,
    });
    const layerRect = {
      top: regionTop,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 520,
      x: 0,
      y: regionTop,
    };
    region.getBoundingClientRect = () => layerRect;
    blockHandleModule.setBlockHandleHover(view, 0);
    const layer = region.querySelector('.block-handle-layer');
    assert.ok(layer instanceof region.ownerDocument.defaultView.HTMLElement);
    layer.getBoundingClientRect = () => layerRect;
    const layout = blockHandleLayoutForBlock(view, 0, layer);
    assert.ok(layout !== null);
    assert.equal(Math.round(layout.top), blockTop - regionTop);
    assert.equal(Math.round(layout.height), blockHeight);
    const handle = handleElement(view, 0);
    await new Promise((resolve) => {
      const win = view.dom.ownerDocument.defaultView;
      if (win?.requestAnimationFrame) {
        win.requestAnimationFrame(() => resolve());
      } else {
        resolve();
      }
    });
    const top = parseFloat(handle.style.getPropertyValue('--block-handle-top'));
    const height = parseFloat(handle.style.getPropertyValue('--block-handle-height'));
    assert.ok(height > 0);
    assert.equal(Math.round(top), blockTop - regionTop);
    assert.equal(Math.round(height), blockHeight);
  } finally {
    view.destroy();
    restore();
  }
});

test('the hover bar handle uses token sizing and spans the block height in CSS', async () => {
  const layoutCss = await readFile(path.join(root, 'src/renderer/editor/block-handle-layout.css'), 'utf8');
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  assert.match(layoutCss, /\.block-handle::before\s*\{[^}]*height:\s*100%/);
  assert.match(layoutCss, /width:\s*var\(--size-block-handle-bar\)/);
  assert.match(tokensCss, /--size-block-handle-hit:\s*12px/);
  const { view, restore } = await editorViewFromBlocks([paragraph('Line')]);
  try {
    const handle = handleElement(view, 0);
    assert.equal(handle.getAttribute('data-block-kind'), 'paragraph');
    assert.equal(handle.getAttribute('aria-label'), 'Select block');
    assert.equal(handle.hidden, false);
  } finally {
    view.destroy();
    restore();
  }
});

test('hover handle and highlight styles live in the editor stylesheet', async () => {
  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(css, /\.block-is-hovered\s*\{[^}]*box-shadow:\s*var\(--shadow-block-hover-fill\)/);
  assert.match(css, /\.page-sheet ul\[data-list-style\] \+ ul\[data-list-style\]/);
  assert.doesNotMatch(css, /data-caret-block/);
  assert.doesNotMatch(css, /⋮/);
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
