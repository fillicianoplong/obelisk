import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const keyboardUrl = new URL('../../../src/renderer/shell/menus/keyboard.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/menus/model.ts', import.meta.url);

function keydown(key, extra = {}) {
  return {
    type: 'keydown',
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...extra,
  };
}

function keyup(key, extra = {}) {
  return {
    type: 'keyup',
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...extra,
  };
}

function play(reduceMenuKey, menus, events, start) {
  let session = start;
  const log = [];
  for (const event of events) {
    const result = reduceMenuKey(menus, session, event);
    session = result.session;
    log.push(result);
  }
  return { session, log };
}

async function menuModule() {
  const keyboard = await loadRenderer(keyboardUrl);
  const model = await loadRenderer(modelUrl);
  return { ...keyboard, ...model };
}

test('Alt shows access keys, and releasing it focuses the menu bar', async () => {
  const { APP_MENUS, accessKeysVisible, initialMenuSession, reduceMenuKey } = await menuModule();
  const { session, log } = play(reduceMenuKey, APP_MENUS, [keydown('Alt'), keyup('Alt')], initialMenuSession());
  assert.equal(log[0].handled, true);
  assert.equal(log[0].session.altDown, true);
  assert.equal(log[0].session.keyboard, false);
  assert.equal(log[0].session.panels.length, 0);
  assert.equal(accessKeysVisible(log[0].session), true);
  assert.equal(session.keyboard, true);
  assert.equal(session.escToBar, true);
  assert.equal(session.menuId, 'file');
  assert.deepEqual(session.panels, []);
  assert.equal(accessKeysVisible(session), true);
  assert.equal(log[1].command, null);
});

test('F10 focuses the menu bar, and a second F10 leaves it', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  const opened = reduceMenuKey(APP_MENUS, initialMenuSession(), keydown('F10'));
  assert.equal(opened.session.keyboard, true);
  assert.equal(opened.session.menuId, 'file');
  assert.deepEqual(opened.session.panels, []);
  assert.equal(opened.restoreFocus, false);
  const closed = reduceMenuKey(APP_MENUS, opened.session, keydown('F10'));
  assert.equal(closed.session.keyboard, false);
  assert.equal(closed.session.menuId, null);
  assert.equal(closed.restoreFocus, true);
  assert.equal(closed.command, null);
});

test('Alt+F opens File and Alt+O opens Format', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  const file = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true }), keyup('f', { altKey: true }), keyup('Alt')],
    initialMenuSession(),
  );
  assert.equal(file.session.menuId, 'file');
  assert.deepEqual(file.session.panels, ['file-new']);
  assert.equal(file.session.keyboard, true);
  assert.equal(file.log[1].command, null);

  const format = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('o', { altKey: true }), keyup('Alt')],
    initialMenuSession(),
  );
  assert.equal(format.session.menuId, 'format');
  assert.deepEqual(format.session.panels, ['format-text']);
  assert.notEqual(format.session.menuId, 'file');
});

test('a letter from the menu bar opens that menu on its first enabled item', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  const bar = reduceMenuKey(APP_MENUS, initialMenuSession(), keydown('F10'));
  const file = reduceMenuKey(APP_MENUS, bar.session, keydown('f'));
  assert.deepEqual(file.session.panels, ['file-new']);
  const tools = reduceMenuKey(APP_MENUS, bar.session, keydown('t'));
  assert.equal(tools.session.menuId, 'tools');
  assert.deepEqual(tools.session.panels, ['tools-settings']);
  const edit = reduceMenuKey(APP_MENUS, bar.session, keydown('e'));
  assert.equal(edit.session.menuId, 'edit');
  assert.deepEqual(edit.session.panels, [null]);
});

