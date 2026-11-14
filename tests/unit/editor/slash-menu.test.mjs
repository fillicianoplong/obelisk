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
} from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-menu-plugin.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/editor/slash/reference.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(content = [], extra = {}) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
    ...extra,
  };
}

function baseDocument(blocks) {
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
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const editorCss = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${editorCss}`;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(baseDocument(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore, document };
}

function menuLabels(view) {
  return [...view.dom.parentElement.querySelectorAll('.slash-menu-option')].map((node) => node.textContent);
}

test('typing / on an empty line opens the slash menu with reference items', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { SLASH_MENU_ITEM_LABELS } = await loadRenderer(referenceUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, true);
    assert.deepEqual(menuLabels(view), [...SLASH_MENU_ITEM_LABELS]);
    const list = view.dom.parentElement.querySelector('.slash-menu-list');
    assert.equal(list?.getAttribute('role'), 'listbox');
    assert.ok(list?.getAttribute('aria-activedescendant'));
    assert.equal(view.dom.textContent, '/');
    for (const element of view.dom.parentElement.querySelectorAll('.slash-menu-host *')) {
      assert.equal(element.hasAttribute('style'), false);
    }
  } finally {
    view.destroy();
    restore();
  }
});

test('typing / mid-text inserts a slash and does not open the menu', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph([{ type: 'text', text: 'Hello' }]),
  ]);
  try {
    const end = view.state.doc.child(0).nodeSize - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.dom.textContent, 'Hello/');
    assert.equal(view.dom.parentElement.querySelector('.slash-menu-host')?.dataset.open, 'false');
  } finally {
    view.destroy();
    restore();
  }
});

test('Escape closes the slash menu and leaves the slash in place', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, true);
    dispatchEditorKeyDown(view, 'Escape');
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.dom.textContent, '/');
  } finally {
    view.destroy();
    restore();
  }
});

test('Backspace on the slash closes the menu', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    dispatchEditorKeyDown(view, 'Backspace');
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.dom.textContent, '');
  } finally {
    view.destroy();
    restore();
  }
});

test('a click outside the menu closes it and keeps the slash', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore, document } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.append(outside);
    outside.dispatchEvent(syntheticMouseDown());
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.dom.textContent, '/');
  } finally {
    view.destroy();
    restore();
  }
});

test('typing / with block selection or in a code block inserts a normal slash', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { selectBlockByIndex } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph([{ type: 'text', text: 'Body' }]),
    {
      type: 'code',
      id: id(4),
      content: [{ type: 'text', text: '' }],
    },
  ]);
  try {
    const blockTr = selectBlockByIndex(view.state, 0, false);
    assert.ok(blockTr);
    view.dispatch(blockTr);
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, false);

    const codePos = view.state.doc.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codePos)));
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, false);
    assert.match(view.state.doc.textBetween(codePos, codePos + 1), /\//);
  } finally {
    view.destroy();
    restore();
  }
});

test('ArrowDown moves the highlighted slash menu option', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    const before = slashMenuState(view.state).activeIndex;
    dispatchEditorKeyDown(view, 'ArrowDown');
    assert.equal(slashMenuState(view.state).activeIndex, before + 1);
  } finally {
    view.destroy();
    restore();
  }
});

test('Enter on a slash menu item closes the menu without changing the document', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    dispatchEditorTextInput(view, '/');
    const blocksBefore = view.state.doc.childCount;
    dispatchEditorKeyDown(view, 'Enter');
    assert.equal(slashMenuState(view.state).open, false);
    assert.equal(view.state.doc.childCount, blocksBefore);
    assert.equal(view.dom.textContent, '/');
  } finally {
    view.destroy();
    restore();
  }
});
