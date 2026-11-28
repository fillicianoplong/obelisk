import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const reorderUrl = new URL('../../../src/renderer/shell/tabs/reorder.ts', import.meta.url);

const BOXES = [
  { id: 'a', left: 0, right: 100 },
  { id: 'b', left: 110, right: 210 },
  { id: 'c', left: 220, right: 320 },
];

test('dropIndexFromPointer picks the gap under the pointer', async () => {
  const { dropIndexFromPointer } = await loadRenderer(reorderUrl);
  assert.equal(dropIndexFromPointer(BOXES, 'b', 49), 0);
  assert.equal(dropIndexFromPointer(BOXES, 'b', 160), 1);
  assert.equal(dropIndexFromPointer(BOXES, 'b', 330), 3);
});

test('reorderTabIds moves a tab without duplicating ids', async () => {
  const { reorderTabIds } = await loadRenderer(reorderUrl);
  assert.deepEqual(reorderTabIds(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(reorderTabIds(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(reorderTabIds(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
});

test('moveTabKeyboard stops at the ends', async () => {
  const { moveTabKeyboard } = await loadRenderer(reorderUrl);
  assert.deepEqual(moveTabKeyboard(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.equal(moveTabKeyboard(['a', 'b'], 'a', -1), null);
  assert.deepEqual(moveTabKeyboard(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
});