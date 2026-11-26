import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const settingsUrl = pathToFileURL(path.resolve('dist/main/settings.js')).href;
const validateUrl = pathToFileURL(path.resolve('dist/shared/ipc/validate.js')).href;

test('zoom defaults to 100% and a value that is not a preset falls back', async () => {
  const { readThemeSetting, readZoomSetting, writeSpellingSetting, writeZoomSetting } = await import(settingsUrl);
  const { parseInvokeRequest } = await import(validateUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-zoom-'));
  assert.equal(readZoomSetting(directory), 100);
  await writeFile(path.join(directory, 'settings.json'), `${JSON.stringify({ theme: 'dark', zoom: 90 })}\n`);
  assert.equal(readZoomSetting(directory), 100);
  assert.equal(readThemeSetting(directory), 'dark');
  await writeFile(path.join(directory, 'settings.json'), `${JSON.stringify({ theme: 'light', zoom: '150' })}\n`);
  assert.equal(readZoomSetting(directory), 100);
  writeZoomSetting(directory, 150);
  const saved = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  assert.equal(saved.theme, 'light');
  assert.equal(saved.zoom, 150);
  assert.equal(readZoomSetting(directory), 150);
  writeSpellingSetting(directory, false);
  const kept = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  assert.equal(kept.zoom, 150);
  assert.equal(kept.spelling, false);
  writeZoomSetting(directory, 40);
  assert.equal(readZoomSetting(directory), 100);

  const accepted = parseInvokeRequest('prefs:set', [{ key: 'zoom', value: 125 }]);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.request, { key: 'zoom', value: 125 });
  assert.equal(parseInvokeRequest('prefs:set', [{ key: 'zoom', value: 90 }]).ok, false);
  assert.equal(parseInvokeRequest('prefs:get', [{ key: 'zoom' }]).ok, true);
});
