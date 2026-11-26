import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const zoomUrl = new URL('../../../src/shared/zoom.ts', import.meta.url);
const viewUrl = new URL('../../../src/shared/document-view.ts', import.meta.url);
const pageUrl = new URL('../../../src/renderer/editor/layout/page.ts', import.meta.url);
const paginateUrl = new URL('../../../src/renderer/editor/layout/paginate.ts', import.meta.url);
const focusUrl = new URL('../../../src/renderer/shell/statusbar/focus.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('zoom steps through the six presets and stops at the ends', async () => {
  const zoom = await loadRenderer(zoomUrl);
  assert.deepEqual(zoom.ZOOM_PRESETS, [200, 150, 125, 100, 75, 50]);
  assert.equal(zoom.zoomLabel(100), '100%');
  assert.equal(zoom.zoomAccessLabel(100), 'Zoom 100%');
  assert.equal(zoom.zoomFromSaved(undefined), 100);
  assert.equal(zoom.zoomFromSaved(90), 100);
  assert.equal(zoom.zoomFromSaved('150'), 100);
  assert.equal(zoom.zoomFromSaved(150), 150);
  assert.equal(zoom.zoomLaunchArgument(150), '--obelisk-zoom=150');
  assert.equal(zoom.zoomFromArguments(['--obelisk-theme=dark', '--obelisk-zoom=150']), 150);
  assert.equal(zoom.zoomFromArguments(['--obelisk-zoom=90']), 100);
  assert.equal(zoom.zoomFromArguments(['--obelisk-zoom=']), 100);
  assert.equal(zoom.zoomFromArguments([]), 100);
  assert.equal(zoom.zoomFromArguments(['--obelisk-zoom=100', '--obelisk-zoom=75']), 75);
  assert.equal(zoom.stepZoom(100, 1), 125);
  assert.equal(zoom.stepZoom(100, -1), 75);
  assert.equal(zoom.stepZoom(200, 1), 200);
  assert.equal(zoom.stepZoom(50, -1), 50);
  assert.equal(zoom.zoomInDisabled(200), true);
  assert.equal(zoom.zoomInDisabled(150), false);
  assert.equal(zoom.zoomOutDisabled(50), true);
  assert.equal(zoom.zoomOutDisabled(75), false);
  assert.equal(zoom.zoomCommandResult(125, 'view-zoom-in'), 150);
  assert.equal(zoom.zoomCommandResult(125, 'view-zoom-out'), 100);
  assert.equal(zoom.zoomCommandResult(50, 'view-zoom-100'), 100);
});

test('a saved view is Pages or Pageless and anything else is Pages', async () => {
  const view = await loadRenderer(viewUrl);
  assert.equal(view.viewFromSaved(undefined), 'pages');
  assert.equal(view.viewFromSaved('pageless'), 'pageless');
  assert.equal(view.viewFromSaved('wide'), 'pages');
  assert.equal(view.viewLaunchArgument('pageless'), '--obelisk-view=pageless');
  assert.equal(view.viewFromArguments(['--obelisk-zoom=150', '--obelisk-view=pageless']), 'pageless');
  assert.equal(view.viewFromArguments(['--obelisk-view=wide']), 'pages');
  assert.equal(view.viewFromArguments(['--obelisk-view=']), 'pages');
  assert.equal(view.viewFromArguments([]), 'pages');
  assert.equal(view.viewFromArguments(['--obelisk-view=pages', '--obelisk-view=pageless']), 'pageless');
});

test('ctrl plus, minus, and zero choose a zoom command', async () => {
  const { zoomShortcut } = await loadRenderer(zoomUrl);
  const down = (key, extra = {}) => zoomShortcut({
    key,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...extra,
  });
  assert.equal(down('+'), 'view-zoom-in');
  assert.equal(down('='), 'view-zoom-in');
  assert.equal(down('Add'), 'view-zoom-in');
  assert.equal(down('+'), 'view-zoom-in');
  assert.equal(down('-'), 'view-zoom-out');
  assert.equal(down('Subtract'), 'view-zoom-out');
  assert.equal(down('0'), 'view-zoom-100');
  assert.equal(down('0', { shiftKey: true }), null);
  assert.equal(down('-', { shiftKey: true }), null);
  assert.equal(down('+', { altKey: true }), null);
  assert.equal(down('+', { ctrlKey: false }), null);
  assert.equal(down('+', { repeat: true }), null);
  assert.equal(zoomShortcut({
    key: '0',
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    repeat: false,
  }), 'view-zoom-100');
});

