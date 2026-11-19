import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modelUrl = new URL('../../../src/renderer/shell/contextmenu/model.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/shell/contextmenu/reference.ts', import.meta.url);
const keyboardUrl = new URL('../../../src/renderer/shell/menus/keyboard.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);

const KINDS = [
  'text',
  'block',
  'table-cell',
  'image',
  'equation-block',
  'column-row',
  'drawing-pad',
  'diagram',
  'signature',
  'link',
  'inline-equation',
  'date-time',
];

test('each context target follows the Context menus reference labels', async () => {
  const model = await loadRenderer(modelUrl);
  const reference = await loadRenderer(referenceUrl);
  for (const kind of KINDS) {
    const key = reference.CONTEXT_TARGET_REFERENCE_KEY[kind];
    const expected = reference.CONTEXT_MENU_REFERENCE[key];
    assert.ok(expected, kind);
    const labels = model.menuEntryLabels(model.composeContextMenu(kind));
    for (const label of expected) {
      assert.ok(labels.includes(label), `${kind}: missing ${label}`);
    }
  }
});

test('signature block context leaves Turn into out of the block-handle section', async () => {
  const model = await loadRenderer(modelUrl);
  const labels = model.menuEntryLabels(model.composeContextMenu('signature'));
  assert.equal(labels.includes('Turn into'), false);
});

test('the keyboard opener starts a context menu session', async () => {
  const keyboard = await loadRenderer(keyboardUrl);
  const opened = keyboard.keyboardOpenContextMenu('context');
  assert.equal(opened.session.menuId, 'context');
  assert.equal(opened.session.keyboard, true);
  assert.deepEqual(opened.session.panels, [null]);
  assert.equal(opened.session.escToBar, false);
});

test('ArrowRight opens Turn into on a live block menu', async () => {
  const keyboard = await loadRenderer(keyboardUrl);
  const model = await loadRenderer(modelUrl);
  const apply = await loadRenderer(applyUrl);
  const state = await loadRenderer(new URL('../../../src/renderer/editor/state.ts', import.meta.url));
  const editorState = state.createTabEditorState();
  const menus = [{
    id: 'context',
    label: 'Context',
    accessKey: '',
    entries: apply.liveMenuEntries(model.composeContextMenu('block'), {
      documentTab: true,
      selectionEmpty: true,
      editorState,
    }),
  }];
  const opened = keyboard.pointerOpenContextMenu('context');
  let session = opened.session;
  let focused = null;
  for (let step = 0; step < 12; step += 1) {
    const move = keyboard.reduceMenuKey(menus, session, {
      type: 'keydown',
      key: 'ArrowDown',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    });
    session = move.session;
    focused = session.panels[session.panels.length - 1];
    if (focused === 'block-turn-into') {
      break;
    }
  }
  assert.equal(focused, 'block-turn-into');
  const submenu = keyboard.reduceMenuKey(menus, session, {
    type: 'keydown',
    key: 'ArrowRight',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
  });
  assert.equal(submenu.session.panels[0], 'block-turn-into');
  assert.ok(submenu.session.panels.length >= 2);
});

test('the context menu host uses stylesheet positioning, not inline style attributes', async () => {
  const css = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  assert.match(css, /\.context-menu-host/);
  assert.match(css, /--context-menu-left/);
  assert.match(css, /--context-menu-top/);
  const tsx = await readFile(path.join(root, 'src/renderer/shell/contextmenu/ContextMenu.tsx'), 'utf8');
  assert.equal(tsx.includes('style='), false);
});