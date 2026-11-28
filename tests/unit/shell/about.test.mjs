import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modelUrl = new URL('../../../src/renderer/shell/menus/model.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const tabsUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const versionUrl = new URL('../../../src/shared/app-version.ts', import.meta.url);
const noticesUrl = new URL('../../../src/renderer/shell/about/notices.ts', import.meta.url);

test('Help > About Obelisk is wired to the about command', async () => {
  const { APP_MENUS } = await loadRenderer(modelUrl);
  const { UNWIRED_MENU_IDS } = await loadRenderer(applyUrl);
  const help = APP_MENUS.find((menu) => menu.id === 'help');
  const about = help.entries.find((entry) => entry.id === 'help-about');
  assert.equal(about?.command, 'about');
  assert.equal(UNWIRED_MENU_IDS.has('help-about'), false);
});

test('About tab id is stable', async () => {
  const { ABOUT_TAB_ID, createAboutTab } = await loadRenderer(tabsUrl);
  assert.equal(ABOUT_TAB_ID, 'about');
  const tab = createAboutTab();
  assert.equal(tab.kind, 'about');
  assert.equal(tab.title, 'About Obelisk');
});

test('APP_VERSION matches package.json', async () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { APP_VERSION } = await loadRenderer(versionUrl);
  assert.equal(APP_VERSION, pkg.version);
});

test('About lists every open-source component from the license manifest', async () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'resources', 'licenses', 'manifest.json'), 'utf8'),
  );
  const { ABOUT_NOTICES } = await loadRenderer(noticesUrl);
  assert.deepEqual(
    ABOUT_NOTICES.map((row) => row.id).sort(),
    manifest.components.map((row) => row.id).sort(),
  );
});