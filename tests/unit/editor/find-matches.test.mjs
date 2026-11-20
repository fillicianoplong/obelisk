import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from './load-renderer.mjs';

const matchesUrl = new URL('../../../src/renderer/editor/find/matches.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const blockCommandsUrl = new URL('../../../src/renderer/editor/block-commands.ts', import.meta.url);

test('find lists five literal matches across the document (FR-59)', async () => {
  const { findMatches } = await loadRenderer(matchesUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { insertTextBlock } = await loadRenderer(blockCommandsUrl);
  const { newBlockId } = await loadRenderer(new URL('../../../src/renderer/editor/block-id.ts', import.meta.url));

  let state = createTabEditorState();
  const text = 'cat in one cat in two cat in three cat in four cat in five';
  let tr = insertTextBlock(state.tr, 'paragraph', newBlockId, { text });
  state = state.apply(tr);

  const matches = findMatches(state.doc, { query: 'cat', matchCase: false, wholeWord: true });
  assert.equal(matches.length, 5);
});

test('match case narrows matches (FR-58)', async () => {
  const { findMatches } = await loadRenderer(matchesUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { insertTextBlock } = await loadRenderer(blockCommandsUrl);
  const { newBlockId } = await loadRenderer(new URL('../../../src/renderer/editor/block-id.ts', import.meta.url));

  let state = createTabEditorState();
  let tr = insertTextBlock(state.tr, 'paragraph', newBlockId, { text: 'Cat cat CAT' });
  state = state.apply(tr);

  assert.equal(
    findMatches(state.doc, { query: 'cat', matchCase: true, wholeWord: true }).length,
    1,
  );
  assert.equal(
    findMatches(state.doc, { query: 'cat', matchCase: false, wholeWord: true }).length,
    3,
  );
});

test('whole word skips matches inside longer words (FR-58)', async () => {
  const { findMatches } = await loadRenderer(matchesUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { insertTextBlock } = await loadRenderer(blockCommandsUrl);
  const { newBlockId } = await loadRenderer(new URL('../../../src/renderer/editor/block-id.ts', import.meta.url));

  let state = createTabEditorState();
  let tr = insertTextBlock(state.tr, 'paragraph', newBlockId, { text: 'category cat scatter' });
  state = state.apply(tr);

  assert.equal(
    findMatches(state.doc, { query: 'cat', matchCase: false, wholeWord: false }).length,
    3,
  );
  assert.equal(
    findMatches(state.doc, { query: 'cat', matchCase: false, wholeWord: true }).length,
    1,
  );
});

test('an empty query returns no matches and does not throw', async () => {
  const { findMatches } = await loadRenderer(matchesUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  assert.deepEqual(findMatches(state.doc, { query: '', matchCase: false, wholeWord: false }), []);
});