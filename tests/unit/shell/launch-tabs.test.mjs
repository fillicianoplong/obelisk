import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const launchUrl = new URL('../../../src/renderer/shell/tabs/launch.ts', import.meta.url);
const openedUrl = new URL('../../../src/renderer/shell/tabs/opened.ts', import.meta.url);

function document(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter' },
    header: { id: 'h' },
    footer: { id: 'f' },
    blocks,
  };
}

function openedFile(name = 'Lab notes.obk') {
  return {
    status: 'ok',
    handle: 'abc123',
    name,
    document: document([
      { type: 'paragraph', id: 'p', content: [{ type: 'text', text: 'Lab notes' }] },
    ]),
    stat: { size: 40, modifiedMs: 1 },
  };
}

test('startup with no launch events creates Untitled 1', async () => {
  const { startupTabsAfterLaunch } = await loadRenderer(launchUrl);
  const { untitledTitle } = await loadRenderer(modelUrl);
  const startup = startupTabsAfterLaunch([]);
  assert.equal(startup.tabs.length, 1);
  assert.equal(startup.tabs[0].title, untitledTitle(1));
  assert.equal(startup.activeId, 'untitled-1');
  assert.equal(startup.nextUntitledNumber, 2);
  assert.equal(startup.message, null);
});

test('startup with a successful launch open skips the empty Untitled tab', async () => {
  const { startupTabsAfterLaunch } = await loadRenderer(launchUrl);
  const startup = startupTabsAfterLaunch([openedFile()]);
  assert.equal(startup.tabs.length, 1);
  assert.equal(startup.tabs[0].handle, 'abc123');
  assert.equal(startup.activeId, 'abc123');
  assert.equal(startup.nextUntitledNumber, 1);
});

test('startup with only failed launch opens creates Untitled after the errors', async () => {
  const { startupTabsAfterLaunch } = await loadRenderer(launchUrl);
  const message = 'This file is not an Obelisk archive, so it was not opened.';
  const startup = startupTabsAfterLaunch([
    { status: 'refused', reason: 'not-a-zip', message },
  ]);
  assert.equal(startup.tabs.length, 1);
  assert.equal(startup.tabs[0].id, 'untitled-1');
  assert.equal(startup.message, message);
});

test('opening a file replaces a lone unchanged Untitled tab', async () => {
  const { createTab } = await loadRenderer(modelUrl);
  const { applyOpenResult } = await loadRenderer(openedUrl);
  const current = [createTab(1)];
  const applied = applyOpenResult(current, current[0].id, openedFile());
  assert.equal(applied.tabs.length, 1);
  assert.equal(applied.activeId, 'abc123');
  assert.equal(applied.tabs[0].title, 'Lab notes.obk');
});
