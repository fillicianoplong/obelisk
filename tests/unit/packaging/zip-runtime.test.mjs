import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyZipRuntime, zipRuntimeClosure } from '../../../scripts/msix-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const nodeModules = path.join(root, 'node_modules');

test('the package copies yauzl, yazl, and their dependencies, and not dev dependencies', async () => {
  const names = zipRuntimeClosure(nodeModules);
  assert.deepEqual(names.sort(), ['buffer-crc32', 'pend', 'yauzl', 'yazl']);
  const destinationParent = await mkdtemp(path.join(tmpdir(), 'obelisk-zip-runtime-'));
  const destination = path.join(destinationParent, 'node_modules');
  try {
    const copied = await copyZipRuntime(nodeModules, destination);
    assert.deepEqual(copied.sort(), ['buffer-crc32', 'pend', 'yauzl', 'yazl']);
    const requireRuntime = createRequire(path.join(destination, 'yazl', 'package.json'));
    assert.equal(typeof requireRuntime('yazl').ZipFile, 'function');
    assert.equal(typeof requireRuntime('yauzl').open, 'function');
    assert.equal(typeof requireRuntime('pend'), 'function');
    assert.equal(typeof requireRuntime('buffer-crc32').unsigned, 'function');
    for (const absent of ['react', 'eslint', 'electron', 'typescript', 'bl', '@types/node']) {
      assert.equal(
        await import('node:fs').then((fs) => fs.existsSync(path.join(destination, absent))),
        false,
        absent,
      );
    }
    const fs = await import('node:fs');
    assert.equal(fs.existsSync(path.join(destination, 'yauzl', 'test')), false);
    assert.equal(fs.existsSync(path.join(destination, 'pend', 'test.js')), false);
    assert.equal(fs.existsSync(path.join(destination, 'yazl', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(destination, 'yauzl', 'index.js')), true);
  } finally {
    await rm(destinationParent, { recursive: true, force: true });
  }
});
