import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const saveUrl = new URL('../../../src/renderer/shell/tabs/save.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const constantsUrl = new URL('../../../src/renderer/autosave/constants.ts', import.meta.url);
const clockUrl = new URL('../../../src/renderer/autosave/clock.ts', import.meta.url);
const eligibilityUrl = new URL('../../../src/renderer/autosave/eligibility.ts', import.meta.url);
const autosaveModelUrl = new URL('../../../src/renderer/autosave/model.ts', import.meta.url);
const schedulerUrl = new URL('../../../src/renderer/autosave/scheduler.ts', import.meta.url);
const syncUrl = new URL('../../../src/renderer/autosave/sync.ts', import.meta.url);

async function autosaveModules() {
  const [
    { AUTOSAVE_DELAY_MS },
    { createFakeAutosaveClock },
    { autosaveEligible },
    { pauseAutosave },
    { createAutosaveScheduler },
    { syncTabAutosave },
  ] = await Promise.all([
    loadRenderer(constantsUrl),
    loadRenderer(clockUrl),
    loadRenderer(eligibilityUrl),
    loadRenderer(autosaveModelUrl),
    loadRenderer(schedulerUrl),
    loadRenderer(syncUrl),
  ]);
  return {
    AUTOSAVE_DELAY_MS,
    createFakeAutosaveClock,
    autosaveEligible,
    pauseAutosave,
    createAutosaveScheduler,
    syncTabAutosave,
  };
}

test('a never-saved tab is not eligible and never fires autosave', async () => {
  const { AUTOSAVE_DELAY_MS, autosaveEligible, createAutosaveScheduler, createFakeAutosaveClock, syncTabAutosave } =
    await autosaveModules();
  const { createTab } = await loadRenderer(modelUrl);
  const { noteEditorChange } = await loadRenderer(saveUrl);
  const { insertText: insert } = await loadRenderer(stateUrl);

  const tab = createTab(1);
  assert.equal(autosaveEligible(tab), false);

  const edited = noteEditorChange(tab, insert(tab.editor, 'Draft'));
  assert.equal(autosaveEligible(edited), false);

  const clock = createFakeAutosaveClock();
  const fires = [];
  const scheduler = createAutosaveScheduler({
    clock,
    delayMs: AUTOSAVE_DELAY_MS,
    onFire: (tabId) => {
      fires.push(tabId);
    },
  });
  syncTabAutosave(scheduler, edited);
  clock.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(fires, []);
});

test('a saved tab autosaves within 30 s of the last edit (FR-14, AC-05)', async () => {
  const { AUTOSAVE_DELAY_MS, autosaveEligible, createAutosaveScheduler, createFakeAutosaveClock } =
    await autosaveModules();
  const { createTab } = await loadRenderer(modelUrl);
  const { applySavedTab, noteEditorChange } = await loadRenderer(saveUrl);
  const { insertText: insert } = await loadRenderer(stateUrl);

  let tab = createTab(1);
  tab = applySavedTab(noteEditorChange(tab, insert(tab.editor, 'First')), {
    revision: 1,
    stat: { size: 10, modifiedMs: 20 },
    document: tab.baseDocument,
    blockIds: tab.blockIds,
    handle: 'file-a',
    name: 'Notes.obk',
  });
  assert.equal(autosaveEligible(tab), false);

  tab = noteEditorChange(tab, insert(tab.editor, ' edit'));
  assert.equal(autosaveEligible(tab), true);

  const clock = createFakeAutosaveClock();
  const fires = [];
  const scheduler = createAutosaveScheduler({
    clock,
    delayMs: AUTOSAVE_DELAY_MS,
    onFire: (tabId, revision) => {
      fires.push({ tabId, revision });
    },
  });
  scheduler.sync(tab.id, { revision: tab.revision });
  clock.advance(AUTOSAVE_DELAY_MS - 1);
  assert.deepEqual(fires, []);

  tab = noteEditorChange(tab, insert(tab.editor, ' again'));
  scheduler.sync(tab.id, { revision: tab.revision });
  clock.advance(AUTOSAVE_DELAY_MS - 1);
  assert.deepEqual(fires, []);

  clock.advance(1);
  assert.deepEqual(fires, [{ tabId: tab.id, revision: tab.revision }]);
});

test('AC-05 loses at most 30 s of edits when autosave ran before a later edit', async () => {
  const { AUTOSAVE_DELAY_MS, createAutosaveScheduler, createFakeAutosaveClock } = await autosaveModules();
  const { createTab } = await loadRenderer(modelUrl);
  const { applySavedTab, noteEditorChange } = await loadRenderer(saveUrl);
  const { insertText: insert } = await loadRenderer(stateUrl);

  let tab = createTab(1);
  tab = applySavedTab(noteEditorChange(tab, insert(tab.editor, 'On disk')), {
    revision: 1,
    stat: { size: 10, modifiedMs: 100 },
    document: tab.baseDocument,
    blockIds: tab.blockIds,
    handle: 'file-b',
    name: 'Lab.obk',
  });

  const clock = createFakeAutosaveClock();
  const savedRevisions = [];
  const scheduler = createAutosaveScheduler({
    clock,
    delayMs: AUTOSAVE_DELAY_MS,
    onFire: (_tabId, revision) => {
      savedRevisions.push(revision);
    },
  });

  tab = noteEditorChange(tab, insert(tab.editor, ' batch one'));
  scheduler.sync(tab.id, { revision: tab.revision });
  clock.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(savedRevisions, [tab.revision]);

  clock.advance(10_000);
  tab = noteEditorChange(tab, insert(tab.editor, ' batch two'));
  scheduler.sync(tab.id, { revision: tab.revision });
  clock.advance(10_000);
  assert.deepEqual(savedRevisions, [2]);

  clock.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(savedRevisions, [2, tab.revision]);
});

test('after a conflict Cancel the status bar shows Autosave paused (FR-04, AC-06)', async () => {
  const { autosaveEligible, pauseAutosave } = await autosaveModules();
  const { createTab } = await loadRenderer(modelUrl);
  const { applySavedTab, noteEditorChange, tabSaveState } = await loadRenderer(saveUrl);
  const { insertText: insert } = await loadRenderer(stateUrl);

  let tab = createTab(1);
  tab = applySavedTab(noteEditorChange(tab, insert(tab.editor, 'Saved once')), {
    revision: 1,
    stat: { size: 10, modifiedMs: 50 },
    document: tab.baseDocument,
    blockIds: tab.blockIds,
    handle: 'file-c',
    name: 'Essay.obk',
  });
  tab = noteEditorChange(tab, insert(tab.editor, ' more'));
  assert.equal(tabSaveState(tab), 'unsaved');

  tab = pauseAutosave(tab);
  assert.equal(tabSaveState(tab), 'autosave-paused');
  assert.equal(autosaveEligible(tab), false);
});

test('a successful save clears Autosave paused', async () => {
  const { pauseAutosave } = await autosaveModules();
  const { createTab } = await loadRenderer(modelUrl);
  const { applySavedTab, noteEditorChange, tabSaveState } = await loadRenderer(saveUrl);
  const { insertText: insert } = await loadRenderer(stateUrl);

  let tab = createTab(1);
  tab = applySavedTab(noteEditorChange(tab, insert(tab.editor, 'Start')), {
    revision: 1,
    stat: { size: 10, modifiedMs: 50 },
    document: tab.baseDocument,
    blockIds: tab.blockIds,
    handle: 'file-d',
    name: 'Start.obk',
  });
  tab = pauseAutosave(tab);
  tab = applySavedTab(tab, {
    revision: tab.revision,
    stat: { size: 11, modifiedMs: 60 },
    document: tab.baseDocument,
    blockIds: tab.blockIds,
  });
  assert.equal(tab.autosavePaused, false);
  assert.equal(tabSaveState(tab), 'saved');
});
