import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const pagelessUrl = new URL('../../../src/shared/pageless-width.ts', import.meta.url);
const pageSetupUrl = new URL('../../../src/renderer/shell/page-setup/model.ts', import.meta.url);
const paginateUrl = new URL('../../../src/renderer/editor/layout/paginate.ts', import.meta.url);

function viewWidthItems(liveMenus, context) {
  const view = liveMenus(context).find((menu) => menu.id === 'view');
  return view.entries.filter(
    (entry) => entry.id === 'view-pageless-width-narrow'
      || entry.id === 'view-pageless-width-medium'
      || entry.id === 'view-pageless-width-wide',
  );
}

test('missing pagelessWidth defaults to medium', async () => {
  const { pagelessWidthFromUnknown } = await loadRenderer(pagelessUrl);
  assert.equal(pagelessWidthFromUnknown(undefined), 'medium');
  assert.equal(pagelessWidthFromUnknown('wide'), 'wide');
  assert.equal(pagelessWidthFromUnknown('bogus'), 'medium');
});

test('pageless column inches match the reference presets', async () => {
  const { PAGELESS_COLUMN_IN, pagelessColumnIn } = await loadRenderer(pagelessUrl);
  assert.equal(pagelessColumnIn('narrow'), PAGELESS_COLUMN_IN.narrow);
  assert.equal(pagelessColumnIn('medium'), PAGELESS_COLUMN_IN.medium);
  assert.equal(pagelessColumnIn('wide'), PAGELESS_COLUMN_IN.wide);
});

test('pageless width menu is enabled only in Pageless view', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const pages = viewWidthItems(liveMenus, {
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    documentView: 'pages',
    pagelessWidth: 'medium',
  });
  for (const item of pages) {
    assert.equal(item.enabled, false, item.id);
  }
  const pageless = viewWidthItems(liveMenus, {
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    documentView: 'pageless',
    pagelessWidth: 'narrow',
  });
  for (const item of pageless) {
    assert.equal(item.enabled, true, item.id);
  }
  assert.equal(pageless.find((item) => item.id === 'view-pageless-width-narrow').checked, true);
});

test('changing pageless width marks the tab unsaved', async () => {
  const { createTab, documentPagelessWidth, tabHasUnsavedChanges, withPagelessWidth } = await loadRenderer(modelUrl);
  const tab = createTab(1, 'pageless');
  assert.equal(documentPagelessWidth(tab), 'medium');
  const wide = withPagelessWidth(tab, 'wide');
  assert.equal(wide.baseDocument.pagelessWidth, 'wide');
  assert.equal(tabHasUnsavedChanges(wide), true);
});

test('page margins do not change the stored pageless width', async () => {
  const { createTab, documentPagelessWidth, withPageSetup } = await loadRenderer(modelUrl);
  const { defaultPageSetup, marginsForPreset } = await loadRenderer(pageSetupUrl);
  const { pageBoxForPageless } = await loadRenderer(paginateUrl);
  const box = pageBoxForPageless('medium', { top: 1, bottom: 1 });
  assert.equal(box.marginLeft, 0);
  assert.equal(box.marginRight, 0);
  const changed = withPageSetup(createTab(1, 'pageless'), {
    ...defaultPageSetup(),
    margins: marginsForPreset('wide'),
  });
  assert.equal(documentPagelessWidth(changed), 'medium');
});