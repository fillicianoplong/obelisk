import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/blocks/columns/model.ts', import.meta.url);
const docUrl = new URL('../../../src/renderer/blocks/columns/document.ts', import.meta.url);

test('even shares and add column respect limits', async () => {
  const model = await loadRenderer(modelUrl);
  const document = await loadRenderer(docUrl);
  const body = document.defaultColumnsBody(2);
  const base = { type: 'columns', id: 'c1', columns: body.columns };
  const three = model.addColumn(base);
  assert.ok(three);
  assert.equal(three.columns.length, 3);
  const four = model.addColumn(three);
  assert.ok(four);
  assert.equal(four.columns.length, 4);
  assert.equal(model.addColumn(four), null);
});

test('resize enforces minimum share', async () => {
  const model = await loadRenderer(modelUrl);
  const document = await loadRenderer(docUrl);
  const base = { type: 'columns', id: 'c1', columns: document.defaultColumnsBody(2).columns };
  const shrunk = model.resizePair(base, 0, 0.05, 0.95);
  assert.equal(shrunk, null);
  const ok = model.resizePair(base, 0, 0.3, 0.7);
  assert.ok(ok);
  assert.ok(ok.columns[0].share >= 0.15);
  assert.ok(ok.columns[1].share >= 0.15);
});

test('nested columns are refused', async () => {
  const model = await loadRenderer(modelUrl);
  assert.equal(model.canNestBlock({ type: 'columns', id: 'x', columns: [] }), false);
  assert.equal(model.canNestBlock({ type: 'paragraph', id: 'p', content: [] }), true);
});