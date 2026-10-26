import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the window stops at 640 by 400 effective pixels', async () => {
  const minimum = await import(pathToFileURL(path.join(root, 'src/main/window/minimum.ts')).href);
  const entry = await readFile(path.join(root, 'src/main/index.ts'), 'utf8');

  assert.equal(minimum.DEFAULT_WINDOW_WIDTH, 1280);
  assert.equal(minimum.DEFAULT_WINDOW_HEIGHT, 800);
  assert.equal(minimum.MINIMUM_WINDOW_WIDTH, 640);
  assert.equal(minimum.MINIMUM_WINDOW_HEIGHT, 400);
  assert.deepEqual(minimum.defaultWindowSize(), { width: 1280, height: 800 });
  assert.deepEqual(minimum.minimumWindowSize(), { width: 640, height: 400 });
  // 200% of a 1280 by 800 window is this minimum.
  assert.equal(minimum.MINIMUM_WINDOW_WIDTH, minimum.DEFAULT_WINDOW_WIDTH / 2);
  assert.equal(minimum.MINIMUM_WINDOW_HEIGHT, minimum.DEFAULT_WINDOW_HEIGHT / 2);

  assert.deepEqual(minimum.clampWindowSize({ width: 200, height: 100 }), { width: 640, height: 400 });
  assert.deepEqual(minimum.clampWindowSize({ width: 640, height: 400 }), { width: 640, height: 400 });
  assert.deepEqual(minimum.clampWindowSize({ width: 1280, height: 800 }), { width: 1280, height: 800 });
  assert.deepEqual(minimum.clampWindowSize({ width: 500, height: 900 }), { width: 640, height: 900 });
  assert.deepEqual(minimum.clampWindowSize({ width: 1000, height: 200 }), { width: 1000, height: 400 });

  const calls = [];
  minimum.applyMinimumWindowSize({
    setMinimumSize(width, height) {
      calls.push([width, height]);
    },
  });
  assert.deepEqual(calls, [[640, 400]]);

  assert.match(entry, /applyMinimumWindowSize\(window\)/);
  assert.match(entry, /minWidth: minimum\.width/);
  assert.match(entry, /minHeight: minimum\.height/);
  assert.match(entry, /width: size\.width/);
  assert.match(entry, /height: size\.height/);
  const sizeAt = entry.indexOf('const size = defaultWindowSize()');
  const windowAt = entry.indexOf('new BrowserWindow(');
  const applyAt = entry.indexOf('applyMinimumWindowSize(window)');
  assert.ok(sizeAt !== -1 && windowAt !== -1 && applyAt !== -1);
  assert.ok(sizeAt < windowAt && windowAt < applyAt);
  assert.equal(entry.includes('minWidth: 640'), false);
  assert.equal(entry.includes('width: 1280'), false);
});
