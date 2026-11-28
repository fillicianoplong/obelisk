import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const defaultUrl = new URL('../../../src/renderer/blocks/table/document.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/blocks/table/model.ts', import.meta.url);
const sortUrl = new URL('../../../src/renderer/blocks/table/sort.ts', import.meta.url);
const commandsUrl = new URL('../../../src/renderer/blocks/table/commands.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-commands.ts', import.meta.url);

const { defaultTableBody } = await loadRenderer(defaultUrl);
const model = await loadRenderer(modelUrl);
const { sortTableRows } = await loadRenderer(sortUrl);
const commands = await loadRenderer(commandsUrl);
const mapping = await loadRenderer(mappingUrl);
const slash = await loadRenderer(slashUrl);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
const { setTableSelection } = await loadRenderer(new URL('../../../src/renderer/blocks/table/selection.ts', import.meta.url));
const { newBlockId, isBlockId } = await loadRenderer(new URL('../../../src/renderer/editor/block-id.ts', import.meta.url));

function textCell(text) {
  if (text === '') {
    return { kind: 'text', content: [] };
  }
  return { kind: 'text', content: [{ type: 'text', text }] };
}

function formula(source) {
  return { kind: 'formula', source };
}

function tableBlock(rows, options = {}) {
  const columns = rows[0]?.length ?? 1;
  return {
    type: 'table',
    id: newBlockId(),
    headerRow: options.headerRow === true,
    columnWidths: options.columnWidths ?? Array.from({ length: columns }, () => 2),
    rows: rows.map((line) => ({ cells: line.map((cell) => (cell.startsWith('=') ? formula(cell) : textCell(cell))) })),
  };
}

test('insert-table builds a 3 by 4 table with a header row', () => {
  const body = defaultTableBody();
  assert.equal(body.headerRow, true);
  assert.equal(body.columnWidths.length, 3);
  assert.equal(body.rows.length, 4);
  assert.equal(body.rows[0].cells.length, 3);
});

test('slash table replaces the slash line with a structured table block', () => {
  let state = createTabEditorState();
  state = insertText(state, '/table');
  const slashPos = 1;
  const item = { id: 'table', label: 'Table', block: { kind: 'table' } };
  const tr = slash.applySlashMenuItem(state, slashPos, item);
  assert.ok(tr);
  const next = state.apply(tr);
  const block = next.doc.child(0);
  assert.equal(block.type.name, 'structured_block');
  assert.equal(block.attrs.blockType, 'table');
  const built = mapping.documentFromEditorDoc(
    { view: 'pages', page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } }, header: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] }, footer: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] }, blocks: [] },
    next.doc,
    newBlockId,
  );
  const json = built.document.blocks[0];
  assert.equal(json.type, 'table');
  assert.equal(json.headerRow, true);
  assert.equal(json.rows.length, 4);
  assert.equal(json.columnWidths.length, 3);
});

test('adding and deleting rows and columns updates the grid', () => {
  let table = tableBlock([['a', 'b'], ['1', '=B1*2']], { headerRow: true });
  let next = model.applyStructureChange(table, { kind: 'insert-rows', row: 2 });
  assert.ok(next);
  assert.equal(next.rows.length, 3);
  table = next;
  next = model.applyStructureChange(table, { kind: 'insert-columns', column: 2 });
  assert.ok(next);
  assert.equal(next.rows[0].cells.length, 3);
  assert.equal(next.rows[2].cells[2].kind, 'formula');
  next = model.applyStructureChange(next, { kind: 'delete-rows', row: 3 });
  assert.ok(next);
  assert.equal(next.rows.length, 2);
});

test('inserting a row above a referenced cell rewrites the reference', () => {
  const table = tableBlock([['', ''], ['', '10'], ['', '=B2*2']]);
  const shifted = model.applyStructureChange(table, { kind: 'insert-rows', row: 2 });
  assert.ok(shifted);
  const formula = shifted.rows[3].cells[1];
  assert.equal(formula.kind, 'formula');
  assert.equal(formula.source, '=B3*2');
});

test('toggling the header row flips the flag', () => {
  const table = tableBlock([['H']], { headerRow: true });
  const off = model.toggleHeaderRow(table);
  assert.equal(off.headerRow, false);
  assert.equal(model.toggleHeaderRow(off).headerRow, true);
});

