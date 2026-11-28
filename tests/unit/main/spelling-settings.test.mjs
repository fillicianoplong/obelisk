import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const settingsUrl = pathToFileURL(path.resolve('dist/main/settings.js')).href;
const prefsUrl = pathToFileURL(path.resolve('dist/main/preferences/index.js')).href;

test('spell check defaults to on and keeps the theme when it is saved', async () => {
  const { readSpellingSetting, readThemeSetting, writeSpellingSetting } = await import(settingsUrl);
  const { PREFERENCES_FILE, clearPreferencesStoreCache } = await import(prefsUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-spell-'));
  assert.equal(readSpellingSetting(directory), true);
  await writeFile(path.join(directory, PREFERENCES_FILE), `${JSON.stringify({ theme: 'dark' })}\n`);
  clearPreferencesStoreCache();
  assert.equal(readSpellingSetting(directory), true);
  assert.equal(readThemeSetting(directory), 'dark');
  await writeSpellingSetting(directory, false);
  const saved = JSON.parse(await readFile(path.join(directory, PREFERENCES_FILE), 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.spelling, false);
  assert.equal(readSpellingSetting(directory), false);
  assert.equal(readThemeSetting(directory), 'dark');
  await writeSpellingSetting(directory, true);
  assert.equal(readSpellingSetting(directory), true);
});