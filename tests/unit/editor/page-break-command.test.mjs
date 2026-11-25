import assert from 'node:assert/strict';
import test from 'node:test';
import { undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const keysUrl = new URL('../../../src/renderer/editor/keymap/editor-keys.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function types(doc) {
  return Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name);
}

test('a page break splits a block at the caret', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { insertPageBreakCommand } = await loadRenderer(keysUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const paragraph = editorSchema.nodes.paragraph.create(
    { blockId: id(1) },
    editorSchema.text('Hello world'),
  );
  let state = createTabEditorState(editorSchema.node('doc', null, [paragraph, editorSchema.nodes.paragraph.create(
    { blockId: id(2) },
    editorSchema.text('Next'),
  )]));
  const middle = 1 + 'Hello '.length;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, middle)));
  let next = null;
  assert.equal(insertPageBreakCommand()(state, (tr) => {
    next = state.apply(tr);
  }), true);
  assert.deepEqual(types(next.doc), ['paragraph', 'page_break', 'paragraph', 'paragraph']);
  assert.equal(next.doc.child(0).textContent, 'Hello ');
  assert.equal(next.doc.child(0).attrs.blockId, id(1));
  assert.equal(next.doc.child(2).textContent, 'world');
  assert.notEqual(next.doc.child(2).attrs.blockId, id(1));
  assert.equal(next.doc.child(3).textContent, 'Next');
  assert.equal(next.selection.empty, true);
  assert.equal(next.doc.textBetween(next.selection.from, next.selection.from + 5), 'world');

  let restored = null;
  assert.equal(undo(next, (tr) => {
    restored = next.apply(tr);
  }), true);
  assert.equal(restored.doc.textContent, 'Hello worldNext');
  assert.deepEqual(types(restored.doc), ['paragraph', 'paragraph']);
  assert.equal(undo(restored, () => {}), false);
});

test('a page break at the end of a block opens an empty block', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { insertPageBreakCommand } = await loadRenderer(keysUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const heading = editorSchema.nodes.heading.create(
    { blockId: id(3), level: 2 },
    editorSchema.text('Title'),
  );
  let state = createTabEditorState(editorSchema.node('doc', null, [heading]));
  const end = 1 + 'Title'.length;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  let next = null;
  insertPageBreakCommand()(state, (tr) => {
    next = state.apply(tr);
  });
  assert.deepEqual(types(next.doc), ['heading', 'page_break', 'heading']);
  assert.equal(next.doc.child(0).textContent, 'Title');
  assert.equal(next.doc.child(2).textContent, '');
  assert.equal(next.doc.child(2).attrs.level, 2);
  assert.equal(next.selection.empty, true);
  assert.equal(next.selection.$from.parent.type.name, 'heading');
  assert.equal(next.selection.$from.parentOffset, 0);
});

test('a page break replaces a selection and then splits', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { insertPageBreakCommand } = await loadRenderer(keysUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const paragraph = editorSchema.nodes.paragraph.create(
    { blockId: id(4) },
    editorSchema.text('Hello beautiful world'),
  );
  let state = createTabEditorState(editorSchema.node('doc', null, [paragraph]));
  const from = 1 + 'Hello'.length;
  const to = from + ' beautiful '.length;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  let next = null;
  insertPageBreakCommand()(state, (tr) => {
    next = state.apply(tr);
  });
  assert.deepEqual(types(next.doc), ['paragraph', 'page_break', 'paragraph']);
  assert.equal(next.doc.child(0).textContent, 'Hello');
  assert.equal(next.doc.child(2).textContent, 'world');
  assert.equal(next.doc.textBetween(next.selection.from, next.selection.from + 5), 'world');

  let restored = null;
  undo(next, (tr) => {
    restored = next.apply(tr);
  });
  assert.equal(restored.doc.textContent, 'Hello beautiful world');
  assert.equal(restored.doc.childCount, 1);
});

test('a page break splits a list item and keeps the list on both sides', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { insertPageBreakCommand } = await loadRenderer(keysUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const list = editorSchema.nodes.bullet_list.create({ blockId: id(5) }, [
    editorSchema.nodes.list_item.create({ level: 0 }, editorSchema.text('Hello world')),
    editorSchema.nodes.list_item.create({ level: 0 }, editorSchema.text('Next')),
  ]);
  let state = createTabEditorState(editorSchema.node('doc', null, [list]));
  const middle = 2 + 'Hello '.length;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, middle)));
  let next = null;
  insertPageBreakCommand()(state, (tr) => {
    next = state.apply(tr);
  });
  assert.deepEqual(types(next.doc), ['bullet_list', 'page_break', 'bullet_list']);
  assert.equal(next.doc.child(0).textContent, 'Hello ');
  assert.equal(next.doc.child(0).attrs.blockId, id(5));
  assert.equal(next.doc.child(2).textContent, 'worldNext');
  assert.notEqual(next.doc.child(2).attrs.blockId, id(5));
  assert.equal(next.doc.child(2).childCount, 2);
  assert.equal(next.doc.textBetween(next.selection.from, next.selection.from + 5), 'world');
});