test('the table view styles the first row when headerRow is true', async () => {
  const css = await readFile(path.join(root, 'src/renderer/blocks/table/table.css'), 'utf8');
  assert.match(css, /\.table-header-row/);
  assert.match(css, /font-weight:\s*700/);
});

test('sort descending keeps row 1 and orders body rows', () => {
  const rows = [
    { cells: [textCell('Name'), textCell('Score')] },
    { cells: [textCell('c'), textCell('2')] },
    { cells: [textCell('a'), textCell('10')] },
    { cells: [textCell('b'), textCell('5')] },
  ];
  const sorted = sortTableRows(rows, true, 1, false);
  assert.equal(sorted[0].cells[0].content[0].text, 'Name');
  const names = sorted.slice(1).map((row) => row.cells[0].content[0]?.text);
  assert.deepEqual(names, ['a', 'b', 'c']);
});

test('sort ascending orders text and numbers in the active column', () => {
  const rows = [
    { cells: [textCell('z'), textCell('1')] },
    { cells: [textCell('a'), textCell('9')] },
  ];
  const sorted = sortTableRows(rows, false, 0, true);
  assert.deepEqual(sorted.map((row) => row.cells[0].content[0]?.text), ['a', 'z']);
});

test('a 200 by 26 table refuses another row or column', () => {
  const grid = Array.from({ length: 200 }, () => Array.from({ length: 26 }, () => ''));
  const block = tableBlock(grid);
  assert.equal(model.canGrowRows(block), false);
  assert.equal(model.canGrowColumns(block), false);
  assert.equal(model.applyStructureChange(block, { kind: 'insert-rows', row: 201 }), null);
  assert.equal(model.applyStructureChange(block, { kind: 'insert-columns', column: 27 }), null);
  let state = createTabEditorState(mapping.editorDocFromDocument({
    view: 'pages',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [block],
  }));
  state = state.apply(setTableSelection(state.tr, { blockIndex: 0, row: 0, col: 0 }));
  assert.equal(commands.tableInsertRowBelowCommand()(state), false);
  assert.equal(commands.tableInsertColumnRightCommand()(state), false);
});

test('table mapping round-trips through save and reopen', async () => {
  const block = defaultTableBody();
  const document = {
    view: 'pages',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [{
      type: 'table',
      id: newBlockId(),
      ...block,
      rows: [
        { cells: [textCell('Qty'), textCell('Price'), textCell('Total')] },
        { cells: [textCell('2'), textCell('3'), formula('=A2*B2')] },
        { cells: [textCell('1'), textCell('5'), formula('=A3*B3')] },
        { cells: [textCell(''), textCell(''), formula('=C2+C3')] },
      ],
    }],
  };
  const encoded = await encodeObk(document, emptyManifest('0.1.49.0'));
  assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-table-'));
  const file = path.join(dir, 'sample.obk');
  await writeFile(file, encoded.bytes);
  const decoded = await decodeObk(file);
  await rm(dir, { recursive: true, force: true });
  assert.equal(decoded.ok, true);
  const roundTrip = decoded.document.blocks[0];
  assert.equal(roundTrip.type, 'table');
  assert.equal(roundTrip.rows.length, 4);
  assert.equal(roundTrip.rows[3].cells[2].source, '=C2+C3');
  const editorDoc = mapping.editorDocFromDocument(decoded.document);
  const built = mapping.documentFromEditorDoc(decoded.document, editorDoc, newBlockId);
  assert.equal(built.document.blocks[0].type, 'table');
  assert.equal(built.document.blocks[0].rows[3].cells[2].source, '=C2+C3');
  assert.ok(isBlockId(built.document.blocks[0].id));
});

test('menu sort descending reorders the stored rows in one step', () => {
  const block = tableBlock([['h', 'n'], ['b', '2'], ['a', '10'], ['c', '5']], { headerRow: true });
  const doc = {
    view: 'pages',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [block],
  };
  let state = createTabEditorState(mapping.editorDocFromDocument(doc));
  state = state.apply(setTableSelection(state.tr, { blockIndex: 0, row: 1, col: 1 }));
  let sortTr = null;
  assert.equal(commands.tableSortDescendingCommand()(state, (tr) => { sortTr = tr; }), true);
  assert.ok(sortTr);
  const next = state.apply(sortTr);
  const saved = mapping.documentFromEditorDoc(doc, next.doc, newBlockId).document.blocks[0];
  const labels = saved.rows.slice(1).map((row) => row.cells[0].content[0]?.text);
  assert.deepEqual(labels, ['a', 'c', 'b']);
});