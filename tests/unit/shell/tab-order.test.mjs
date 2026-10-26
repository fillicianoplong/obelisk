import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const orderUrl = new URL('../../../src/renderer/shell/tabs/order.ts', import.meta.url);
const closeUrl = new URL('../../../src/renderer/shell/tabs/close.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

const THREE = ['notes', 'lab', 'trip'];

function walk(tabAfterCycle, ids, start, direction, steps) {
  const seen = [start];
  let current = start;
  for (let step = 0; step < steps; step += 1) {
    current = tabAfterCycle(ids, current, direction);
    seen.push(current);
  }
  return seen;
}

test('Ctrl+Tab moves to the next tab and wraps', async () => {
  const { tabAfterCycle } = await loadRenderer(orderUrl);
  assert.deepEqual(walk(tabAfterCycle, THREE, 'notes', 1, 4), ['notes', 'lab', 'trip', 'notes', 'lab']);
  assert.equal(tabAfterCycle(['only'], 'only', 1), 'only');
});

test('Ctrl+Shift+Tab moves to the previous tab and wraps', async () => {
  const { tabAfterCycle } = await loadRenderer(orderUrl);
  assert.deepEqual(walk(tabAfterCycle, THREE, 'notes', -1, 4), ['notes', 'trip', 'lab', 'notes', 'trip']);
  assert.equal(tabAfterCycle(['only'], 'only', -1), 'only');
});

test('Left and Right stop at the ends, and Home and End jump', async () => {
  const { tabAfterFocusKey } = await loadRenderer(orderUrl);
  assert.equal(tabAfterFocusKey(THREE, 'notes', 'ArrowLeft'), 'notes');
  assert.equal(tabAfterFocusKey(THREE, 'notes', 'ArrowRight'), 'lab');
  assert.equal(tabAfterFocusKey(THREE, 'lab', 'ArrowRight'), 'trip');
  assert.equal(tabAfterFocusKey(THREE, 'trip', 'ArrowRight'), 'trip');
  assert.equal(tabAfterFocusKey(THREE, 'trip', 'ArrowLeft'), 'lab');
  assert.equal(tabAfterFocusKey(THREE, 'lab', 'Home'), 'notes');
  assert.equal(tabAfterFocusKey(THREE, 'notes', 'End'), 'trip');
});

test('closing a tab activates the tab on the right, or the left at the end', async () => {
  const { closeTab } = await loadRenderer(closeUrl);
  const tabs = [
    { id: 'notes', unsaved: false },
    { id: 'lab', unsaved: false },
    { id: 'trip', unsaved: false },
  ];
  assert.deepEqual(closeTab(tabs, 'notes', 'notes'), { action: 'close', activeId: 'lab' });
  assert.deepEqual(closeTab(tabs, 'lab', 'lab'), { action: 'close', activeId: 'trip' });
  assert.deepEqual(closeTab(tabs, 'trip', 'trip'), { action: 'close', activeId: 'lab' });
  assert.deepEqual(closeTab(tabs, 'lab', 'notes'), { action: 'close', activeId: 'notes' });
  assert.deepEqual(closeTab([{ id: 'notes', unsaved: false }], 'notes', 'notes'), {
    action: 'close',
    activeId: null,
  });
  assert.deepEqual(closeTab(tabs, 'missing', 'notes'), { action: 'missing' });
});

test('a changed tab goes through the close prompt and stays unless discarded', async () => {
  const { closeTab, confirmClosePrompt } = await loadRenderer(closeUrl);
  const tabs = [
    { id: 'notes', unsaved: true },
    { id: 'lab', unsaved: false },
  ];
  const prompt = closeTab(tabs, 'notes', 'notes');
  assert.deepEqual(prompt, {
    action: 'prompt',
    prompt: { tabId: 'notes' },
    activeId: 'lab',
  });
  assert.equal(confirmClosePrompt(prompt.prompt), 'cancel');
  assert.deepEqual(closeTab(tabs, 'notes', 'notes', { force: true }), {
    action: 'close',
    activeId: 'lab',
  });
});

test('an edit marks the tab unsaved and the accessible name ends in Unsaved changes', async () => {
  const { createTab, replaceTabEditor, tabAccessibleName, tabHasUnsavedChanges, tabTooltip } = await loadRenderer(modelUrl);
  const { insertText, setCaret, undoLastChange } = await loadRenderer(stateUrl);
  const tab = createTab(1);
  assert.equal(tabHasUnsavedChanges(tab), false);
  assert.equal(tabAccessibleName(tab), 'Untitled 1');
  assert.equal(tabTooltip(tab), 'Untitled 1');

  const moved = replaceTabEditor(tab, setCaret(tab.editor, 1));
  assert.equal(tabHasUnsavedChanges(moved), false);
  assert.equal(tabAccessibleName(moved), 'Untitled 1');

  const edited = replaceTabEditor(tab, insertText(tab.editor, 'Field notes'));
  assert.equal(tabHasUnsavedChanges(edited), true);
  assert.equal(tabAccessibleName(edited), 'Untitled 1, Unsaved changes');
  assert.equal(tabAccessibleName(edited).endsWith('Unsaved changes'), true);

  const undone = undoLastChange(edited.editor);
  assert.ok(undone);
  const restored = replaceTabEditor(edited, undone);
  assert.equal(tabHasUnsavedChanges(restored), false);
  assert.equal(tabAccessibleName(restored), 'Untitled 1');

  const saved = { ...edited, title: 'Field notes', path: 'C:\\Class\\Field notes.obk' };
  assert.equal(tabTooltip(saved), 'Field notes — C:\\Class\\Field notes.obk');
});
