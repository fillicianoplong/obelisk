import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const setupUrl = new URL('../../../src/renderer/shell/page-setup/model.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const pageUrl = new URL('../../../src/renderer/editor/layout/page.ts', import.meta.url);
const paginateUrl = new URL('../../../src/renderer/editor/layout/paginate.ts', import.meta.url);

const ONE = { top: 1, right: 1, bottom: 1, left: 1 };

function draft(margins) {
  return {
    top: String(margins.top),
    right: String(margins.right),
    bottom: String(margins.bottom),
    left: String(margins.left),
  };
}

test('presets are Normal, Narrow, and Wide, and a mismatch is Custom', async () => {
  const setup = await loadRenderer(setupUrl);
  assert.deepEqual(setup.marginsForPreset('normal'), { top: 1, right: 1, bottom: 1, left: 1 });
  assert.deepEqual(setup.marginsForPreset('narrow'), { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 });
  assert.deepEqual(setup.marginsForPreset('wide'), { top: 1, right: 1.5, bottom: 1, left: 1.5 });
  assert.equal(setup.presetForMargins(setup.NORMAL_MARGINS), 'normal');
  assert.equal(setup.presetForMargins(setup.NARROW_MARGINS), 'narrow');
  assert.equal(setup.presetForMargins(setup.WIDE_MARGINS), 'wide');
  assert.equal(setup.presetForMargins({ top: 1, right: 1, bottom: 1, left: 0.75 }), 'custom');
  assert.equal(setup.PAPER_LABEL, 'Letter (8.5 × 11 in)');
  assert.equal(setup.pageSetupSummary('portrait', 'normal'), 'Portrait · 1 in on every side');
  assert.equal(setup.pageSetupSummary('landscape', 'wide'), 'Landscape · 1.5 in left and right');
  assert.equal(setup.pageSetupSummary('portrait', 'custom'), 'Portrait · Custom');
});

test('a margin outside 0.25 to 3 inches is refused and OK would stay disabled', async () => {
  const setup = await loadRenderer(setupUrl);
  const low = setup.checkPageSetup('portrait', draft({ ...ONE, left: 0.24 }));
  assert.equal(low.ok, false);
  assert.equal(low.message, setup.MARGIN_ERROR);
  assert.deepEqual(low.invalid, ['left']);
  const high = setup.checkPageSetup('portrait', draft({ ...ONE, top: 3.5 }));
  assert.equal(high.ok, false);
  assert.equal(high.message, 'A margin must be between 0.25 and 3 inches.');
  assert.deepEqual(high.invalid, ['top']);
  const blank = setup.checkPageSetup('portrait', { ...draft(ONE), right: '' });
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.invalid, ['right']);
  const edges = setup.checkPageSetup('portrait', draft({ top: 0.25, right: 3, bottom: 0.25, left: 3 }));
  assert.equal(edges.ok, true);
  assert.equal(edges.message, null);
  assert.deepEqual(edges.margins, { top: 0.25, right: 3, bottom: 0.25, left: 3 });
});

test('a text area under 2 inches is refused even though Letter margins cannot reach it', async () => {
  const setup = await loadRenderer(setupUrl);
  const narrowPaper = { width: 4, height: 4 };
  const width = setup.checkPageSetup('portrait', draft({ top: 1, right: 1.5, bottom: 1, left: 1.5 }), narrowPaper);
  assert.equal(width.ok, false);
  assert.equal(width.message, setup.TEXT_WIDTH_ERROR);
  assert.deepEqual(width.invalid, ['left', 'right']);
  const height = setup.checkPageSetup('portrait', draft({ top: 1.5, right: 1, bottom: 1.5, left: 1 }), narrowPaper);
  assert.equal(height.message, setup.TEXT_HEIGHT_ERROR);
  assert.deepEqual(height.invalid, ['top', 'bottom']);
  const both = setup.checkPageSetup('portrait', draft({ top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 }), narrowPaper);
  assert.equal(both.message, setup.TEXT_WIDTH_ERROR);
  const letter = setup.checkPageSetup('landscape', draft({ top: 3, right: 3, bottom: 3, left: 3 }));
  assert.equal(letter.ok, true, 'Letter stays at least 2.5 in inside the margin range');
});

