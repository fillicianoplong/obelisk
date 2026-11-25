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

test('a word range stops before the space and before punctuation', async () => {
  const editorSchema = await schema();
  const { wordRangeAt, textblockRangeAt, extendTextblockSelection, extendCharacterSelection } = await loadRenderer(wordUrl);
  const doc = editorSchema.node('doc', null, [
    paragraph(editorSchema, 3, 'Alpha beta gamma.'),
    paragraph(editorSchema, 4, 'Delta end '),
    paragraph(editorSchema, 5, "don't stop"),
  ]);
  const beta = textPos(doc, 'beta');
  assert.deepEqual(wordRangeAt(doc, beta.from + 1), { from: beta.from, to: beta.to });
  assert.deepEqual(wordRangeAt(doc, beta.to), { from: beta.from, to: beta.to });
  const gamma = textPos(doc, 'gamma');
  assert.deepEqual(wordRangeAt(doc, gamma.to), { from: gamma.from, to: gamma.to });
  const end = textPos(doc, 'end');
  assert.deepEqual(wordRangeAt(doc, end.to + 1), { from: end.from, to: end.to });
  const dont = textPos(doc, "don't");
  assert.deepEqual(wordRangeAt(doc, dont.from + 3), { from: dont.from, to: dont.to });

  const first = textblockRangeAt(doc, beta.from);
  const second = textblockRangeAt(doc, end.from);
  assert.equal(doc.textBetween(first.from, first.to), 'Alpha beta gamma.');
  const extended = extendTextblockSelection(doc, first, end.from);
  assert.equal(doc.textBetween(Math.min(extended.anchor, extended.head), Math.max(extended.anchor, extended.head), '\n'), 'Alpha beta gamma.\nDelta end ');
  assert.deepEqual(extendTextblockSelection(doc, first, beta.from), { anchor: first.from, head: first.to });
  const upward = extendTextblockSelection(doc, second, beta.from);
  assert.equal(upward.anchor, second.to);
  assert.equal(upward.head, first.from);
  assert.deepEqual(extendCharacterSelection(beta, beta.to + 3), { anchor: beta.from, head: beta.to + 3 });
  assert.deepEqual(extendCharacterSelection(beta, beta.from + 1), { anchor: beta.from, head: beta.to });
});

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
