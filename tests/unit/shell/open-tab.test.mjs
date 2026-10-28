import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const openedUrl = new URL('../../../src/renderer/shell/tabs/opened.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function document(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter' },
    header: { id: 'h' },
    footer: { id: 'f' },
    blocks,
  };
}

function openedFile(blocks, name = 'Lab notes.obk') {
  return {
    status: 'ok',
    handle: 'abc123',
    name,
    document: document(blocks),
    stat: { size: 40, modifiedMs: 1 },
  };
}

test('a valid file opens in a new tab and the tab has no path', async () => {
  const { createTab, tabHasUnsavedChanges, tabTooltip } = await loadRenderer(modelUrl);
  const { applyOpenResult } = await loadRenderer(openedUrl);
  const { editorText } = await loadRenderer(stateUrl);
  const current = [createTab(1)];
  const result = openedFile([
    { type: 'paragraph', id: 'p', content: [{ type: 'text', text: 'Lab notes' }, { type: 'link', text: ' here', address: 'https://example.invalid' }] },
    { type: 'heading', id: 'h1', level: 1, content: [{ type: 'text', text: 'Title' }] },
  ]);
  const applied = applyOpenResult(current, current[0].id, result);
  assert.equal(applied.message, null);
  assert.equal(applied.tabs.length, 2);
  assert.equal(applied.activeId, 'abc123');
  const tab = applied.tabs[1];
  assert.equal(tab.title, 'Lab notes.obk');
  assert.equal(tab.handle, 'abc123');
  assert.equal(tab.id, 'abc123');
  assert.equal(tab.path, undefined);
  assert.equal(tabHasUnsavedChanges(tab), false);
  assert.equal(tabTooltip(tab), 'Lab notes.obk');
  assert.equal(editorText(tab.editor), 'Lab notes here');
  assert.equal(JSON.stringify(tab).includes('C:\\'), false);
});

test('a refused file opens nothing and the message is the one main returned', async () => {
  const { createTab } = await loadRenderer(modelUrl);
  const { applyOpenResult } = await loadRenderer(openedUrl);
  const current = [createTab(1)];
  const message = 'This file is not an Obelisk archive, so it was not opened.';
  const applied = applyOpenResult(current, current[0].id, {
    status: 'refused',
    reason: 'not-a-zip',
    message,
  });
  assert.equal(applied.tabs, current);
  assert.equal(applied.activeId, current[0].id);
  assert.equal(applied.message, message);

  const newer = applyOpenResult(current, current[0].id, {
    status: 'refused',
    reason: 'out-of-range',
    message: 'Made by a newer Obelisk; update it from the Microsoft Store',
  });
  assert.equal(newer.tabs, current);
  assert.equal(newer.message, 'Made by a newer Obelisk; update it from the Microsoft Store');
});

test('cancel leaves the tabs alone, and a file already open switches to its tab', async () => {
  const { createTab } = await loadRenderer(modelUrl);
  const { applyOpenResult } = await loadRenderer(openedUrl);
  const current = [createTab(1)];
  const cancelled = applyOpenResult(current, current[0].id, { status: 'cancelled' });
  assert.equal(cancelled.tabs, current);
  assert.equal(cancelled.message, null);

  const opened = applyOpenResult(current, current[0].id, openedFile([
    { type: 'image', id: 'i', sha256: 'abc' },
  ], 'figure.obk'));
  assert.equal(opened.tabs.length, 2);
  const again = applyOpenResult(opened.tabs, opened.tabs[0].id, {
    status: 'alreadyOpen',
    tabId: 'abc123',
  });
  assert.equal(again.tabs, opened.tabs);
  assert.equal(again.activeId, 'abc123');
  assert.equal(again.message, null);

  const missing = applyOpenResult(current, current[0].id, {
    status: 'alreadyOpen',
    tabId: 'missing',
  });
  assert.equal(missing.tabs, current);
  assert.equal(missing.message, 'That file is already open, and its tab is not in this window.');
});
