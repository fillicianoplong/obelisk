import assert from 'node:assert/strict';
import test from 'node:test';
import { splitBlock } from 'prosemirror-commands';
import { redoDepth, undoDepth } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const statusUrl = new URL('../../../src/renderer/shell/statusbar/model.ts', import.meta.url);

async function editorModule() {
  return loadRenderer(stateUrl);
}

test('a new tab state is one empty paragraph', async () => {
  const { createTabEditorState, editorCaret, editorText } = await editorModule();
  const { characterCount, wordCount } = await loadRenderer(statusUrl);
  const state = createTabEditorState();
  assert.equal(state.doc.childCount, 1);
  assert.equal(state.doc.firstChild.type.name, 'paragraph');
  assert.equal(editorText(state), '');
  assert.equal(state.selection.empty, true);
  assert.deepEqual(editorCaret(state), { anchor: 1, head: 1 });
  assert.equal(wordCount(editorText(state)), 0);
  assert.equal(characterCount(editorText(state)), 0);
});

test('undo and redo on an untouched tab leave it empty', async () => {
  const { createTabEditorState, editorText, redoLastChange, undoLastChange } = await editorModule();
  const state = createTabEditorState();
  assert.equal(undoLastChange(state), null);
  assert.equal(redoLastChange(state), null);
  assert.equal(editorText(state), '');
});

test('editor text feeds the status word and character counts', async () => {
  const { createTabEditorState, editorText, insertText } = await editorModule();
  const { characterCount, wordCount } = await loadRenderer(statusUrl);
  const state = insertText(createTabEditorState(), 'First page notes');
  assert.equal(editorText(state), 'First page notes');
  assert.equal(wordCount(editorText(state)), 3);
  assert.equal(characterCount(editorText(state)), 16);
});

test('enter splits a paragraph and the text keeps the break', async () => {
  const { createTabEditorState, editorText, insertText } = await editorModule();
  const { characterCount, wordCount } = await loadRenderer(statusUrl);
  let state = insertText(createTabEditorState(), 'Hello');
  let split = null;
  assert.equal(splitBlock(state, (transaction) => {
    split = state.apply(transaction);
  }), true);
  state = insertText(split, 'World');
  assert.equal(state.doc.childCount, 2);
  assert.equal(editorText(state), 'Hello\nWorld');
  assert.equal(wordCount(editorText(state)), 2);
  assert.equal(characterCount(editorText(state)), 11);
});

test('each editor state keeps its own text, caret, and undo history', async () => {
  const {
    createTabEditorState,
    editorCaret,
    editorText,
    insertText,
    redoLastChange,
    setCaret,
    undoLastChange,
  } = await editorModule();

  let left = insertText(createTabEditorState(), 'Left side');
  const right = insertText(createTabEditorState(), 'Right side');
  left = setCaret(left, 3);
  const leftCaret = editorCaret(left);
  const rightCaret = editorCaret(right);

  assert.equal(editorText(left), 'Left side');
  assert.equal(editorText(right), 'Right side');
  assert.deepEqual(leftCaret, { anchor: 3, head: 3 });
  assert.deepEqual(rightCaret, { anchor: 11, head: 11 });
  assert.equal(undoDepth(left), 1);
  assert.equal(undoDepth(right), 1);

  const undone = undoLastChange(left);
  assert.ok(undone);
  assert.equal(editorText(undone), '');
  assert.equal(undoDepth(undone), 0);
  assert.equal(redoDepth(undone), 1);
  assert.equal(editorText(right), 'Right side');
  assert.deepEqual(editorCaret(right), rightCaret);
  assert.equal(undoDepth(right), 1);

  const redone = redoLastChange(undone);
  assert.ok(redone);
  assert.equal(editorText(redone), 'Left side');
  assert.equal(editorText(right), 'Right side');
  assert.deepEqual(editorCaret(right), rightCaret);
  assert.equal(undoDepth(right), 1);
});

test('paragraph caret reports the block index and offset inside it', async () => {
  const { createTabEditorState, insertText, paragraphCaret, paragraphPosition, setCaret } = await editorModule();
  let state = insertText(createTabEditorState(), 'River field');
  let split = null;
  assert.equal(splitBlock(state, (transaction) => {
    split = state.apply(transaction);
  }), true);
  state = insertText(split, 'notes');
  assert.deepEqual(paragraphCaret(state), { paragraph: 1, offset: 5 });
  state = setCaret(state, state.doc.child(0).nodeSize + 1);
  assert.deepEqual(paragraphCaret(state), { paragraph: 1, offset: 0 });
  assert.equal(paragraphPosition(state, 1, 0), state.doc.child(0).nodeSize + 1);
  assert.equal(paragraphPosition(state, 1, 5), state.doc.child(0).nodeSize + 1 + 5);
});

test('a selection that jumps to either edge without input is not user input', async () => {
  const { createTabEditorState, insertText, isUnpromptedEdgeSelection, setCaret } = await editorModule();
  let state = insertText(createTabEditorState(), 'Hello');
  state = setCaret(state, 3);
  const current = state.selection;
  const jumpToEnd = () => state.tr.setSelection(TextSelection.atEnd(state.doc));
  assert.equal(isUnpromptedEdgeSelection(jumpToEnd(), current), true);
  assert.equal(
    isUnpromptedEdgeSelection(state.tr.setSelection(TextSelection.atStart(state.doc)), current),
    true,
  );
  assert.equal(isUnpromptedEdgeSelection(jumpToEnd().setMeta('pointer', true), current), false);
  assert.equal(isUnpromptedEdgeSelection(jumpToEnd().scrollIntoView(), current), false);
  assert.equal(isUnpromptedEdgeSelection(jumpToEnd().setMeta('composition', 1), current), false);
  assert.equal(isUnpromptedEdgeSelection(state.tr.insertText('!'), current), false);
  assert.equal(
    isUnpromptedEdgeSelection(state.tr.setSelection(TextSelection.create(state.doc, 2)), current),
    false,
  );
  assert.equal(isUnpromptedEdgeSelection(state.tr.setSelection(current), current), false);
});
