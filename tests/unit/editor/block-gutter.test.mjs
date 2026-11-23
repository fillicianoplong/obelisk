import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import {
  dispatchEditorKeyDown,
  dispatchEditorTextInput,
  prepareEditorDom,
  syntheticMouseDown,
  syntheticMouseMove,
  syntheticMouseUp,
} from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);
const gutterUrl = new URL('../../../src/renderer/editor/block-gutter.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-menu-plugin.ts', import.meta.url);

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
    content: text.length > 0 ? [{ type: 'text', text }] : [],
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
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
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

function gutterElement(view, blockIndex) {
  const { setBlockHandleHover } = blockHandleModule;
  setBlockHandleHover(view, blockIndex);
  const gutter = handleRoot(view).querySelector(
    `.block-handle-layer .block-handle[data-block-index="${blockIndex}"]`,
  );
  assert.ok(gutter instanceof view.dom.ownerDocument.defaultView.HTMLElement);
  return gutter;
}

function blockText(view, index) {
  return view.state.doc.child(index).textContent;
}

/** @type {Awaited<ReturnType<typeof loadRenderer>>} */
let blockHandleModule;

test.before(async () => {
  blockHandleModule = await loadRenderer(blockHandleUrl);
});

test('search filters block menu actions by label', async () => {
  const { BLOCK_MENU_ACTIONS, filterBlockMenuActions } = await loadRenderer(gutterUrl);
  assert.equal(filterBlockMenuActions(BLOCK_MENU_ACTIONS, '   ').length, BLOCK_MENU_ACTIONS.length);
  const headings = filterBlockMenuActions(BLOCK_MENU_ACTIONS, 'Head').map((action) => action.label);
  assert.deepEqual(headings, [
    'Turn into Heading 1',
    'Turn into Heading 2',
    'Turn into Heading 3',
  ]);
  assert.deepEqual(filterBlockMenuActions(BLOCK_MENU_ACTIONS, 'no-such-action'), []);
});

test('the gutter stays hidden in the margin and stays up on its controls', async () => {
  const { blockHandleState, blockHandlePluginKey, emptyBlockHandleState } = blockHandleModule;
  const { view, restore } = await editorViewFromBlocks([paragraph('One'), paragraph('Two', id(4))]);
  try {
    const blockTop = 120;
    const layoutRect = {
      top: blockTop,
      left: 200,
      right: 500,
      bottom: blockTop + 24,
      width: 300,
      height: 24,
      x: 200,
      y: blockTop,
    };
    const paragraphEl = view.dom.querySelector('p');
    paragraphEl.getBoundingClientRect = () => layoutRect;
    const nodeDom = view.nodeDOM.bind(view);
    view.nodeDOM = (pos) => (pos === 1 ? paragraphEl : nodeDom(pos));
    view.posAtCoords = () => null;
    view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, {
      ...emptyBlockHandleState(),
      hoverBlock: 0,
    }));
    const move = (clientX, clientY) => {
      const event = syntheticMouseMove({ clientX, clientY });
      Object.defineProperty(event, 'target', { value: view.dom });
      view.someProp('handleDOMEvents', (handlers) => handlers.mousemove?.(view, event));
    };
    move(layoutRect.left - 80, blockTop + 8);
    assert.equal(blockHandleState(view.state).hoverBlock, null);

    view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, {
      ...emptyBlockHandleState(),
      hoverBlock: 0,
    }));
    const gutter = gutterElement(view, 0);
    gutter.getBoundingClientRect = () => ({
      top: blockTop,
      left: layoutRect.left - 52,
      right: layoutRect.left,
      bottom: blockTop + 24,
      width: 52,
      height: 24,
      x: layoutRect.left - 52,
      y: blockTop,
    });
    move(layoutRect.left - 20, blockTop + 8);
    assert.equal(blockHandleState(view.state).hoverBlock, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('the add button inserts an empty block below and opens the slash menu', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('Keep'),
    paragraph('After', id(4)),
  ]);
  try {
    const gutter = gutterElement(view, 0);
    const add = gutter.querySelector('.block-gutter-add');
    assert.equal(add.getAttribute('aria-label'), 'Add block below');
    add.dispatchEvent(syntheticMouseDown());
    assert.equal(view.state.doc.childCount, 3);
    assert.equal(blockText(view, 0), 'Keep');
    assert.equal(blockText(view, 1), '', 'no / is typed into the new block');
    assert.equal(blockText(view, 2), 'After');
    assert.ok(view.state.selection instanceof TextSelection);
    assert.equal(view.state.selection.$from.index(0), 1);
    assert.equal(slashMenuState(view.state).open, true);
    assert.equal(slashMenuState(view.state).typed, false);
    assert.equal(view.dom.querySelector('.block-empty-hint'), null);
  } finally {
    view.destroy();
    restore();
  }
});

