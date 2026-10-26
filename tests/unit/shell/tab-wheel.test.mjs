import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function list({ scrollWidth, clientWidth, scrollLeft = 0 }) {
  return { scrollWidth, clientWidth, scrollLeft };
}

function wheel(deltaX, deltaY, modifiers = {}) {
  return {
    deltaX,
    deltaY,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...modifiers,
  };
}

test('the wheel scrolls an overflowing tab row and leaves a row that fits', async () => {
  const { scrollTabsFromWheel } = await import(
    pathToFileURL(path.join(root, 'src/renderer/shell/tabs/wheel.ts')).href
  );

  const overflowing = list({ scrollWidth: 900, clientWidth: 400 });
  const vertical = wheel(0, 120);
  scrollTabsFromWheel(overflowing, vertical);
  assert.equal(vertical.defaultPrevented, true);
  assert.equal(overflowing.scrollLeft, 120);

  const sideways = wheel(-40, 0);
  scrollTabsFromWheel(overflowing, sideways);
  assert.equal(sideways.defaultPrevented, true);
  assert.equal(overflowing.scrollLeft, 80);

  const both = wheel(10, 15);
  scrollTabsFromWheel(overflowing, both);
  assert.equal(overflowing.scrollLeft, 105);

  const fitted = list({ scrollWidth: 400, clientWidth: 400, scrollLeft: 12 });
  const ignored = wheel(30, 120);
  scrollTabsFromWheel(fitted, ignored);
  assert.equal(ignored.defaultPrevented, false);
  assert.equal(fitted.scrollLeft, 12);
});
