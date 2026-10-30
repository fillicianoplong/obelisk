import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { FONT_SIZES_PT } from '../../../dist/shared/schema/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from './load-renderer.mjs';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const formatUrl = new URL('../../../src/renderer/editor/format-commands.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/editor/format/reference.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const menuUrl = new URL('../../../src/renderer/shell/menus/model.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema/index.ts', import.meta.url);

const WRITER = '0.1.28.0';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(content) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
  };
}

function documentWithRun(marks) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [paragraph([{ type: 'text', text: 'Sample', marks }])],
  };
}

const FORMAT_MARK_CASES = [
  ['bold', { bold: true }],
  ['italic', { italic: true }],
  ['underline', { underline: true }],
  ['strike', { strike: true }],
  ['code', { code: true }],
  ['superscript', { superscript: true }],
  ['subscript', { subscript: true }],
  ['font', { font: 'Liberation Sans' }],
  ['size', { size: 14 }],
  ['color', { color: '#112233' }],
  ['highlight', { highlight: '#445566' }],
];

test('the editor schema exposes every character mark', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  assert.deepEqual(Object.keys(editorSchema.marks).sort(), [
    'bold',
    'code',
    'fontFamily',
    'fontSize',
    'highlight',
    'italic',
    'strike',
    'subscript',
    'superscript',
    'textColor',
    'underline',
  ]);
});

test('Format > Font size lists only the formatting reference sizes', async () => {
  const { APP_MENUS } = await loadRenderer(menuUrl);
  const format = APP_MENUS.find((menu) => menu.id === 'format');
  const sizeMenu = format.entries.find((entry) => entry.id === 'format-size');
  assert.ok(sizeMenu && sizeMenu.submenu);
  const ids = sizeMenu.submenu.filter((entry) => !('separator' in entry)).map((entry) => entry.id);
  assert.deepEqual(
    ids,
    FONT_SIZES_PT.map((pt) => `format-size-${pt}`),
  );
});

for (const [name, marks] of FORMAT_MARK_CASES) {
  test(`character mark ${name} round-trips through the editor and codec`, async () => {
    const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
    const base = documentWithRun(marks);
    const doc = editorDocFromDocument(base);
    const built = documentFromEditorDoc(base, doc, () => id(99));
    assert.equal(JSON.stringify(built.document.blocks[0].content), JSON.stringify(base.blocks[0].content));

    const encoded = await encodeObk(base, emptyManifest(WRITER));
    assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);
    const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-format-'));
    const file = path.join(directory, 'sample.obk');
    try {
      await writeFile(file, encoded.bytes);
      const decoded = await decodeObk(file);
      assert.equal(decoded.ok, true, decoded.ok ? '' : decoded.message);
      assert.equal(JSON.stringify(decoded.document.blocks[0].content), JSON.stringify(base.blocks[0].content));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('clear formatting removes every character mark', async () => {
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { applyCharacterMarksForTest, clearCharacterFormatting } = await loadRenderer(formatUrl);
  let state = createTabEditorState();
  state = insertText(state, 'Rich text');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
  state = applyCharacterMarksForTest(state, {
    bold: true,
    italic: true,
    underline: true,
    strike: true,
    code: true,
    font: 'Carlito',
    size: 20,
    color: '#112233',
    highlight: '#445566',
  });
  assert.ok(state);
  const cleared = clearCharacterFormatting(state);
  assert.ok(cleared);
  const text = cleared.doc.child(0).child(0);
  assert.equal(text.marks.length, 0);
});

test('editor text includes every text block type', async () => {
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState, editorText } = await loadRenderer(stateUrl);
  const base = {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [
      paragraph([{ type: 'text', text: 'Body' }]),
      { type: 'heading', id: id(4), level: 1, content: [{ type: 'text', text: 'Title' }] },
      { type: 'list', id: id(5), style: 'bulleted', items: [{ level: 0, content: [{ type: 'text', text: 'Item' }] }] },
      { type: 'quote', id: id(6), content: [{ type: 'text', text: 'Quote' }] },
      { type: 'code', id: id(7), text: 'x = 1\n' },
    ],
  };
  const state = createTabEditorState(editorDocFromDocument(base));
  assert.equal(editorText(state), 'Body\nTitle\nItem\nQuote\nx = 1\n');
});

test('bundled fonts match the fonts reference menu list', async () => {
  const { BUNDLED_FONT_FAMILIES } = await loadRenderer(referenceUrl);
  const { APP_MENUS } = await loadRenderer(menuUrl);
  const format = APP_MENUS.find((menu) => menu.id === 'format');
  const fontMenu = format.entries.find((entry) => entry.id === 'format-font');
  const labels = fontMenu.submenu.filter((entry) => !('separator' in entry)).map((entry) => entry.label);
  assert.deepEqual([...BUNDLED_FONT_FAMILIES], labels);
});
