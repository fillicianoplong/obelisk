import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from './load-renderer.mjs';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const blockCommandsUrl = new URL('../../../src/renderer/editor/block-commands.ts', import.meta.url);
const documentUrl = new URL('../../../src/renderer/shell/tabs/document.ts', import.meta.url);
const saveUrl = new URL('../../../src/renderer/shell/tabs/save.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);
const kindsUrl = new URL('../../../src/renderer/editor/schema/index.ts', import.meta.url);

const WRITER = '0.1.28.0';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function sampleDocument() {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [
      { type: 'paragraph', id: id(3), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', id: id(4), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [{ type: 'text', text: 'Two' }] },
      { type: 'heading', id: id(5), level: 2, content: [{ type: 'text', text: 'Title A' }] },
      { type: 'heading', id: id(6), level: 4, content: [{ type: 'text', text: 'Title B' }] },
      { type: 'list', id: id(7), style: 'bulleted', items: [{ level: 0, content: [{ type: 'text', text: 'Bullet A' }] }] },
      { type: 'list', id: id(8), style: 'bulleted', items: [{ level: 1, content: [{ type: 'text', text: 'Bullet B' }] }] },
      { type: 'list', id: id(9), style: 'numbered', items: [{ level: 0, content: [{ type: 'text', text: 'Number A' }] }] },
      { type: 'list', id: id(10), style: 'numbered', items: [{ level: 0, content: [{ type: 'text', text: 'Number B' }] }] },
      { type: 'list', id: id(11), style: 'checklist', items: [{ level: 0, checked: false, content: [{ type: 'text', text: 'Task A' }] }] },
      { type: 'list', id: id(12), style: 'checklist', items: [{ level: 0, checked: true, content: [{ type: 'text', text: 'Task B' }] }] },
      { type: 'quote', id: id(13), content: [{ type: 'text', text: 'Quote A' }] },
      { type: 'quote', id: id(14), content: [{ type: 'text', text: 'Quote B' }] },
      { type: 'code', id: id(15), text: 'alpha();\n' },
      { type: 'code', id: id(16), text: 'beta();\n' },
      { type: 'divider', id: id(17) },
      { type: 'divider', id: id(18) },
      { type: 'pageBreak', id: id(19) },
      { type: 'pageBreak', id: id(20) },
    ],
  };
}

test('every text block kind is listed for insert commands', async () => {
  const { TEXT_BLOCK_KINDS } = await loadRenderer(kindsUrl);
  assert.deepEqual(TEXT_BLOCK_KINDS, [
    'paragraph',
    'heading',
    'bulleted-list',
    'numbered-list',
    'checklist',
    'quote',
    'code',
    'divider',
    'page-break',
  ]);
});

test('two of each text block round-trip through the editor and codec', async () => {
  const { editorDocFromDocument, documentFromEditorDoc, editorBlockSnapshot } = await loadRenderer(mappingUrl);
  const { documentFromEditor } = await loadRenderer(documentUrl);
  const base = sampleDocument();
  const doc = editorDocFromDocument(base);
  assert.equal(editorBlockSnapshot(doc).length, base.blocks.length);
  const built = documentFromEditorDoc(base, doc, () => id(99));
  assert.equal(built.unchanged, true);
  assert.equal(built.document, base);

  const encoded = await encodeObk(base, emptyManifest(WRITER));
  assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-text-blocks-'));
  const file = path.join(directory, 'sample.obk');
  try {
    await writeFile(file, encoded.bytes);
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, decoded.ok ? '' : decoded.message);
    const reopened = editorDocFromDocument(decoded.document);
    const resaved = documentFromEditor(base, reopened);
    assert.deepEqual(resaved.document.blocks, base.blocks);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('editing a text block marks the document changed and duplicate or paste mints a new id', async () => {
  const { editorDocFromDocument, editorBlockSnapshot } = await loadRenderer(mappingUrl);
  const { documentFromEditor, newBlockId } = await loadRenderer(documentUrl);
  const { createTabEditorState, insertText } = await loadRenderer(new URL('../../../src/renderer/editor/state.ts', import.meta.url));
  const { duplicateBlockAt, pasteBlockJson } = await loadRenderer(blockCommandsUrl);
  const { isBlockId } = await loadRenderer(blockIdUrl);

  const base = sampleDocument();
  let state = createTabEditorState(editorDocFromDocument(base));
  state = insertText(state, ' edited');
  const changed = documentFromEditor(base, state.doc);
  assert.notEqual(changed.document, base);

  const duplicate = duplicateBlockAt(state.tr, 0, () => id(30));
  state = state.apply(duplicate);
  const snapshot = editorBlockSnapshot(state.doc);
  assert.equal(snapshot[0].id, id(3));
  assert.equal(snapshot[1].id, id(30));
  assert.ok(isBlockId(snapshot[1].id));

  const pasted = pasteBlockJson(state.tr, base.blocks[2], newBlockId, 1);
  state = state.apply(pasted);
  const afterPaste = editorBlockSnapshot(state.doc);
  assert.notEqual(afterPaste[2].id, id(5));
  assert.ok(isBlockId(afterPaste[2].id));
});

test('documentForTab keeps non-text blocks from the opened file', async () => {
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { documentForTab } = await loadRenderer(saveUrl);
  const { createTab } = await loadRenderer(new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url));
  const { createTabEditorState } = await loadRenderer(new URL('../../../src/renderer/editor/state.ts', import.meta.url));

  const base = sampleDocument();
  base.blocks.splice(2, 0, {
    type: 'table',
    id: id(21),
    headerRow: false,
    columnWidths: [2],
    rows: [{ cells: [{ kind: 'text', content: [{ type: 'text', text: 'Cell' }] }] }],
  });
  const tab = createTab(1);
  tab.baseDocument = base;
  tab.editor = createTabEditorState(editorDocFromDocument(base));
  tab.savedDoc = tab.editor.doc;
  const edited = {
    ...tab,
    editor: tab.editor.apply(tab.editor.tr.insertText('!', tab.editor.doc.child(0).nodeSize - 1)),
  };
  const built = documentForTab(edited);
  assert.equal(built.document.blocks[2].type, 'table');
  assert.equal(built.document.blocks[0].content[0].text, 'One!');
});
