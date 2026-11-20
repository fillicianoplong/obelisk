import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { undo } from 'prosemirror-history';
import { parseHTML } from 'linkedom';
import { EditorView } from 'prosemirror-view';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom, dispatchEditorKeyDown } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const findUrl = new URL('../../../src/renderer/editor/find/find-plugin.ts', import.meta.url);
const historyUrl = new URL('../../../src/renderer/editor/history/groups.ts', import.meta.url);
const blockCommandsUrl = new URL('../../../src/renderer/editor/block-commands.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);

async function viewWithText(text) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { markCloseHistoryGroup } = await loadRenderer(historyUrl);
  const { insertTextBlock } = await loadRenderer(blockCommandsUrl);
  const { newBlockId } = await loadRenderer(blockIdUrl);
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
  view.dispatch(markCloseHistoryGroup(insertTextBlock(view.state.tr, 'paragraph', newBlockId, { text })));
  return { view, restore };
}

test('replace all with whole word is one undo step (AC-18, FR-60)', async () => {
  const { findCommands } = await loadRenderer(findUrl);
  const text = 'cat one cat two cat three cat four cat five';
  const { view, restore } = await viewWithText(text);
  try {
    findCommands.open(view, { showReplace: true, query: 'cat' });
    findCommands.patch(view, { wholeWord: true, replacement: 'dog' });
    assert.equal(findCommands.snapshot(view.state).matchCount, 5);
    assert.ok(findCommands.replaceAll(view));
    assert.equal(view.state.doc.textContent.includes('cat'), false);
    assert.equal((view.state.doc.textContent.match(/dog/g) ?? []).length, 5);
    let undone = false;
    undo(view.state, (tr) => {
      view.dispatch(tr);
      undone = true;
    });
    assert.equal(undone, true);
    assert.equal(view.state.doc.textContent, text);
    assert.equal(findCommands.snapshot(view.state).matchCount, 5);
  } finally {
    view.destroy();
    restore();
  }
});

test('replace all skips embedded matches when whole word is on (FR-58)', async () => {
  const { findCommands } = await loadRenderer(findUrl);
  const text = 'category cat scatter';
  const { view, restore } = await viewWithText(text);
  try {
    findCommands.open(view, { showReplace: true, query: 'cat' });
    findCommands.patch(view, { wholeWord: true, replacement: 'dog' });
    assert.equal(findCommands.snapshot(view.state).matchCount, 1);
    findCommands.replaceAll(view);
    assert.equal(view.state.doc.textContent, 'category dog scatter');
  } finally {
    view.destroy();
    restore();
  }
});

test('F3 steps through matches (FR-59)', async () => {
  const { findCommands } = await loadRenderer(findUrl);
  const { view, restore } = await viewWithText('aa aa aa');
  try {
    findCommands.open(view, { query: 'aa' });
    assert.equal(findCommands.snapshot(view.state).matchCount, 3);
    assert.equal(findCommands.snapshot(view.state).currentIndex, 0);
    dispatchEditorKeyDown(view, 'F3');
    assert.equal(findCommands.snapshot(view.state).currentIndex, 1);
    dispatchEditorKeyDown(view, 'F3', { shiftKey: true });
    assert.equal(findCommands.snapshot(view.state).currentIndex, 0);
  } finally {
    view.destroy();
    restore();
  }
});