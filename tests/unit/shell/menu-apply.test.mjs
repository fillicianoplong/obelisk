import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { loadRenderer } from '../editor/load-renderer.mjs';
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('Edit > Cut and formatting stay disabled with no selection', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  let state = createTabEditorState();
  state = insertText(state, 'Sample');
  const menus = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
  });
  const edit = menus.find((menu) => menu.id === 'edit');
  const cut = edit.entries.find((entry) => entry.id === 'edit-cut');
  assert.equal(cut.enabled, false);
  const format = menus.find((menu) => menu.id === 'format');
  const text = format.entries.find((entry) => entry.id === 'format-text');
  assert.equal(text.enabled, true);
  const bold = text.submenu.find((entry) => entry.id === 'format-bold');
  assert.equal(bold.enabled, false);
});

test('Format > Bold enables when text is selected', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  let state = createTabEditorState();
  state = insertText(state, 'Sample');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
  const menus = liveMenus({
    documentTab: true,
    selectionEmpty: false,
    editorState: state,
  });
  const format = menus.find((menu) => menu.id === 'format');
  const text = format.entries.find((entry) => entry.id === 'format-text');
  const bold = text.submenu.find((entry) => entry.id === 'format-bold');
  assert.equal(bold.enabled, true);
});

test('Insert > Heading 1 is enabled on a document tab', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const menus = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
  });
  const insert = menus.find((menu) => menu.id === 'insert');
  const heading = insert.entries.find((entry) => entry.id === 'insert-heading-1');
  assert.equal(heading.enabled, true);
});