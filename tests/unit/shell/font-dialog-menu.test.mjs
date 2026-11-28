import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/menus/model.ts', import.meta.url);
const ctxUrl = new URL('../../../src/renderer/shell/contextmenu/model.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('Format lists Font dialog first and keeps quick font menus', async () => {
  const { APP_MENUS, itemLabel, isSeparator } = await loadRenderer(modelUrl);
  const format = APP_MENUS.find((menu) => menu.id === 'format');
  const top = format.entries.filter((entry) => !isSeparator(entry)).map((entry) => itemLabel(entry));
  assert.equal(top[0], 'Font…');
  assert.ok(top.includes('Text'));
  assert.ok(top.includes('Font family'));
  assert.ok(top.includes('Font size'));
});

test('the block context menu groups clipboard, format, and block actions', async () => {
  const { composeContextMenu, menuEntryLabels } = await loadRenderer(ctxUrl);
  const labels = menuEntryLabels(composeContextMenu('block'));
  assert.deepEqual(
  labels.slice(0, 6),
    ['Cut', 'Copy', 'Paste', 'Font…', 'Paragraph…', 'Block'],
  );
  assert.ok(labels.includes('Turn into'));
  assert.ok(labels.includes('Duplicate'));
  assert.ok(labels.includes('Delete'));
});

test('Format > Font… stays enabled on an empty caret', async () => {
  const { APP_MENUS } = await loadRenderer(modelUrl);
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const applied = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: createTabEditorState(),
  });
  const format = applied.find((menu) => menu.id === 'format');
  const font = format.entries.find((entry) => entry.id === 'format-font-dialog');
  assert.equal(font.enabled, true);
  const text = format.entries.find((entry) => entry.id === 'format-text');
  const bold = text.submenu.find((entry) => entry.id === 'format-bold');
  assert.equal(bold.enabled, false);
});