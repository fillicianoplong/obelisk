import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const settingsUrl = pathToFileURL(path.resolve('dist/main/settings.js')).href;
const spellUrl = pathToFileURL(path.resolve('dist/main/security/spellcheck.js')).href;

test('spell check defaults to on and keeps the theme when it is saved', async () => {
  const { readSpellingSetting, readThemeSetting, writeSpellingSetting } = await import(settingsUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-spell-'));
  assert.equal(readSpellingSetting(directory), true);
  await writeFile(path.join(directory, 'settings.json'), `${JSON.stringify({ theme: 'dark' })}\n`);
  assert.equal(readSpellingSetting(directory), true);
  assert.equal(readThemeSetting(directory), 'dark');
  writeSpellingSetting(directory, false);
  const saved = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.spelling, false);
  assert.equal(readSpellingSetting(directory), false);
  assert.equal(readThemeSetting(directory), 'dark');
  writeSpellingSetting(directory, true);
  assert.equal(readSpellingSetting(directory), true);
});

test('spell check uses OS languages and does not point at a download server', async () => {
  const spell = await import(spellUrl);
  assert.equal(spell.SPELLCHECK_DICTIONARY_DOWNLOAD_URL.startsWith('file:'), true);
  assert.equal(spell.SPELLCHECK_DICTIONARY_DOWNLOAD_URL.includes('http'), false);
  assert.deepEqual(spell.spellCheckerLanguages(['en-US', 'fr-FR'], ['fr-FR']), ['fr-FR']);
  assert.deepEqual(spell.spellCheckerLanguages(['en-US'], []), ['en-US']);
  assert.deepEqual(spell.spellCheckerLanguages([], ['en-US']), []);
  assert.deepEqual(
    spell.spellContextFromMenuParams({
      misspelledWord: 'helo',
      dictionarySuggestions: ['hello', 4, 'help'],
    }),
    { misspelledWord: 'helo', suggestions: ['hello', 'help'] },
  );
});
