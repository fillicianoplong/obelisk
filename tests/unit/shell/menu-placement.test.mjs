import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const placeUrl = new URL('../../../src/renderer/shell/menus/place-menu.ts', import.meta.url);

test('a menu near the bottom of the window is clamped once and then stays put', async () => {
  const { clampedMenuPoint, keepMenuPoint } = await loadRenderer(placeUrl);
  const first = clampedMenuPoint(40, 700, 220, 280, 800, 760);
  assert.equal(first.left, 40);
  assert.equal(first.top, 760 - 280 - 8);
  const grown = clampedMenuPoint(40, 700, 220, 420, 800, 760);
  assert.notEqual(grown.top, first.top);
  assert.deepEqual(keepMenuPoint(first, grown), first);
  assert.deepEqual(keepMenuPoint(null, grown), grown);
});

test('a menu that fits under the pointer is not moved', async () => {
  const { clampedMenuPoint } = await loadRenderer(placeUrl);
  assert.deepEqual(clampedMenuPoint(120, 80, 200, 160, 1280, 800), { left: 120, top: 80 });
});
