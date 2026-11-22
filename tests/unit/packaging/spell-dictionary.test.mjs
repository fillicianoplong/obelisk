import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ignoredByPackager } from '../../../scripts/msix-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the packaged app keeps the bundled dictionary files', () => {
  for (const name of ['en-US.aff', 'en-US.dic', 'LICENSE.txt']) {
    const source = path.join(root, 'assets', 'spell', name);
    assert.equal(existsSync(source), true, name);
    assert.equal(ignoredByPackager(source), false, name);
    assert.equal(ignoredByPackager(path.join(root, 'dist', 'renderer', 'spell', name)), false, name);
  }
});
