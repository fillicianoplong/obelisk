import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const regionsUrl = new URL('../../../src/renderer/shell/focus/regions.ts', import.meta.url);
const memoryUrl = new URL('../../../src/renderer/shell/focus/memory.ts', import.meta.url);
const targetUrl = new URL('../../../src/renderer/shell/focus/target.ts', import.meta.url);

const BASE = ['menu-bar', 'tab-strip', 'page', 'status-bar'];

function walk(regionAfter, order, start, direction, steps) {
  const seen = [];
  let current = start;
  for (let step = 0; step < steps; step += 1) {
    current = regionAfter(order, current, direction);
    seen.push(current);
  }
  return seen;
}

test('F6 visits menu bar, tabs, page, and status bar, then wraps', async () => {
  const { regionCycle, regionAfter } = await loadRenderer(regionsUrl);
  const order = regionCycle();
  assert.deepEqual(order, BASE);
  assert.deepEqual(walk(regionAfter, order, 'menu-bar', 1, 4), [
    'tab-strip',
    'page',
    'status-bar',
    'menu-bar',
  ]);
  assert.deepEqual(walk(regionAfter, order, 'page', 1, 4), [
    'status-bar',
    'menu-bar',
    'tab-strip',
    'page',
  ]);
  for (const start of order) {
    const forward = walk(regionAfter, order, start, 1, order.length);
    assert.equal(forward[forward.length - 1], start, start);
  }
});

test('Shift+F6 walks the regions backward and wraps', async () => {
  const { regionCycle, regionAfter } = await loadRenderer(regionsUrl);
  const order = regionCycle();
  assert.deepEqual(walk(regionAfter, order, 'menu-bar', -1, 4), [
    'status-bar',
    'page',
    'tab-strip',
    'menu-bar',
  ]);
  assert.deepEqual(walk(regionAfter, order, 'status-bar', -1, 4), [
    'page',
    'tab-strip',
    'menu-bar',
    'status-bar',
  ]);
  for (const start of order) {
    const backward = walk(regionAfter, order, start, -1, order.length);
    assert.equal(backward[backward.length - 1], start, start);
  }
});

test('focus outside the cycle enters at the end the key is moving toward', async () => {
  const { regionCycle, regionAfter } = await loadRenderer(regionsUrl);
  const order = regionCycle();
  assert.equal(regionAfter(order, null, 1), 'menu-bar');
  assert.equal(regionAfter(order, null, -1), 'status-bar');
  assert.equal(regionAfter(order, 'title-bar', 1), 'menu-bar');
  assert.equal(regionAfter(order, 'title-bar', -1), 'status-bar');
});

test('a stub region after the tabs is one added stop, which is where the find bar goes', async () => {
  const { regionCycle, regionAfter } = await loadRenderer(regionsUrl);
  const order = regionCycle(['stub-region']);
  assert.deepEqual(order, ['menu-bar', 'tab-strip', 'stub-region', 'page', 'status-bar']);
  assert.equal(regionAfter(order, 'tab-strip', 1), 'stub-region');
  assert.equal(regionAfter(order, 'stub-region', 1), 'page');
  assert.equal(regionAfter(order, 'stub-region', -1), 'tab-strip');
  assert.equal(walk(regionAfter, order, 'menu-bar', 1, order.length).at(-1), 'menu-bar');
  assert.deepEqual(regionCycle(['find-bar']), [
    'menu-bar',
    'tab-strip',
    'find-bar',
    'page',
    'status-bar',
  ]);
});

test('each region remembers its own last focused control', async () => {
  const { emptyFocusMemory, rememberFocus, recallFocus } = await loadRenderer(memoryUrl);
  let memory = emptyFocusMemory();
  assert.equal(recallFocus(memory, 'page'), null);
  assert.equal(recallFocus(memory, 'menu-bar'), null);

  memory = rememberFocus(memory, 'page', 'region:page-editor');
  memory = rememberFocus(memory, 'menu-bar', 'id:menu-top-file');
  memory = rememberFocus(memory, 'tab-strip', 'id:tab-untitled-1');
  memory = rememberFocus(memory, 'status-bar', 'region:status-bar');
  assert.equal(recallFocus(memory, 'page'), 'region:page-editor');
  assert.equal(recallFocus(memory, 'menu-bar'), 'id:menu-top-file');

  const replaced = rememberFocus(memory, 'menu-bar', 'id:menu-top-edit');
  assert.equal(recallFocus(replaced, 'menu-bar'), 'id:menu-top-edit');
  assert.equal(recallFocus(replaced, 'page'), 'region:page-editor');
  assert.equal(recallFocus(replaced, 'tab-strip'), 'id:tab-untitled-1');
  assert.equal(recallFocus(replaced, 'status-bar'), 'region:status-bar');
  assert.equal(recallFocus(memory, 'menu-bar'), 'id:menu-top-file');

  const same = rememberFocus(replaced, 'page', 'region:page-editor');
  assert.equal(same, replaced);

  memory = rememberFocus(replaced, 'page', 'region:page-settings');
  assert.equal(recallFocus(memory, 'page'), 'region:page-settings');
  assert.equal(recallFocus(memory, 'status-bar'), 'region:status-bar');
});

test('a focus key prefers the element id, then the control, then the region marker', async () => {
  const { focusTargetKey } = await loadRenderer(targetUrl);
  const { cycleRegionId } = await loadRenderer(regionsUrl);
  assert.equal(focusTargetKey({
    id: 'menu-top-edit',
    region: null,
    classes: ['menu-button'],
    tabId: null,
  }), 'id:menu-top-edit');
  assert.equal(focusTargetKey({
    id: '',
    region: 'page-editor',
    classes: ['page-sheet'],
    tabId: null,
  }), 'region:page-editor');
  assert.equal(focusTargetKey({
    id: '',
    region: null,
    classes: ['status-save'],
    tabId: null,
  }), 'status-save');
  assert.equal(focusTargetKey({
    id: '',
    region: null,
    classes: ['tab-new'],
    tabId: null,
  }), 'tab-new');
  assert.equal(focusTargetKey({
    id: '',
    region: null,
    classes: ['tab-close'],
    tabId: 'untitled-2',
  }), 'close:untitled-2');
  assert.equal(focusTargetKey({
    id: '',
    region: null,
    classes: ['tab-title'],
    tabId: null,
  }), null);
  assert.equal(cycleRegionId('page-editor'), 'page');
  assert.equal(cycleRegionId('page'), 'page');
  assert.equal(cycleRegionId('menu-bar'), 'menu-bar');
  assert.equal(cycleRegionId('tab-strip'), 'tab-strip');
  assert.equal(cycleRegionId('status-bar'), 'status-bar');
  assert.equal(cycleRegionId('find-bar'), 'find-bar');
  assert.equal(cycleRegionId('title-bar'), null);
  assert.equal(cycleRegionId(null), null);
});
