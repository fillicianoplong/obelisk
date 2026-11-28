import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const documentUrl = new URL('../../../src/renderer/blocks/drawing/document.ts', import.meta.url);
const commandsUrl = new URL('../../../src/renderer/blocks/drawing/commands.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-commands.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);

const { defaultDrawingBody } = await loadRenderer(documentUrl);
const commands = await loadRenderer(commandsUrl);
const mapping = await loadRenderer(mappingUrl);
const slash = await loadRenderer(slashUrl);
const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
const { newBlockId } = await loadRenderer(blockIdUrl);

function emptyDoc() {
  const header = {
    id: newBlockId(),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [],
  };
  return {
    view: 'pages',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header,
    footer: { ...header, id: newBlockId() },
    blocks: [],
  };
}

test('default drawing pad has vector stroke storage', () => {
  const body = defaultDrawingBody();
  assert.equal(body.strokes.length, 0);
  assert.ok(body.width > 0);
  assert.ok(body.height > 0);
});

test('insert-drawing command adds a structured drawing block', () => {
  let state = createTabEditorState();
  const cmd = commands.insertDrawingCommand();
  assert.ok(cmd(state, (transaction) => { state = state.apply(transaction); }));
  assert.equal(state.doc.childCount, 2);
  const block = state.doc.child(1);
  assert.equal(block.type.name, 'structured_block');
  assert.equal(block.attrs.blockType, 'drawing');
});

test('slash drawing replaces the slash line with a drawing block', () => {
  let state = createTabEditorState();
  state = insertText(state, '/draw');
  const slashPos = 1;
  const item = { id: 'drawing', label: 'Drawing', block: { kind: 'drawing' } };
  const tr = slash.applySlashMenuItem(state, slashPos, item);
  assert.ok(tr);
  const next = state.apply(tr);
  const block = next.doc.child(0);
  assert.equal(block.attrs.blockType, 'drawing');
  const built = mapping.documentFromEditorDoc(emptyDoc(), next.doc, newBlockId);
  assert.equal(built.document.blocks[0].type, 'drawing');
  assert.deepEqual(built.document.blocks[0].strokes, []);
});

test('drawing strokes round-trip through encode and decode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-drawing-'));
  const filePath = path.join(dir, 'drawing.obk');
  const id = newBlockId();
  const strokes = [{
    points: [{ x: 10, y: 10 }, { x: 90, y: 80 }],
    width: 4,
    color: '#000000',
  }];
  const document = {
    view: 'pages',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: {
      id: newBlockId(),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    footer: {
      id: newBlockId(),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    blocks: [{
      type: 'drawing',
      id,
      width: 200,
      height: 120,
      strokes,
    }],
  };
  const encoded = await encodeObk(document, emptyManifest('0.1.74.0'));
  assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);
  await writeFile(filePath, encoded.bytes);
  const opened = await decodeObk(filePath);
  assert.equal(opened.ok, true);
  const block = opened.document.blocks[0];
  assert.equal(block.type, 'drawing');
  assert.equal(block.strokes.length, 1);
  assert.equal(block.strokes[0].color, '#000000');
  await rm(dir, { recursive: true, force: true });
});