test('arrows, Home, and End skip disabled items and wrap', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  let session = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true })],
    initialMenuSession(),
  ).session;
  const steps = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'];
  const seen = ['file-new'];
  for (const key of steps) {
    session = reduceMenuKey(APP_MENUS, session, keydown(key)).session;
    seen.push(session.panels[0]);
  }
  assert.deepEqual(seen, ['file-new', 'file-template', 'file-export', 'file-close', 'file-new']);
  session = reduceMenuKey(APP_MENUS, session, keydown('ArrowUp')).session;
  assert.equal(session.panels[0], 'file-close');
  session = reduceMenuKey(APP_MENUS, session, keydown('Home')).session;
  assert.equal(session.panels[0], 'file-new');
  session = reduceMenuKey(APP_MENUS, session, keydown('End')).session;
  assert.equal(session.panels[0], 'file-close');
  assert.equal(seen.includes('file-open'), false);
});

test('Right opens a submenu and Left closes it', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  let session = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true }), keydown('ArrowDown'), keydown('ArrowDown')],
    initialMenuSession(),
  ).session;
  assert.equal(session.panels[0], 'file-export');
  session = reduceMenuKey(APP_MENUS, session, keydown('ArrowRight')).session;
  assert.deepEqual(session.panels, ['file-export', null]);
  session = reduceMenuKey(APP_MENUS, session, keydown('ArrowLeft')).session;
  assert.deepEqual(session.panels, ['file-export']);
  session = reduceMenuKey(APP_MENUS, session, keydown('ArrowRight')).session;
  session = reduceMenuKey(APP_MENUS, session, keydown('ArrowRight')).session;
  assert.equal(session.menuId, 'edit');
  assert.equal(session.panels.length, 1);
});

test('Enter runs an enabled item and does not run a disabled one', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  const opened = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true }), keyup('f', { altKey: true }), keyup('Alt')],
    initialMenuSession(),
  ).session;
  const ran = reduceMenuKey(APP_MENUS, opened, keydown('Enter'));
  assert.equal(ran.command, 'new');
  assert.equal(ran.restoreFocus, true);
  assert.equal(ran.session.keyboard, false);
  assert.equal(ran.session.menuId, null);

  const byLetter = reduceMenuKey(APP_MENUS, opened, keydown('c'));
  assert.equal(byLetter.command, 'close-tab');

  const disabled = reduceMenuKey(APP_MENUS, opened, keydown('o'));
  assert.equal(disabled.command, null);
  assert.equal(disabled.session.menuId, 'file');
  assert.deepEqual(disabled.session.panels, ['file-new']);

  const tools = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('t', { altKey: true }), keydown('Enter')],
    initialMenuSession(),
  );
  assert.equal(tools.log[2].command, 'settings');
});

test('Esc closes one level and then returns focus', async () => {
  const { APP_MENUS, initialMenuSession, reduceMenuKey } = await menuModule();
  const submenu = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('F10'), keydown('f'), keydown('ArrowDown'), keydown('ArrowRight')],
    initialMenuSession(),
  ).session;
  assert.deepEqual(submenu.panels, ['file-template', null]);
  const parent = reduceMenuKey(APP_MENUS, submenu, keydown('Escape'));
  assert.equal(parent.restoreFocus, false);
  assert.deepEqual(parent.session.panels, ['file-template']);
  assert.equal(parent.session.keyboard, true);
  const bar = reduceMenuKey(APP_MENUS, parent.session, keydown('Escape'));
  assert.equal(bar.restoreFocus, false);
  assert.deepEqual(bar.session.panels, []);
  assert.equal(bar.session.keyboard, true);
  assert.equal(bar.session.menuId, 'file');
  const left = reduceMenuKey(APP_MENUS, bar.session, keydown('Escape'));
  assert.equal(left.restoreFocus, true);
  assert.equal(left.session.keyboard, false);

  const direct = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true })],
    initialMenuSession(),
  ).session;
  const closed = reduceMenuKey(APP_MENUS, direct, keydown('Escape'));
  assert.equal(closed.restoreFocus, true);
  assert.equal(closed.session.menuId, null);
  assert.equal(closed.command, null);
});

