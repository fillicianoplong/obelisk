import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import {
  ALIGNMENTS,
  INDENT_STEP_IN,
  LINE_SPACINGS,
  SPACE_BEFORE_AFTER_PT,
} from '../../../dist/shared/schema/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from './load-renderer.mjs';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const paragraphUrl = new URL('../../../src/renderer/editor/paragraph-format-commands.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/editor/format/reference.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const formatUrl = new URL('../../../src/renderer/editor/format-commands.ts', import.meta.url);

const WRITER = '0.1.29.0';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(content, format = {}) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
    ...format,
  };
}

function documentWithParagraph(format) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [paragraph([{ type: 'text', text: 'Sample' }], format)],
  };
}

test('stepIndentInches moves in quarter-inch steps within the formatting reference', async () => {
  const { stepIndentInches } = await loadRenderer(referenceUrl);
  assert.equal(stepIndentInches(0, 1), INDENT_STEP_IN);
  assert.equal(stepIndentInches(0.5, 1), 0.75);
  assert.equal(stepIndentInches(3, 1), 3);
  assert.equal(stepIndentInches(0, -1), 0);
});

for (const align of ALIGNMENTS) {
  test(`paragraph alignment ${align} round-trips through the editor and codec`, async () => {
    const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
    const { applyParagraphFormatForTest } = await loadRenderer(paragraphUrl);
    const { createTabEditorState } = await loadRenderer(stateUrl);
    const base = documentWithParagraph({ align });
    const state = createTabEditorState(editorDocFromDocument(base));
    const applied = applyParagraphFormatForTest(state, { align });
    assert.ok(applied);
    const built = documentFromEditorDoc(base, applied.doc, () => id(99));
    assert.equal(built.document.blocks[0].align, align);

    const encoded = await encodeObk(built.document, emptyManifest(WRITER));
    assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);
    const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-paragraph-'));
    const file = path.join(directory, 'sample.obk');
    try {
      await writeFile(file, encoded.bytes);
      const decoded = await decodeObk(file);
      assert.equal(decoded.ok, true, decoded.ok ? '' : decoded.message);
      assert.equal(decoded.document.blocks[0].align, align);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const lineSpacing of LINE_SPACINGS) {
  test(`paragraph line spacing ${lineSpacing} round-trips`, async () => {
    const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
    const { applyParagraphFormatForTest } = await loadRenderer(paragraphUrl);
    const { createTabEditorState } = await loadRenderer(stateUrl);
    const base = documentWithParagraph({ lineSpacing });
    const state = createTabEditorState(editorDocFromDocument(base));
    const applied = applyParagraphFormatForTest(state, { lineSpacing });
    assert.ok(applied);
    const built = documentFromEditorDoc(base, applied.doc, () => id(99));
    assert.equal(built.document.blocks[0].lineSpacing, lineSpacing);
  });
}

for (const spaceBefore of SPACE_BEFORE_AFTER_PT) {
  test(`paragraph space before ${spaceBefore} pt round-trips`, async () => {
    const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
    const { applyParagraphFormatForTest } = await loadRenderer(paragraphUrl);
    const { createTabEditorState } = await loadRenderer(stateUrl);
    const base = documentWithParagraph({ spaceBefore });
    const state = createTabEditorState(editorDocFromDocument(base));
    const applied = applyParagraphFormatForTest(state, { spaceBefore });
    assert.ok(applied);
    const built = documentFromEditorDoc(base, applied.doc, () => id(99));
    assert.equal(built.document.blocks[0].spaceBefore, spaceBefore);
  });
}

for (const spaceAfter of SPACE_BEFORE_AFTER_PT) {
  test(`paragraph space after ${spaceAfter} pt round-trips`, async () => {
    const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
    const { applyParagraphFormatForTest } = await loadRenderer(paragraphUrl);
    const { createTabEditorState } = await loadRenderer(stateUrl);
    const base = documentWithParagraph({ spaceAfter });
    const state = createTabEditorState(editorDocFromDocument(base));
    const applied = applyParagraphFormatForTest(state, { spaceAfter });
    assert.ok(applied);
    const built = documentFromEditorDoc(base, applied.doc, () => id(99));
    assert.equal(built.document.blocks[0].spaceAfter, spaceAfter);
  });
}

test('hanging indent 0.5 in round-trips for Works Cited style', async () => {
  const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
  const { applyParagraphFormatForTest } = await loadRenderer(paragraphUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const base = documentWithParagraph({
    indents: { left: 0, first: 0, hanging: 0.5 },
  });
  const state = createTabEditorState(editorDocFromDocument(base));
  const applied = applyParagraphFormatForTest(state, { indentHanging: 0.5, indentFirst: 0 });
  assert.ok(applied);
  const built = documentFromEditorDoc(base, applied.doc, () => id(99));
  assert.deepEqual(built.document.blocks[0].indents, { left: 0, first: 0, hanging: 0.5 });
});

test('Format > Increase indent and Decrease indent move the left indent one step', async () => {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { runFormatMenuCommand } = await loadRenderer(formatUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const base = documentWithParagraph({});
  let state = createTabEditorState(editorDocFromDocument(base));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 1)));
  const increased = runFormatMenuCommand(state, 'format-indent-increase');
  assert.ok(increased);
  assert.equal(increased.doc.child(0).attrs.indentLeft, INDENT_STEP_IN);
  const decreased = runFormatMenuCommand(increased, 'format-indent-decrease');
  assert.ok(decreased);
  assert.equal(decreased.doc.child(0).attrs.indentLeft, 0);
});

test('Enter keeps paragraph format and active character marks on the new paragraph', async () => {
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { applyParagraphFormatForTest, splitParagraphKeepingFormat } = await loadRenderer(paragraphUrl);
  const { applyCharacterMarksForTest } = await loadRenderer(formatUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const base = documentWithParagraph({
    align: 'center',
    lineSpacing: 'double',
    spaceBefore: 6,
    spaceAfter: 12,
    indents: { left: 0.5, first: 0, hanging: 0 },
  });
  let state = createTabEditorState(editorDocFromDocument(base));
  state = insertText(state, 'Line one');
  state = applyParagraphFormatForTest(state, {
    align: 'center',
    lineSpacing: 'double',
    spaceBefore: 6,
    spaceAfter: 12,
    indentLeft: 0.5,
  });
  assert.ok(state);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 9)));
  state = applyCharacterMarksForTest(state, { bold: true, size: 14 });
  assert.ok(state);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  const split = splitParagraphKeepingFormat()(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(split, true);
  assert.equal(state.doc.childCount, 2);
  const second = state.doc.child(1);
  assert.equal(second.attrs.align, 'center');
  assert.equal(second.attrs.lineSpacing, 'double');
  assert.equal(second.attrs.spaceBefore, 6);
  assert.equal(second.attrs.spaceAfter, 12);
  assert.equal(second.attrs.indentLeft, 0.5);
  assert.notEqual(second.attrs.blockId, state.doc.child(0).attrs.blockId);
  assert.ok(state.schema.marks.bold.isInSet(state.storedMarks ?? []));
});
