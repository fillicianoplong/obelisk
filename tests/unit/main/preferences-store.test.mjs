import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const preferencesUrl = pathToFileURL(path.resolve('dist/main/preferences/index.js')).href;

test('preferences defaults survive a missing file', async () => {
  const {
    preferencesStore,
    PREFERENCES_FILE,
    parsePreferencesText,
    migrateFromLegacySettings,
    clearPreferencesStoreCache,
  } = await import(preferencesUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-prefs-'));
  const store = preferencesStore(directory);
  assert.equal(store.readThemeSetting(), 'system');
  assert.equal(store.readSpelling(), true);
  assert.equal(store.readZoom(), 100);
  assert.equal(store.readView(), 'pages');
  assert.equal(store.getValue('restoreTabs'), false);
  assert.equal(store.getValue('showPageEdges'), true);
  assert.equal(store.getValue('defaultFont'), 'Liberation Serif');
  assert.equal(store.getValue('defaultSize'), 12);
  const migrated = migrateFromLegacySettings(directory);
  assert.equal(migrated.theme, 'match-windows');
  const corrupt = parsePreferencesText('{"version":1,"theme":');
  assert.equal(corrupt.theme, 'match-windows');
  assert.equal(corrupt.spelling, true);
  await writeFile(path.join(directory, PREFERENCES_FILE), `${JSON.stringify(corrupt)}\n`);
  clearPreferencesStoreCache();
  const reread = preferencesStore(directory);
  assert.equal(reread.readSpelling(), true);
});

test('settings.json migrates into preferences.json on first read', async () => {
  const { preferencesStore, PREFERENCES_FILE, LEGACY_SETTINGS_FILE } = await import(preferencesUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-prefs-migrate-'));
  await writeFile(
    path.join(directory, LEGACY_SETTINGS_FILE),
    `${JSON.stringify({ theme: 'dark', spelling: false, zoom: 125, view: 'pageless' })}\n`,
  );
  const store = preferencesStore(directory);
  assert.equal(store.readThemeSetting(), 'dark');
  assert.equal(store.readSpelling(), false);
  assert.equal(store.readZoom(), 125);
  assert.equal(store.readView(), 'pageless');
  await store.whenPersisted();
  const saved = JSON.parse(await readFile(path.join(directory, PREFERENCES_FILE), 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.version, 1);
  assert.equal(saved.zoom, 125);
  const legacy = await readFile(path.join(directory, LEGACY_SETTINGS_FILE), 'utf8');
  assert.equal(JSON.parse(legacy).theme, 'dark');
  await store.applyEntry({ key: 'theme', value: 'light' });
  const after = JSON.parse(await readFile(path.join(directory, PREFERENCES_FILE), 'utf8'));
  assert.equal(after.theme, 'light');
});

test('bad preference values fall back without deleting the file', async () => {
  const { preferencesStore, PREFERENCES_FILE, parsePreferencesText } = await import(preferencesUrl);
  const { clearPreferencesStoreCache } = await import(preferencesUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-prefs-bad-'));
  const h32 = '{"version":1,"theme":';
  await writeFile(path.join(directory, PREFERENCES_FILE), h32);
  clearPreferencesStoreCache();
  const h32Store = preferencesStore(directory);
  assert.equal(h32Store.readThemeSetting(), 'system');
  assert.equal(await readFile(path.join(directory, PREFERENCES_FILE), 'utf8'), h32);

  const hostile = '{"version":1,"theme":"nope","spelling":"yes","defaultFont":"Comic Sans","defaultSize":13,"zoom":33,"view":"wide"}';
  await writeFile(path.join(directory, PREFERENCES_FILE), `${hostile}\n`);
  clearPreferencesStoreCache();
  const store = preferencesStore(directory);
  assert.equal(store.readThemeSetting(), 'system');
  assert.equal(store.readSpelling(), true);
  assert.equal(store.getValue('defaultFont'), 'Liberation Serif');
  assert.equal(store.getValue('defaultSize'), 12);
  assert.equal(store.readZoom(), 100);
  assert.equal(store.readView(), 'pages');
  const parsed = parsePreferencesText(hostile);
  assert.equal(parsed.defaultFont, 'Liberation Serif');
  const kept = await readFile(path.join(directory, PREFERENCES_FILE), 'utf8');
  assert.equal(kept.trim(), hostile);
});