test('keyboard code follows the menu data, including a menu added later', async () => {
  const { initialMenuSession, reduceMenuKey } = await menuModule();
  const source = await readFile(path.join(root, 'src/renderer/shell/menus/keyboard.ts'), 'utf8');
  assert.equal(source.includes('file-new'), false);
  assert.equal(source.includes('settings'), false);
  assert.equal(source.includes('APP_MENUS'), false);
  const added = [
    {
      id: 'alpha',
      label: 'Alpha',
      accessKey: 'a',
      entries: [
        { id: 'alpha-skip', label: 'Skip', accessKey: 's', enabled: false },
        { id: 'alpha-run', label: 'Run', accessKey: 'r', enabled: true, command: 'do-run' },
      ],
    },
    {
      id: 'beta',
      label: 'Beta',
      accessKey: 'b',
      entries: [
        {
          id: 'beta-sub',
          label: 'Sub',
          accessKey: 'u',
          enabled: true,
          submenu: [{ id: 'beta-child', label: 'Child', accessKey: 'c', enabled: true, command: 'do-child' }],
        },
      ],
    },
  ];
  const opened = play(
    reduceMenuKey,
    added,
    [keydown('Alt'), keydown('b', { altKey: true })],
    initialMenuSession(),
  ).session;
  assert.deepEqual(opened.panels, ['beta-sub']);
  const child = reduceMenuKey(added, opened, keydown('ArrowRight'));
  assert.deepEqual(child.session.panels, ['beta-sub', 'beta-child']);
  const ran = reduceMenuKey(added, child.session, keydown('Enter'));
  assert.equal(ran.command, 'do-child');
  const alpha = play(
    reduceMenuKey,
    added,
    [keydown('F10'), keydown('a'), keydown('Enter')],
    initialMenuSession(),
  );
  assert.equal(alpha.log[2].command, 'do-run');
});

test('top menus use F E V I O T H, and each menu keeps its access keys unique', async () => {
  const { APP_MENUS, accessKeyIndex, accessibleName, isSeparator } = await menuModule();
  assert.deepEqual(
    APP_MENUS.map((menu) => [menu.label, menu.accessKey.toLowerCase()]),
    [
      ['File', 'f'],
      ['Edit', 'e'],
      ['View', 'v'],
      ['Insert', 'i'],
      ['Format', 'o'],
      ['Tools', 't'],
      ['Help', 'h'],
    ],
  );
  function checkEntries(entries, where) {
    const seen = new Set();
    for (const entry of entries) {
      if (isSeparator(entry)) {
        continue;
      }
      if (entry.accessKey.length === 0) {
        continue;
      }
      assert.equal(entry.accessKey.length, 1, `${where} ${entry.label}`);
      const key = entry.accessKey.toLowerCase();
      assert.equal(seen.has(key), false, `${where} reuses ${key} on ${entry.label}`);
      seen.add(key);
      assert.notEqual(
        accessKeyIndex(entry.label, entry.accessKey, entry.accessOccurrence ?? 0),
        -1,
        `${entry.label} has no ${entry.accessKey} to underline`,
      );
      if (entry.submenu !== undefined) {
        checkEntries(entry.submenu, `${where} ${entry.label}`);
      }
    }
  }
  const top = new Set();
  for (const menu of APP_MENUS) {
    const key = menu.accessKey.toLowerCase();
    assert.equal(top.has(key), false, key);
    top.add(key);
    assert.notEqual(accessKeyIndex(menu.label, menu.accessKey, menu.accessOccurrence ?? 0), -1, menu.label);
    checkEntries(menu.entries, menu.label);
  }
  const open = APP_MENUS[0].entries.find((entry) => !isSeparator(entry) && entry.id === 'file-open');
  assert.equal(accessibleName(open), 'Open… Ctrl+O');
  assert.equal(open.enabled, false);
  assert.equal(open.ellipsis, true);
  const settings = APP_MENUS.find((menu) => menu.id === 'tools').entries.find(
    (entry) => !isSeparator(entry) && entry.id === 'tools-settings',
  );
  assert.equal(accessibleName(settings), 'Settings Ctrl+comma');
  assert.equal(settings.enabled, true);
  assert.equal(settings.command, 'settings');
});