test('the slash menu from + filters from an empty start and leaves no / behind', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph('Keep'),
    paragraph('After', id(4)),
  ]);
  const options = () => [...view.dom.parentElement.querySelectorAll('.slash-menu-option')]
    .map((node) => node.textContent);
  try {
    const add = gutterElement(view, 0).querySelector('.block-gutter-add');
    add.dispatchEvent(syntheticMouseDown());
    const all = options().length;
    assert.ok(all > 1, 'the full list shows with an empty filter');
    dispatchEditorTextInput(view, 'head');
    assert.equal(blockText(view, 1), 'head');
    assert.equal(slashMenuState(view.state).open, true);
    assert.ok(options().length < all, 'typing filters the list');
    assert.ok(options().every((label) => /heading/i.test(label)));
    dispatchEditorKeyDown(view, 'Enter');
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.state.doc.child(1).type.name, 'heading');
    assert.equal(blockText(view, 1), '', 'the filter text goes away with the menu');
    assert.equal(view.state.doc.childCount, 3);
  } finally {
    view.destroy();
    restore();
  }
});

test('Esc and Backspace close the slash menu from + and leave the paragraph empty', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  for (const key of ['Escape', 'Backspace']) {
    const { view, restore } = await editorViewFromBlocks([
      paragraph('Keep'),
      paragraph('After', id(4)),
    ]);
    try {
      gutterElement(view, 0).querySelector('.block-gutter-add').dispatchEvent(syntheticMouseDown());
      assert.equal(slashMenuState(view.state).open, true);
      dispatchEditorKeyDown(view, key);
      assert.equal(slashMenuState(view.state).open, false, `${key} closes the menu`);
      assert.equal(view.state.doc.childCount, 3, `${key} keeps the new paragraph`);
      assert.equal(blockText(view, 1), '');
      assert.equal(view.state.doc.child(1).type.name, 'paragraph');
      // Typing / by hand on the now-empty paragraph still opens the typed menu.
      dispatchEditorTextInput(view, '/');
      assert.equal(slashMenuState(view.state).open, true);
      assert.equal(slashMenuState(view.state).typed, true);
      assert.equal(blockText(view, 1), '/');
    } finally {
      view.destroy();
      restore();
    }
  }
});

test('clicking the grip opens a searchable menu headed by the block type', async () => {
  const { view, restore, document } = await editorViewFromBlocks([
    paragraph('Alpha'),
    paragraph('Beta', id(4)),
  ]);
  try {
    const gutter = gutterElement(view, 0);
    const grip = gutter.querySelector('.block-gutter-grip');
    const tooltip = grip.querySelector('.block-gutter-tooltip');
    assert.equal(grip.getAttribute('aria-label'), 'Block menu');
    assert.equal(tooltip.textContent, 'Drag to move this block. Click to open the menu.');
    assert.equal(tooltip.dataset.open, 'false');
    assert.equal(grip.getAttribute('aria-describedby'), tooltip.id);

    grip.dispatchEvent(syntheticMouseDown({ shiftKey: true }));
    document.dispatchEvent(syntheticMouseUp());
    assert.equal(handleRoot(view).querySelector('.block-menu'), null);

    grip.dispatchEvent(syntheticMouseDown());
    document.dispatchEvent(syntheticMouseUp());
    const menu = handleRoot(view).querySelector('.block-menu');
    assert.ok(menu);
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelector('.block-menu-header').textContent, 'Paragraph');
    assert.equal(menu.querySelector('.block-menu-search').getAttribute('aria-label'), 'Search actions');
    const search = menu.querySelector('.block-menu-search');
    search.value = 'heading';
    search.dispatchEvent(new view.dom.ownerDocument.defaultView.Event('input', { bubbles: true }));
    const labels = [...menu.querySelectorAll('.block-menu-label')].map((node) => node.textContent);
    assert.deepEqual(labels, [
      'Turn into Heading 1',
      'Turn into Heading 2',
      'Turn into Heading 3',
    ]);
    menu.querySelector('[data-action="block-turn-into-heading-1"]').dispatchEvent(new view.dom.ownerDocument.defaultView.Event('click', { bubbles: true }));
    assert.equal(view.state.doc.child(0).type.name, 'heading');
    assert.equal(view.state.doc.child(0).attrs.level, 1);
    assert.equal(blockText(view, 0), 'Alpha');
    assert.equal(menu.hidden, true);
  } finally {
    view.destroy();
    restore();
  }
});

