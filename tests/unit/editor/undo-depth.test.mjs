import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { undoDepth } from 'prosemirror-history';
import { loadRenderer } from './load-renderer.mjs';
import {
  dispatchEditorKeyDown,
  dispatchEditorTextInput,
  prepareEditorDom,
  runEditorKeyDown,
} from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const historyUrl = new URL('../../../src/renderer/editor/history/index.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const saveUrl = new URL('../../../src/renderer/shell/tabs/save.ts', import.meta.url);
const openedUrl = new URL('../../../src/renderer/shell/tabs/opened.ts', import.meta.url);

async function editorViewWithCaret() {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const editorCss = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${editorCss}`;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState();
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  return { view, restore };
}

function editorUndo(view) {
  dispatchEditorKeyDown(view, 'z', { ctrlKey: true });
}

function closeUndoGroup(view, markCloseHistoryGroup) {
  view.dispatch(markCloseHistoryGroup(view.state.tr));
}

test('101 undo groups keep the first edit after 100 Ctrl+Z undos (FR-37)', async () => {
  const { EDITOR_UNDO_DEPTH, markCloseHistoryGroup } = await loadRenderer(historyUrl);
  assert.equal(EDITOR_UNDO_DEPTH, 100);
  const { view, restore } = await editorViewWithCaret();
  try {
    for (let index = 0; index < EDITOR_UNDO_DEPTH + 1; index += 1) {
      dispatchEditorTextInput(view, 'x');
      closeUndoGroup(view, markCloseHistoryGroup);
    }
    assert.equal(view.state.doc.textContent.length, EDITOR_UNDO_DEPTH + 1);
    assert.equal(undoDepth(view.state), EDITOR_UNDO_DEPTH + 1);
    for (let index = 0; index < EDITOR_UNDO_DEPTH; index += 1) {
      const before = view.state.doc.textContent;
      editorUndo(view);
      assert.notEqual(view.state.doc.textContent, before);
    }
    assert.equal(view.state.doc.textContent, 'x');
    editorUndo(view);
    assert.equal(view.state.doc.textContent, '');
  } finally {
    restore();
  }
});

test('Save keeps undo history and Ctrl+Z undoes the last edit (FR-37)', async () => {
  const { markCloseHistoryGroup } = await loadRenderer(historyUrl);
  const { createTab } = await loadRenderer(modelUrl);
  const { applySavedTab, documentForTab, noteEditorChange } = await loadRenderer(saveUrl);
  const { view, restore } = await editorViewWithCaret();
  try {
    let tab = createTab(1);
    dispatchEditorTextInput(view, 'H');
    closeUndoGroup(view, markCloseHistoryGroup);
    tab = noteEditorChange(tab, view.state);
    dispatchEditorTextInput(view, 'i');
    tab = noteEditorChange(tab, view.state);
    assert.equal(view.state.doc.textContent, 'Hi');
    const built = documentForTab(tab);
    tab = applySavedTab(tab, {
      revision: tab.revision,
      stat: { size: 10, modifiedMs: 1 },
      document: built.document,
      blockIds: built.blockIds,
    });
    assert.equal(tab.editor, view.state);
    editorUndo(view);
    assert.equal(view.state.doc.textContent, 'H');
  } finally {
    restore();
  }
});

test('a reopened tab has no undo history (FR-37)', async () => {
  const { createTab } = await loadRenderer(modelUrl);
  const { documentForTab, noteEditorChange } = await loadRenderer(saveUrl);
  const { createOpenedTab } = await loadRenderer(openedUrl);
  const { view, restore } = await editorViewWithCaret();
  try {
    let tab = createTab(1);
    dispatchEditorTextInput(view, 'Notes');
    tab = noteEditorChange(tab, view.state);
    const saved = documentForTab(tab);
    const reopened = createOpenedTab({
      handle: 'file-1',
      name: 'Notes.obk',
      document: saved.document,
      stat: { size: 10, modifiedMs: 2 },
    });
    assert.equal(reopened.editor.doc.textContent, 'Notes');
    assert.equal(undoDepth(reopened.editor), 0);
    const reopenHost = view.dom.ownerDocument.createElement('div');
    const reopenView = new EditorView(reopenHost, { state: reopened.editor });
    const textBefore = reopenView.state.doc.textContent;
    runEditorKeyDown(reopenView, 'z', { ctrlKey: true });
    assert.equal(reopenView.state.doc.textContent, textBefore);
    reopenView.destroy();
  } finally {
    restore();
  }
});