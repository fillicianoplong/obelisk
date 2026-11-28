import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('recents keep newest files first with stable renderer ids', async () => {
  const { recentsStore, clearRecentsStoreCache } = await import('../../../dist/main/recents/store.js');
  clearRecentsStoreCache();
  const userData = await mkdtemp(path.join(tmpdir(), 'obelisk-recents-'));
  try {
    const store = recentsStore(userData);
    store.touch('C:\\Class\\Alpha.obk', 'Alpha.obk');
    store.touch('C:\\Class\\Beta.obk', 'Beta.obk');
    const list = store.listForRenderer();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'Beta.obk');
    assert.match(list[0].id, /^[a-f0-9]{32}$/);
    assert.equal(typeof list[0].location, 'string');
    assert.ok(list[0].location.length > 0);
    const again = store.pathForId(list[1].id);
    assert.equal(again?.endsWith('Alpha.obk'), true);
    await store.flush();
    const text = await readFile(path.join(userData, 'recents.json'), 'utf8');
    assert.match(text, /"version":1/);
  } finally {
    clearRecentsStoreCache();
    await rm(userData, { recursive: true, force: true });
  }
});