test('a high resolution wheel moves one preset per 120 units', async () => {
  const { applyWheelSteps, consumeZoomWheel } = await loadRenderer(zoomUrl);
  let turned = consumeZoomWheel(0, -40, 0);
  assert.equal(turned.steps, 0);
  turned = consumeZoomWheel(turned.accumulated, -40, 0);
  assert.equal(turned.steps, 0);
  turned = consumeZoomWheel(turned.accumulated, -40, 0);
  assert.equal(turned.steps, -1);
  assert.equal(applyWheelSteps(100, turned.steps), 125);
  turned = consumeZoomWheel(0, 120, 0);
  assert.equal(turned.steps, 1);
  assert.equal(applyWheelSteps(100, turned.steps), 75);
  turned = consumeZoomWheel(0, 360, 0);
  assert.equal(applyWheelSteps(100, turned.steps), 50);
  assert.equal(applyWheelSteps(50, 1), 50);
  assert.equal(applyWheelSteps(200, -3), 200);
  const line = consumeZoomWheel(0, -1, 1);
  assert.equal(line.steps, -1);
  assert.equal(line.accumulated, 0);
  const cancel = consumeZoomWheel(60, -60, 0);
  assert.equal(cancel.steps, 0);
  assert.equal(cancel.accumulated, 0);
});

test('the caret line stays when it is on screen', async () => {
  const { caretLineVisible } = await loadRenderer(zoomUrl);
  assert.equal(caretLineVisible(200, 220, 100, 400), true);
  assert.equal(caretLineVisible(90, 110, 100, 400), true);
  assert.equal(caretLineVisible(40, 60, 100, 400), false);
  assert.equal(caretLineVisible(500, 520, 100, 400), false);
});

test('page geometry scales with the preset and 100% stays the Letter page', async () => {
  const { pageZoomVars } = await loadRenderer(pageUrl);
  const { letterPageBox, scalePageBox } = await loadRenderer(paginateUrl);
  assert.equal(pageZoomVars(100), undefined);
  const vars = pageZoomVars(150);
  assert.equal(vars['--page-width'], 'calc(8.5in * 1.5)');
  assert.equal(vars['--page-height'], 'calc(11in * 1.5)');
  assert.equal(vars['--page-margin'], 'calc(1in * 1.5)');
  assert.equal(vars['--page-gap'], 'calc(24px * 1.5)');
  assert.equal(vars['--font-size-page'], 'calc(12pt * 1.5)');
  const letter = letterPageBox();
  assert.equal(scalePageBox(letter, 100), letter);
  const half = scalePageBox(letter, 50);
  assert.equal(half.pageWidth, 408);
  assert.equal(half.pageHeight, 528);
  assert.equal(half.marginTop, 48);
  assert.equal(half.gap, 12);
  const wide = scalePageBox(letter, 200);
  assert.equal(wide.pageWidth, 1632);
  assert.equal(wide.pageHeight, 2112);
});

test('arrows in the status bar visit the save state only when it has a tooltip', async () => {
  const { statusControlAfter, statusControls } = await loadRenderer(focusUrl);
  assert.deepEqual(statusControls(false), ['zoom']);
  assert.deepEqual(statusControls(true), ['save', 'zoom']);
  assert.equal(statusControlAfter('bar', 'ArrowRight', false), 'zoom');
  assert.equal(statusControlAfter('bar', 'ArrowLeft', false), 'zoom');
  assert.equal(statusControlAfter('zoom', 'ArrowLeft', false), null);
  assert.equal(statusControlAfter('bar', 'ArrowRight', true), 'save');
  assert.equal(statusControlAfter('save', 'ArrowRight', true), 'zoom');
  assert.equal(statusControlAfter('zoom', 'ArrowLeft', true), 'save');
  assert.equal(statusControlAfter('zoom', 'ArrowRight', true), null);
  assert.equal(statusControlAfter('bar', 'ArrowLeft', true), 'zoom');
});

test('Zoom in is disabled at 200% and Zoom out is disabled at 50%', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const item = (menus, id) => menus.find((menu) => menu.id === 'view').entries.find((entry) => entry.id === id);
  const at = (zoom) => liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    zoom,
  });
  const full = at(200);
  assert.equal(item(full, 'view-zoom-in').enabled, false);
  assert.equal(item(full, 'view-zoom-out').enabled, true);
  assert.equal(item(full, 'view-zoom-100').enabled, true);
  const small = at(50);
  assert.equal(item(small, 'view-zoom-in').enabled, true);
  assert.equal(item(small, 'view-zoom-out').enabled, false);
  const settings = liveMenus({
    documentTab: false,
    selectionEmpty: true,
    editorState: null,
    zoom: 100,
  });
  assert.equal(item(settings, 'view-zoom-in').enabled, true);
  assert.equal(item(settings, 'view-zoom-100').enabled, true);
});
