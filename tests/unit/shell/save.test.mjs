import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const saveUrl = new URL('../../../src/renderer/shell/tabs/save.ts', import.meta.url);
const documentUrl = new URL('../../../src/renderer/shell/tabs/document.ts', import.meta.url);
const conflictUrl = new URL('../../../src/renderer/shell/tabs/SaveConflict.tsx', import.meta.url);
const shortcutUrl = new URL('../../../src/renderer/shell/shortcuts.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function key(extra) {
  return {
    key: 's',
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...extra,
  };
}

test('Ctrl+S saves and Ctrl+Shift+S is Save as', async () => {
  const { shellShortcut } = await loadRenderer(shortcutUrl);
  assert.equal(shellShortcut(key()), 'save');
  assert.equal(shellShortcut(key({ shiftKey: true })), 'save-as');
  assert.equal(shellShortcut(key({ key: 'S', shiftKey: true })), 'save-as');
  assert.equal(shellShortcut(key({ ctrlKey: false })), null);
  assert.equal(shellShortcut(key({ altKey: true })), null);
  assert.equal(shellShortcut(key({ key: 'n' })), 'new');
  assert.equal(shellShortcut(key({ key: 'o' })), 'open');
  assert.equal(shellShortcut(key({ key: ',' })), 'settings');
});

test('a new document encodes, and an edit keeps the tab changed until that revision is saved', async () => {
  const { createTab, tabHasUnsavedChanges } = await loadRenderer(modelUrl);
  const {
    CONFLICT_CHOICES,
    CONFLICT_MESSAGE,
    applySavedTab,
    documentForTab,
    markSaveFailed,
    noteEditorChange,
    tabSaveState,
    tabStaysChanged,
  } = await loadRenderer(saveUrl);
  const { insertText } = await loadRenderer(stateUrl);

  const created = createTab(1);
  assert.equal(tabHasUnsavedChanges(created), false);
  assert.equal(tabSaveState(created), 'saved');
  const built = documentForTab(created);
  const encoded = await encodeObk(built.document, emptyManifest('0.1.24.0'));
  assert.equal(encoded.ok, true, encoded.ok ? '' : encoded.message);

  const edited = noteEditorChange(created, insertText(created.editor, 'Hello'));
  assert.equal(edited.revision, 1);
  assert.equal(tabHasUnsavedChanges(edited), true);
  assert.equal(tabSaveState(edited), 'unsaved');
  const changed = documentForTab(edited);
  assert.equal(changed.document.blocks[0].content[0].text, 'Hello');
  assert.equal(changed.blockIds[0], created.blockIds[0]);

  const failed = markSaveFailed(edited);
  assert.equal(tabSaveState(failed), 'not-saved');
  assert.equal(tabStaysChanged(failed), true);
  assert.equal(tabHasUnsavedChanges(failed), true);

  const during = noteEditorChange(edited, insertText(edited.editor, ' there'));
  assert.equal(during.revision, 2);
  const savedOld = applySavedTab(during, {
    revision: 1,
    stat: { size: 10, modifiedMs: 20 },
    document: changed.document,
    blockIds: changed.blockIds,
    handle: 'abc',
    name: 'Hello.obk',
  });
  assert.equal(savedOld.handle, 'abc');
  assert.equal(savedOld.title, 'Hello.obk');
  assert.equal(savedOld.stat.modifiedMs, 20);
  assert.equal(tabHasUnsavedChanges(savedOld), true);
  assert.equal(tabSaveState(savedOld), 'unsaved');
  assert.equal(savedOld.path, undefined);

  const caught = applySavedTab(edited, {
    revision: 1,
    stat: { size: 10, modifiedMs: 20 },
    document: changed.document,
    blockIds: changed.blockIds,
    handle: 'abc',
    name: 'Hello.obk',
  });
  assert.equal(tabHasUnsavedChanges(caught), false);
  assert.equal(tabSaveState(caught), 'saved');
  assert.equal(JSON.stringify(caught).includes('C:\\'), false);

  assert.equal(CONFLICT_MESSAGE, 'Another program changed this file.');
  assert.deepEqual(CONFLICT_CHOICES.map((item) => item.label), ['Overwrite', 'Save as…', 'Cancel']);
});

test('the conflict prompt offers Overwrite, Save as, and Cancel', async () => {
  const { SaveConflict } = await loadRenderer(conflictUrl);
  const html = renderToStaticMarkup(createElement(SaveConflict, { onChoose() {} }));
  assert.match(html, /Another program changed this file/);
  assert.match(html, /Overwrite/);
  assert.match(html, /Save as…/);
  assert.match(html, /Cancel/);
  assert.match(html, /data-save-choice="overwrite"/);
  assert.match(html, /data-save-choice="save-as"/);
  assert.match(html, /data-save-choice="cancel"/);
  assert.match(html, /role="alertdialog"/);
});

test('the close prompt offers Save, Discard, and Cancel', async () => {
  const closePromptUrl = new URL('../../../src/renderer/shell/tabs/ClosePrompt.tsx', import.meta.url);
  const { ClosePrompt } = await loadRenderer(closePromptUrl);
  const html = renderToStaticMarkup(createElement(ClosePrompt, { tabTitle: 'Field notes', onChoose() {} }));
  assert.match(html, /Save changes to Field notes before closing\?/);
  assert.match(html, /Save/);
  assert.match(html, /Discard/);
  assert.match(html, /Cancel/);
  assert.match(html, /data-close-choice="save"/);
  assert.match(html, /data-close-choice="discard"/);
  assert.match(html, /data-close-choice="cancel"/);
  assert.match(html, /role="alertdialog"/);
});

test('an opened document is saved unchanged until a paragraph is edited', async () => {
  const { documentFromEditor, visibleParagraphTexts } = await loadRenderer(documentUrl);
  const base = {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: '00000000-0000-4000-8000-000000000001' },
    footer: { id: '00000000-0000-4000-8000-000000000002' },
    blocks: [
      {
        type: 'heading',
        id: '00000000-0000-4000-8000-000000000003',
        level: 1,
        content: [{ type: 'text', text: 'Title' }],
      },
      {
        type: 'paragraph',
        id: '00000000-0000-4000-8000-000000000004',
        align: 'left',
        lineSpacing: 'single',
        spaceBefore: 0,
        spaceAfter: 0,
        indents: { left: 0, first: 0, hanging: 0 },
        content: [{ type: 'text', text: 'Lab notes', marks: { bold: true } }],
      },
    ],
  };
  const same = documentFromEditor(base, visibleParagraphTexts(base));
  assert.equal(same.document, base);
  const edited = documentFromEditor(base, ['Lab notes changed']);
  assert.equal(edited.document.blocks[0].type, 'heading');
  assert.equal(edited.document.blocks[1].content[0].text, 'Lab notes changed');
  assert.equal(edited.document.blocks[1].id, '00000000-0000-4000-8000-000000000004');
  assert.equal(Object.hasOwn(edited.document.blocks[1].content[0], 'marks'), false);
});
