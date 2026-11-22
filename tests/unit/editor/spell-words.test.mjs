import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeHistory, undo } from 'prosemirror-history';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tokenizeUrl = new URL('../../../src/renderer/editor/spell/tokenize.ts', import.meta.url);
const rangesUrl = new URL('../../../src/renderer/editor/spell/ranges.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const engineUrl = new URL('../../../src/main/spell/engine.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const viewUrl = new URL('../../../src/renderer/editor/spell/view.ts', import.meta.url);
const modeUrl = new URL('../../../src/renderer/editor/spellcheck-mode.ts', import.meta.url);
const wordsUrl = new URL('../../../src/main/spell/user-words.ts', import.meta.url);

const BLOCK_A = '00000000-0000-4000-8000-000000000001';
const BLOCK_B = '00000000-0000-4000-8000-000000000002';
const BLOCK_C = '00000000-0000-4000-8000-000000000003';

function wordsOf(tokens) {
  return tokens.filter((token) => token.skip === null).map((token) => token.word);
}

test('words keep apostrophes and capitals', async () => {
  const { tokenizeText } = await loadRenderer(tokenizeUrl);
  assert.deepEqual(wordsOf(tokenizeText("Hello don't")), ['Hello', "don't"]);
});

test('urls and words with digits are skipped', async () => {
  const { tokenizeText } = await loadRenderer(tokenizeUrl);
  assert.deepEqual(wordsOf(tokenizeText('see https://example.com/hllo now')), ['see', 'now']);
  assert.deepEqual(wordsOf(tokenizeText('Visit www.example.com today')), ['Visit', 'today']);
  assert.deepEqual(tokenizeText('helo2').map((token) => token.skip), ['digit']);
  assert.deepEqual(wordsOf(tokenizeText('helo2 wrld')), ['wrld']);
});

async function schema() {
  const loaded = await loadRenderer(schemaUrl);
  return loaded.editorSchema;
}

function paragraph(typeSchema, text, blockId) {
  return typeSchema.nodes.paragraph.create(
    { blockId },
    text.length > 0 ? typeSchema.text(text) : null,
  );
}

test('ranges skip the word being typed, code, urls, and digits', async () => {
  const { spellingSpans, spanAt, wordSpans } = await loadRenderer(rangesUrl);
  const typeSchema = await schema();
  const doc = typeSchema.nodes.doc.create(null, [paragraph(typeSchema, 'helo wrld', BLOCK_A)]);
  const marked = spellingSpans(doc, null, (word) => word === 'helo');
  assert.deepEqual(marked, [{ from: 1, to: 5, word: 'helo' }]);
  assert.equal(spanAt(marked, 3)?.word, 'helo');
  assert.deepEqual(spellingSpans(doc, 5, () => true), [{ from: 6, to: 10, word: 'wrld' }]);
  const code = typeSchema.nodes.code_block.create({ blockId: BLOCK_C }, typeSchema.text('hllo'));
  assert.deepEqual(wordSpans(typeSchema.nodes.doc.create(null, [code])), []);
  const inline = typeSchema.nodes.paragraph.create({ blockId: BLOCK_A }, [
    typeSchema.text('say '),
    typeSchema.text('helo', [typeSchema.marks.code.create()]),
    typeSchema.text(' there'),
  ]);
  assert.deepEqual(
    wordSpans(typeSchema.nodes.doc.create(null, [inline])).map((span) => span.word),
    ['say', 'there'],
  );
  const mixed = typeSchema.nodes.doc.create(null, [
    paragraph(typeSchema, 'see https://example.com/hllo now', BLOCK_A),
    paragraph(typeSchema, 'helo2 wrld', BLOCK_B),
  ]);
  assert.deepEqual(wordSpans(mixed).map((span) => span.word), ['see', 'now', 'wrld']);
});

test('the bundled dictionary marks hllo and accepts hello', async () => {
  const { createSpellEngine } = await loadRenderer(engineUrl);
  const aff = readFileSync(path.join(root, 'assets', 'spell', 'en-US.aff'));
  const dic = readFileSync(path.join(root, 'assets', 'spell', 'en-US.dic'));
  const spell = createSpellEngine(aff, dic);
  assert.equal(spell.misspelled('hllo'), true);
  assert.equal(spell.misspelled('hello'), false);
  assert.equal(spell.misspelled('Hello'), false);
  assert.equal(spell.misspelled("don't"), false);
  assert.equal(spell.misspelled('ok'), false);
  assert.equal(spell.misspelled('okay'), false);
  assert.equal(spell.misspelled('OK'), false);
  assert.equal(spell.suggestions('hllo').includes('hello'), true);
  spell.add('hllo');
  assert.equal(spell.misspelled('hllo'), false);
});

test('undo underlines a restored misspelling while the caret is still on it', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  window.obelisk = {
    'spell:check': ({ words }) => Promise.resolve({
      status: 'ok',
      misspelled: words.filter((word) => word === 'hllo'),
    }),
  };
  mock.timers.enable({ apis: ['setTimeout'] });
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { latestUnderlinedWords, SPELL_DEBOUNCE_MS } = await loadRenderer(viewUrl);
  const { setSpellcheckEnabled } = await loadRenderer(modeUrl);
  setSpellcheckEnabled(true);
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView(host, {
    state: insertText(createTabEditorState(), 'hllo'),
    attributes: { class: 'page-sheet' },
  });
  try {
    view.dispatch(closeHistory(view.state.tr));
    view.dispatch(view.state.tr.insertText('hello', 1, 5));
    assert.equal(view.state.doc.textContent, 'hello');
    undo(view.state, view.dispatch.bind(view));
    assert.equal(view.state.doc.textContent, 'hllo');
    mock.timers.tick(SPELL_DEBOUNCE_MS);
    for (let step = 0; step < 6; step += 1) {
      await Promise.resolve();
    }
    assert.deepEqual(latestUnderlinedWords(), ['hllo']);
  } finally {
    view.destroy();
    mock.timers.reset();
    restore();
  }
});

test('a user dictionary word is saved and read back', async () => {
  const { addUserWord, readUserWords } = await loadRenderer(wordsUrl);
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-dict-'));
  try {
    assert.deepEqual(readUserWords(dir), []);
    addUserWord(dir, 'Obelisk');
    addUserWord(dir, 'Obelisk');
    assert.deepEqual(readUserWords(dir), ['Obelisk']);
    const { createSpellEngine } = await loadRenderer(engineUrl);
    const aff = readFileSync(path.join(root, 'assets', 'spell', 'en-US.aff'));
    const dic = readFileSync(path.join(root, 'assets', 'spell', 'en-US.dic'));
    const spell = createSpellEngine(aff, dic, readUserWords(dir));
    assert.equal(spell.misspelled('Obelisk'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
