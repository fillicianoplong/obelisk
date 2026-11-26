import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const statusUrl = new URL('../../../src/renderer/shell/statusbar/model.ts', import.meta.url);

function viewItem(menus, id) {
  const view = menus.find((menu) => menu.id === 'view');
  return view.entries.find((entry) => entry.id === id);
}

test('Pages and Pageless are a checked pair and the current view is the only check', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const pages = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    documentView: 'pages',
  });
  assert.equal(viewItem(pages, 'view-pages').checked, true);
  assert.equal(viewItem(pages, 'view-pages').enabled, true);
  assert.equal(viewItem(pages, 'view-pages').radio, true);
  assert.equal(viewItem(pages, 'view-pageless').checked, false);
  assert.equal(viewItem(pages, 'view-pageless').enabled, true);
  const pageless = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    documentView: 'pageless',
  });
  assert.equal(viewItem(pageless, 'view-pages').checked, false);
  assert.equal(viewItem(pageless, 'view-pageless').checked, true);
  const settings = liveMenus({
    documentTab: false,
    selectionEmpty: true,
    editorState: null,
  });
  assert.equal(viewItem(settings, 'view-pages').enabled, false);
});

test('a new tab starts in the remembered view and is not unsaved', async () => {
  const { createTab, rememberedDocumentView, tabHasUnsavedChanges } = await loadRenderer(modelUrl);
  assert.equal(rememberedDocumentView(), 'pages');
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const previous = globalThis.window;
  globalThis.window = { obeliskView: 'pageless' };
  try {
    const tab = createTab(2);
    assert.equal(tab.baseDocument.view, 'pageless');
    assert.equal(tab.savedView, 'pageless');
    assert.equal(tabHasUnsavedChanges(tab), false);
    globalThis.window = { obeliskView: 'wide' };
    assert.equal(createTab(3).baseDocument.view, 'pages');
  } finally {
    if (hadWindow) {
      globalThis.window = previous;
    } else {
      delete globalThis.window;
    }
  }
});

test('switching to the other view marks the tab changed and the same view does not', async () => {
  const { createTab, tabHasUnsavedChanges, withDocumentView } = await loadRenderer(modelUrl);
  const { statusViewLabel } = await loadRenderer(statusUrl);
  const tab = createTab(1);
  assert.equal(tabHasUnsavedChanges(tab), false);
  assert.equal(withDocumentView(tab, 'pages'), tab);
  const pageless = withDocumentView(tab, 'pageless');
  assert.equal(pageless.baseDocument.view, 'pageless');
  assert.equal(tabHasUnsavedChanges(pageless), true);
  assert.equal(pageless.revision, tab.revision + 1);
  const back = withDocumentView(pageless, 'pages');
  assert.equal(tabHasUnsavedChanges(back), false);
  assert.equal(statusViewLabel('pages'), 'Pages');
  assert.equal(statusViewLabel('pageless'), 'Pageless');
});
