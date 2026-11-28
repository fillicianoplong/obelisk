import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const sessionUrl = pathToFileURL(path.resolve('dist/main/session/index.js')).href;

test('damaged session.json is ignored and never deleted', async () => {
  const {
    sessionStore,
    SESSION_FILE,
    parseSessionText,
    clearSessionStoreCache,
  } = await import(sessionUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-session-'));
  const damaged = '{';
  await writeFile(path.join(directory, SESSION_FILE), damaged);
  clearSessionStoreCache();
  const store = sessionStore(directory);
  assert.equal(store.damaged(), true);
  assert.deepEqual(store.read().paths, []);
  store.scheduleUpdate({
    paths: ['C:\\Notes\\alpha.obk'],
    activePath: 'C:\\Notes\\alpha.obk',
  });
  await store.queuePersist(true);
  assert.equal(await readFile(path.join(directory, SESSION_FILE), 'utf8'), damaged);

  const parsed = parseSessionText(damaged);
  assert.equal(parsed, null);
});

test('session paths persist with atomic write when restore is active', async () => {
  const { sessionStore, SESSION_FILE, clearSessionStoreCache } = await import(sessionUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-session-ok-'));
  clearSessionStoreCache();
  const store = sessionStore(directory);
  store.scheduleUpdate({
    paths: ['C:\\Notes\\a.obk', 'C:\\Notes\\b.obk'],
    activePath: 'C:\\Notes\\b.obk',
  });
  await store.queuePersist(true);
  const saved = JSON.parse(await readFile(path.join(directory, SESSION_FILE), 'utf8'));
  assert.deepEqual(saved.paths, ['C:\\Notes\\a.obk', 'C:\\Notes\\b.obk']);
  assert.equal(saved.activePath, 'C:\\Notes\\b.obk');
  assert.equal(saved.version, 1);
});

test('sessionActivationOrder opens the saved active path last', async () => {
  const { sessionActivationOrder } = await import(sessionUrl);
  assert.deepEqual(
    sessionActivationOrder(['C:\\a.obk', 'C:\\b.obk', 'C:\\c.obk'], 'C:\\b.obk'),
    ['C:\\a.obk', 'C:\\c.obk', 'C:\\b.obk'],
  );
});