test('margins are stored to 3 decimal places and arrow keys step by 0.25 in', async () => {
  const setup = await loadRenderer(setupUrl);
  const rounded = setup.checkPageSetup('portrait', draft({ ...ONE, left: 1.2344 }));
  assert.equal(rounded.ok, true);
  assert.equal(rounded.margins.left, 1.234);
  const up = setup.checkPageSetup('portrait', draft({ ...ONE, left: 1.2346 }));
  assert.equal(up.margins.left, 1.235);
  assert.equal(setup.stepMargin('1', 0.25), '1.25');
  assert.equal(setup.stepMargin('1', -0.25), '0.75');
  assert.equal(setup.stepMargin('3', 0.25), '3');
  assert.equal(setup.stepMargin('0.25', -0.25), '0.25');
  assert.equal(setup.stepMargin('3.5', -0.25), '3');
  assert.equal(setup.stepMargin('3.1', -0.25), '2.85');
  assert.equal(setup.stepMargin('nope', 0.25), '1.25');
  assert.equal(setup.formatMargin(1), '1');
  assert.equal(setup.formatMargin(0.5), '0.5');
});

test('OK stores the setup and marks the tab changed; the same setup does not', async () => {
  const { createTab, tabHasUnsavedChanges, withPageSetup } = await loadRenderer(modelUrl);
  const { NARROW_MARGINS } = await loadRenderer(setupUrl);
  const tab = createTab(1);
  assert.equal(tabHasUnsavedChanges(tab), false);
  assert.equal(withPageSetup(tab, tab.savedPage), tab);
  const landscape = withPageSetup(tab, {
    paper: 'letter',
    orientation: 'landscape',
    margins: NARROW_MARGINS,
  });
  assert.equal(landscape.baseDocument.page.orientation, 'landscape');
  assert.deepEqual(landscape.baseDocument.page.margins, NARROW_MARGINS);
  assert.equal(landscape.revision, tab.revision + 1);
  assert.equal(tabHasUnsavedChanges(landscape), true);
  const back = withPageSetup(landscape, tab.savedPage);
  assert.equal(tabHasUnsavedChanges(back), false);
});

test('Format > Page setup is enabled in Pages and disabled in Pageless', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  function item(view) {
    const menus = liveMenus({
      documentTab: true,
      selectionEmpty: true,
      editorState: state,
      documentView: view,
    });
    const format = menus.find((menu) => menu.id === 'format');
    return format.entries.find((entry) => entry.id === 'format-page-setup');
  }
  assert.equal(item('pages').enabled, true);
  assert.equal(item('pages').command, 'format-page-setup');
  assert.equal(item('pageless').enabled, false);
  const settings = liveMenus({
    documentTab: false,
    selectionEmpty: true,
    editorState: null,
  });
  const format = settings.find((menu) => menu.id === 'format');
  assert.equal(format.entries.find((entry) => entry.id === 'format-page-setup').enabled, false);
});

test('landscape turns the Letter sheet to 11 by 8.5 in', async () => {
  const { pageZoomVars } = await loadRenderer(pageUrl);
  const { pageBoxFromMargins } = await loadRenderer(paginateUrl);
  assert.equal(pageZoomVars(100), undefined);
  assert.equal(pageZoomVars(100, 'landscape')['--page-width'], '11in');
  assert.equal(pageZoomVars(100, 'landscape')['--page-height'], '8.5in');
  const box = pageBoxFromMargins({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }, 'landscape');
  assert.equal(box.pageWidth, 1056);
  assert.equal(box.pageHeight, 816);
  assert.equal(box.marginLeft, 48);
  assert.equal(box.marginTop, 48);
  const portrait = pageBoxFromMargins({ top: 1, right: 1.5, bottom: 1, left: 1.5 }, 'portrait');
  assert.equal(portrait.pageWidth, 816);
  assert.equal(portrait.pageHeight, 1056);
  assert.equal(portrait.marginLeft, 144);
  assert.equal(portrait.marginTop, 96);
});