test('an empty block shows a slash hint until text is typed', async () => {
  const { EMPTY_BLOCK_HINT } = await loadRenderer(gutterUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const hint = view.dom.querySelector('.block-empty-hint');
    assert.equal(hint?.getAttribute('data-empty-hint'), EMPTY_BLOCK_HINT);
    assert.equal(hint?.textContent, '');
    assert.equal(view.state.doc.textContent, '');
    view.dispatch(view.state.tr.insertText('Hello'));
    assert.equal(view.dom.querySelector('.block-empty-hint'), null);
    assert.equal(view.state.doc.textContent, 'Hello');
  } finally {
    view.destroy();
    restore();
  }
});

test('an empty code block does not show the slash hint', async () => {
  const { view, restore } = await editorViewFromBlocks([
    { type: 'code', id: id(8), text: '' },
  ]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    assert.equal(view.state.doc.child(0).type.name, 'code_block');
    assert.equal(view.state.doc.child(0).content.size, 0);
    assert.equal(view.dom.querySelector('.block-empty-hint'), null);
  } finally {
    view.destroy();
    restore();
  }
});

test('gutter and menu styles keep hover accent and the focus ring apart in both themes', async () => {
  const layoutCss = await readFile(path.join(root, 'src/renderer/editor/block-handle-layout.css'), 'utf8');
  const editorCss = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  assert.match(editorCss, /\.block-handle-layer \.block-handle\s*\{[^}]*position:\s*absolute/);
  assert.match(editorCss, /width:\s*var\(--size-block-gutter\)/);
  assert.doesNotMatch(layoutCss, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(
    layoutCss,
    /\.block-handle\[data-input='pointer'\] \.block-gutter-button:hover:not\(:focus-visible\)/,
  );
  assert.match(layoutCss, /\.block-gutter-button:focus-visible\s*\{[^}]*var\(--color-focus-outer\)/);
  const keyboardRule = layoutCss.match(/\.block-menu\[data-input='keyboard'\] \.block-menu-action\[data-focused='true'\]\s*\{[^}]*\}/);
  assert.ok(keyboardRule);
  assert.match(keyboardRule[0], /var\(--color-focus-outer\)/);
  assert.doesNotMatch(keyboardRule[0], /--size-menu-accent/);
  const pointerRule = layoutCss.match(/\.block-menu\[data-input='pointer'\] \.block-menu-action:not\(\[aria-disabled='true'\]\):hover\s*\{[^}]*\}/);
  assert.ok(pointerRule);
  assert.match(pointerRule[0], /var\(--size-menu-accent\)/);
  assert.doesNotMatch(pointerRule[0], /--size-focus-ring/);

  const lightStart = tokensCss.indexOf(':root,');
  const darkStart = tokensCss.indexOf(':root[data-theme="dark"]');
  const light = tokensCss.slice(lightStart, darkStart);
  const dark = tokensCss.slice(darkStart, tokensCss.indexOf('@media (prefers-reduced-motion'));
  for (const name of [
    '--color-subtle-fill-hover',
    '--color-accent',
    '--color-accent-pressed',
    '--color-focus-outer',
    '--color-focus-inner',
    '--color-text-disabled',
    '--color-text-secondary',
    '--color-surface-raised',
    '--color-surface-input',
  ]) {
    assert.match(light, new RegExp(`${name}\\s*:`), `light ${name}`);
    assert.match(dark, new RegExp(`${name}\\s*:`), `dark ${name}`);
  }
});
