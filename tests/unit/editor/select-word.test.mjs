import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom } from './dom-test-helpers.mjs';

const wordUrl = new URL('../../../src/renderer/editor/select-word.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function schema() {
  const { editorSchema } = await loadRenderer(schemaUrl);
  return editorSchema;
}

function paragraph(editorSchema, n, text) {
  return editorSchema.nodes.paragraph.create(
    { blockId: id(n) },
    text.length > 0 ? editorSchema.text(text) : null,
  );
}

function textPos(doc, word) {
  let seen = 0;
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    const at = child.textContent.indexOf(word);
    if (at >= 0) {
      const from = pos + 1 + at;
      return { from, to: from + word.length };
    }
    seen += child.textContent.length;
    pos += child.nodeSize;
  }
  throw new Error(`${word} missing after ${seen}`);
}

test('a double-clicked word drops the space after it and keeps punctuation', async () => {
  const editorSchema = await schema();
  const { selectionWithoutTrailingSpace } = await loadRenderer(wordUrl);
  const doc = editorSchema.node('doc', null, [
    paragraph(editorSchema, 3, 'Alpha beta gamma.'),
    paragraph(editorSchema, 4, 'Delta end '),
  ]);
  const beta = textPos(doc, 'beta');
  assert.deepEqual(
    selectionWithoutTrailingSpace(doc, beta.from, beta.from + 'beta '.length),
    { from: beta.from, to: beta.to },
  );
  assert.equal(selectionWithoutTrailingSpace(doc, beta.from, beta.to), null);

  const gamma = textPos(doc, 'gamma.');
  assert.equal(selectionWithoutTrailingSpace(doc, gamma.from, gamma.to), null);

  const end = textPos(doc, 'end');
  assert.deepEqual(
    selectionWithoutTrailingSpace(doc, end.from, end.from + 'end '.length),
    { from: end.from, to: end.to },
  );
  assert.equal(selectionWithoutTrailingSpace(doc, end.from, end.to), null);

  assert.equal(selectionWithoutTrailingSpace(doc, 1, doc.child(0).nodeSize + 2), null);
  assert.equal(selectionWithoutTrailingSpace(doc, beta.to, beta.to + 1), null);
});

test('trimming the word keeps the caret side and is not an edge jump', async () => {
  const editorSchema = await schema();
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { trimDoubleClickedWord } = await loadRenderer(wordUrl);
  const { document, window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  const doc = editorSchema.node('doc', null, [paragraph(editorSchema, 3, 'Alpha beta gamma.')]);
  let state = createTabEditorState(doc);
  const beta = doc.textContent.indexOf('beta');
  const from = 1 + beta;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 'beta '.length)));
  const view = new EditorView(host, { state });
  try {
    assert.equal(trimDoubleClickedWord(view), true);
    assert.equal(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to), 'beta');
    assert.equal(view.state.selection.head, from + 'beta'.length);
    assert.equal(trimDoubleClickedWord(view), false);
  } finally {
    view.destroy();
    restore();
  }
});