test('pointer hover clears the keyboard highlight and keeps one item current', async () => {
  const { APP_MENUS, pointerHoverItem, reduceMenuKey, initialMenuSession } = await menuModule();
  const opened = play(
    reduceMenuKey,
    APP_MENUS,
    [keydown('Alt'), keydown('f', { altKey: true }), keyup('f', { altKey: true }), keyup('Alt')],
    initialMenuSession(),
  ).session;
  assert.equal(opened.keyboard, true);
  assert.deepEqual(opened.panels, ['file-new']);
  const template = pointerHoverItem(APP_MENUS, opened, 'file-template');
  assert.equal(template.session.keyboard, false);
  assert.deepEqual(template.session.panels, ['file-template', null]);
  const moved = pointerHoverItem(APP_MENUS, template.session, 'file-close');
  assert.equal(moved.session.keyboard, false);
  assert.deepEqual(moved.session.panels, ['file-close']);
  const again = reduceMenuKey(APP_MENUS, moved.session, keydown('ArrowUp'));
  assert.equal(again.session.keyboard, true);
  assert.equal(again.session.panels.length, 1);
  assert.notEqual(again.session.panels[0], 'file-close');
});

test('the menu bar uses the raised surface, accent bar, and access-key underline', async () => {
  const css = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const focus = await readFile(path.join(root, 'src/renderer/styles/focus.css'), 'utf8');
  const tokens = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  assert.match(tokens, /--size-menu-accent:\s*3px/);
  assert.match(css, /\.menu-panel\s*\{[^}]*background:\s*var\(--color-surface-raised\)/);
  assert.match(css, /\.menu-panel\s*\{[^}]*border-radius:\s*var\(--radius-overlay\)/);
  assert.match(css, /\.menu-panel\s*\{[^}]*box-shadow:\s*var\(--shadow-menu\)/);
  assert.match(css, /\.menu-item\s*\{[^}]*padding:[^;]*var\(--size-menu-accent\)/);
  assert.match(
    css,
    /\.menu-bar\[data-input='keyboard'\] \.menu-item\[data-focused='true'\]\s*\{[^}]*background:\s*var\(--color-surface-raised-hover\)/,
  );
  assert.match(
    css,
    /\.menu-bar\[data-input='pointer'\] \.menu-item:not\(\[aria-disabled='true'\]\):hover\s*\{[^}]*box-shadow:\s*inset var\(--size-menu-accent\) 0 0 var\(--color-accent\)/,
  );
  assert.doesNotMatch(
    css,
    /\.menu-bar\[data-input='keyboard'\][^{]*::before\s*\{[^}]*background:\s*var\(--color-accent\)/,
  );
  assert.match(
    focus,
    /\.menu-bar\[data-input='keyboard'\] \.menu-item\[data-focused='true'\]\s*\{[^}]*box-shadow:\s*inset 0 0 0 var\(--size-focus-ring\) var\(--color-focus-outer\)/,
  );
  assert.match(
    focus,
    /\.menu-bar\[data-input='keyboard'\] \.menu-item\[data-focused='true'\]\s*\{[^}]*outline:\s*var\(--size-focus-ring\) solid var\(--color-focus-outer\)/,
  );
  assert.match(
    focus,
    /\.menu-bar\[data-input='keyboard'\] \.menu-item\[data-focused='true'\]\s*\{[^}]*outline-offset:\s*calc\(var\(--size-focus-ring\) \* -1\)/,
  );
  assert.match(focus, /\.menu-item:focus-visible\s*\{[^}]*outline:\s*none/);
  assert.doesNotMatch(focus, /--size-menu-accent/);
  assert.match(css, /\.menu-bar\[data-access-keys='true'\] \.menu-key\s*\{[^}]*text-decoration-line:\s*underline/);
  assert.match(css, /\.menu-bar\s*\{[^}]*height:\s*var\(--size-menubar\)/);
  assert.match(css, /\.menu-shortcut\s*\{[^}]*color:\s*var\(--color-text-secondary\)/);
});
