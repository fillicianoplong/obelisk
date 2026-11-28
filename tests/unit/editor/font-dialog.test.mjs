import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const fontUrl = new URL('../../../src/renderer/editor/font-dialog.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('Font dialog apply styles a selection and stored marks when the caret is empty', async () => {
  const {
    applyFontDialogForTest,
    fontDialogValueFromState,
  } = await loadRenderer(fontUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);

  let state = createTabEditorState();
  state = insertText(state, 'Caption');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 8)));
  const draft = {
    family: 'Carlito',
    style: 'bold-italic',
    sizePt: 14,
    underline: true,
    strike: false,
    superscript: false,
    subscript: false,
    code: false,
    textColor: '#2563EB',
    highlight: null,
  };
  const applied = applyFontDialogForTest(state, draft);
  assert.ok(applied);
  const text = applied.doc.child(0).child(0);
  assert.equal(text.marks.some((mark) => mark.type.name === 'bold'), true);
  assert.equal(text.marks.some((mark) => mark.type.name === 'italic'), true);
  assert.equal(text.marks.some((mark) => mark.type.name === 'underline'), true);
  assert.equal(text.marks.some((mark) => mark.type.name === 'fontFamily' && mark.attrs.family === 'Carlito'), true);

  state = insertText(createTabEditorState(), 'Next');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 2)));
  assert.equal(fontDialogValueFromState(state).style, 'regular');
  const caret = applyFontDialogForTest(state, draft);
  assert.ok(caret);
  assert.ok(caret.storedMarks && caret.storedMarks.length > 0);
});