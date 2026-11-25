import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const paginateUrl = new URL('../../../src/renderer/editor/layout/paginate.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const keysUrl = new URL('../../../src/renderer/editor/keymap/editor-keys.ts', import.meta.url);

function box() {
  return {
    pageWidth: 816,
    pageHeight: 1056,
    marginTop: 96,
    marginRight: 96,
    marginBottom: 96,
    marginLeft: 96,
    gap: 24,
  };
}

function line(pos, height, startsBlock = false) {
  return {
    pos,
    blockPos: startsBlock ? pos - 1 : pos,
    height,
    kind: 'line',
    startsBlock,
  };
}

function pageBreak(pos) {
  return {
    pos,
    blockPos: pos,
    height: 0,
    kind: 'page-break',
    startsBlock: true,
  };
}

test('lines that fit stay on one page', async () => {
  const { paginateFlow, pageCountLabel, pageIndexAt, textAreaHeight } = await loadRenderer(paginateUrl);
  const page = box();
  assert.equal(textAreaHeight(page), 864);
  const units = [line(1, 400, true), line(20, 400)];
  const layout = paginateFlow(units, page);
  assert.equal(layout.pageCount, 1);
  assert.equal(layout.spacers.length, 0);
  assert.deepEqual(layout.unitPage, [0, 0]);
  assert.equal(pageIndexAt(units, layout.unitPage, 20), 0);
  assert.equal(pageCountLabel(1, 1), 'Page 1 of 1');
});

test('a line that does not fit moves whole onto the next page', async () => {
  const { paginateFlow, pageIndexAt } = await loadRenderer(paginateUrl);
  const page = box();
  const units = [line(1, 800, true), line(40, 100)];
  const layout = paginateFlow(units, page);
  assert.equal(layout.pageCount, 2);
  assert.equal(layout.spacers.length, 1);
  assert.equal(layout.spacers[0].where, 'widget');
  assert.equal(layout.spacers[0].pos, 40);
  assert.equal(layout.spacers[0].height, 64 + 96 + 24 + 96);
  assert.deepEqual(layout.unitPage, [0, 1]);
  assert.equal(pageIndexAt(units, layout.unitPage, 1), 0);
  assert.equal(pageIndexAt(units, layout.unitPage, 40), 1);
});

test('the first line of a block keeps its gap by breaking before the block', async () => {
  const { paginateFlow } = await loadRenderer(paginateUrl);
  const units = [line(1, 800, true), line(50, 100, true)];
  const layout = paginateFlow(units, box());
  assert.equal(layout.spacers[0].pos, 49);
  assert.equal(layout.spacers[0].where, 'widget');
});

test('a line taller than the text area is not split', async () => {
  const { paginateFlow } = await loadRenderer(paginateUrl);
  const layout = paginateFlow([line(1, 2000, true)], box());
  assert.equal(layout.pageCount, 1);
  assert.equal(layout.spacers.length, 0);
});

test('a page break starts the following text on the next page', async () => {
  const { paginateFlow, pageCountLabel, pageIndexAt } = await loadRenderer(paginateUrl);
  const units = [line(1, 200, true), pageBreak(30), line(32, 40, true)];
  const layout = paginateFlow(units, box());
  assert.equal(layout.pageCount, 2);
  assert.equal(layout.spacers.length, 1);
  assert.equal(layout.spacers[0].where, 'break');
  assert.equal(layout.spacers[0].pos, 30);
  assert.equal(layout.spacers[0].height, (864 - 200) + 96 + 24 + 96);
  assert.equal(pageIndexAt(units, layout.unitPage, 1), 0);
  assert.equal(pageIndexAt(units, layout.unitPage, 30), 1);
  assert.equal(pageIndexAt(units, layout.unitPage, 32), 1);
  assert.equal(pageCountLabel(2, layout.pageCount), 'Page 2 of 2');
});

test('a page break at the top still opens a new page', async () => {
  const { paginateFlow, pageIndexAt } = await loadRenderer(paginateUrl);
  const units = [pageBreak(0), line(2, 20, true)];
  const layout = paginateFlow(units, box());
  assert.equal(layout.pageCount, 2);
  assert.equal(layout.unitPage[1], 1);
  assert.equal(pageIndexAt(units, layout.unitPage, 2), 1);
});

test('two page breaks leave a blank page between them', async () => {
  const { paginateFlow } = await loadRenderer(paginateUrl);
  const layout = paginateFlow([pageBreak(0), pageBreak(1), line(3, 10, true)], box());
  assert.equal(layout.pageCount, 3);
  assert.equal(layout.spacers.length, 2);
  assert.equal(layout.unitPage[2], 2);
});

test('an empty document is one page', async () => {
  const { paginateFlow, pageCountLabel, pageIndexAt, sheetStackHeight } = await loadRenderer(paginateUrl);
  const page = box();
  const layout = paginateFlow([], page);
  assert.equal(layout.pageCount, 1);
  assert.equal(pageIndexAt([], layout.unitPage, 0), 0);
  assert.equal(pageCountLabel(1, 1), 'Page 1 of 1');
  assert.equal(sheetStackHeight(1, page), 1056);
  assert.equal(sheetStackHeight(2, page), 1056 + 24 + 1056);
});

test('backspace after a page break removes the break', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { backspacePageBreak } = await loadRenderer(keysUrl);
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const paragraph = (n, text) => editorSchema.nodes.paragraph.create(
    { blockId: id(n) },
    editorSchema.text(text),
  );
  const doc = editorSchema.node('doc', null, [
    paragraph(1, 'Before'),
    editorSchema.nodes.page_break.create({ blockId: id(2) }),
    paragraph(3, 'After'),
  ]);
  let state = EditorState.create({ schema: editorSchema, doc });
  const after = doc.child(0).nodeSize + doc.child(1).nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, after)));
  let next = null;
  const ran = backspacePageBreak()(state, (tr) => {
    next = state.apply(tr);
  });
  assert.equal(ran, true);
  assert.equal(next.doc.childCount, 2);
  assert.equal(next.doc.child(0).textContent, 'Before');
  assert.equal(next.doc.child(1).textContent, 'After');
  assert.equal(backspacePageBreak()(next, () => {}), false);
});
