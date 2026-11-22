import assert from 'node:assert/strict';
import test from 'node:test';
import { closeHistory, undo, undoDepth } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom } from './dom-test-helpers.mjs';

const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const replaceUrl = new URL('../../../src/renderer/editor/spell-replace.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/contextmenu/model.ts', import.meta.url);

async function viewWithText(text) {
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  let state = createTabEditorState();
  state = insertText(state, text);
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet' },
  });
  return { view, restore };
}

test('a spelling suggestion replaces the word under the caret in one undo step', async () => {
  const { replaceSpellingSuggestion } = await loadRenderer(replaceUrl);
  const { view, restore } = await viewWithText('Say helo there');
  try {
    const helo = view.state.doc.textContent.indexOf('helo');
    const caret = 1 + helo + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret, caret)));
    view.dispatch(closeHistory(view.state.tr));
    const before = undoDepth(view.state);
    const tr = replaceSpellingSuggestion(view.state, 'helo', 'hello');
    assert.ok(tr);
    view.dispatch(tr);
    assert.equal(view.state.doc.textContent, 'Say hello there');
    const helloAt = view.state.doc.textContent.indexOf('hello');
    assert.equal(view.state.selection.head, 1 + helloAt + 'hello'.length);
    assert.equal(undoDepth(view.state), before + 1);
    undo(view.state, view.dispatch.bind(view));
    assert.equal(view.state.doc.textContent, 'Say helo there');
    assert.equal(undoDepth(view.state), before);
  } finally {
    view.destroy();
    restore();
  }
});

test('a suggestion does not replace a different copy of the word', async () => {
  const { replaceSpellingSuggestion } = await loadRenderer(replaceUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  let state = insertText(createTabEditorState(), 'helo and helo');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 3)));
  const tr = replaceSpellingSuggestion(state, 'helo', 'hello');
  assert.ok(tr);
  const next = state.apply(tr);
  assert.equal(next.doc.textContent, 'hello and helo');
});

test('code and inline code are left out of spell check', async () => {
  const { view, restore } = await viewWithText('note');
  try {
    const code = view.state.schema.nodes.code_block.create(
      { blockId: '00000000-0000-4000-8000-000000000010' },
      view.state.schema.text('alpha'),
    );
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, code));
    const pre = view.dom.querySelector('pre[data-code-block]');
    const inner = view.dom.querySelector('pre[data-code-block] code');
    assert.equal(pre.getAttribute('spellcheck'), 'false');
    assert.equal(inner.getAttribute('spellcheck'), 'false');
    const marked = view.state.schema.text('beta', [view.state.schema.marks.code.create()]);
    const paragraph = view.state.schema.nodes.paragraph.create({
      blockId: '00000000-0000-4000-8000-000000000011',
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indentLeft: 0,
      indentFirst: 0,
      indentHanging: 0,
    }, marked);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, paragraph));
    assert.equal(view.dom.querySelector('code.inline-code').getAttribute('spellcheck'), 'false');
  } finally {
    view.destroy();
    restore();
  }
});

test('a misspelled word replaces the spelling placeholder with suggestions', async () => {
  const model = await loadRenderer(modelUrl);
  const entries = model.withSpellingSuggestions(model.composeContextMenu('text'), {
    word: 'helo',
    suggestions: ['hello', 'help', 'one', 'two', 'three', 'four'],
  });
  const labels = model.menuEntryLabels(entries);
  assert.deepEqual(labels.slice(0, 6), ['hello', 'help', 'one', 'two', 'three', 'Add to dictionary']);
  assert.equal(labels.includes('four'), false);
  assert.equal(labels.includes('Spelling suggestions'), false);
  assert.equal(labels[labels.indexOf('Add to dictionary') + 1], 'Cut');
  const none = model.menuEntryLabels(model.withSpellingSuggestions(model.composeContextMenu('text'), {
    word: 'helo',
    suggestions: [],
  }));
  assert.equal(none[0], 'No suggestions');
  assert.equal(none[1], 'Add to dictionary');
  const plain = model.menuEntryLabels(model.withSpellingSuggestions(model.composeContextMenu('text'), null));
  assert.equal(plain[0], 'Spelling suggestions');
});

test('the spelling word is the one under the caret, not code', async () => {
  const { wordAroundCaret } = await loadRenderer(replaceUrl);
  const { createTabEditorState, insertText, setCaret } = await loadRenderer(stateUrl);
  let state = insertText(createTabEditorState(), 'Say hllo there');
  const start = state.doc.textContent.indexOf('hllo');
  state = setCaret(state, 1 + start + 2);
  assert.equal(wordAroundCaret(state), 'hllo');
  const code = state.schema.nodes.code_block.create(
    { blockId: '00000000-0000-4000-8000-000000000010' },
    state.schema.text('hllo'),
  );
  const coded = state.apply(state.tr.replaceWith(0, state.doc.content.size, code));
  const inCode = coded.apply(coded.tr.setSelection(TextSelection.create(coded.doc, 3, 3)));
  assert.equal(wordAroundCaret(inCode), null);
});
