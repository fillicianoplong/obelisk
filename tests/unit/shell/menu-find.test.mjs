import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('Edit > Find and Replace are enabled on a document tab', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const menus = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
  });
  const edit = menus.find((menu) => menu.id === 'edit');
  const find = edit.entries.find((entry) => entry.id === 'edit-find');
  const replace = edit.entries.find((entry) => entry.id === 'edit-replace');
  assert.equal(find.enabled, true);
  assert.equal(replace.enabled, true);
  assert.equal(find.command, 'edit-find');
  assert.equal(replace.command, 'edit-replace');
});