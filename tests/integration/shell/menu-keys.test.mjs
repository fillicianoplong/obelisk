import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const menu = document.querySelector('[role="menubar"]');
  if (!editor || !menu || editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

const SNAPSHOT = `(() => {
  const bar = document.querySelector('[data-region="menu-bar"]');
  const active = document.activeElement;
  const item = (selector) => {
    const node = document.querySelector(selector);
    if (!node) {
      return null;
    }
    return {
      id: node.id,
      role: node.getAttribute('role'),
      label: node.getAttribute('aria-label'),
      disabled: node.getAttribute('aria-disabled'),
      expanded: node.getAttribute('aria-expanded'),
    };
  };
  return {
    accessKeys: bar ? bar.getAttribute('data-access-keys') : null,
    barRole: bar ? bar.getAttribute('role') : null,
    activeId: active && active.id ? active.id : null,
    activeRegion: active && active.getAttribute ? active.getAttribute('data-region') : null,
    activeEditable: active && active.getAttribute ? active.getAttribute('contenteditable') : null,
    keys: [...document.querySelectorAll('.menu-button .menu-key')].map((node) => ({
      text: node.textContent,
      underline: getComputedStyle(node).textDecorationLine,
    })),
    panels: [...document.querySelectorAll('[role="menu"]')].map((node) => ({
      id: node.id,
      label: node.getAttribute('aria-label'),
    })),
    focused: item('.menu-item[data-focused="true"]'),
    openItem: item('[data-item="file-open"]'),
    saveItem: item('[data-item="file-save"]'),
    saveAsItem: item('[data-item="file-save-as"]'),
    exportItem: item('[data-item="file-export"]'),
    pdf: item('[data-item="file-export-pdf"]'),
    spelling: item('[data-item="tools-spelling"]'),
    settings: item('[data-item="tools-settings"]'),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({
      title: node.getAttribute('data-title'),
      selected: node.getAttribute('aria-selected'),
    })),
    settingsPage: document.querySelector('[data-page="settings"]') !== null,
  };
})()`;

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function readMenu(client) {
  return evaluate(client, SNAPSHOT);
}

async function waitForMenu(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await readMenu(client);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  const event = {
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

async function pressChord(client, key, code, virtualKey) {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Alt',
    code: 'AltLeft',
    windowsVirtualKeyCode: 18,
    nativeVirtualKeyCode: 18,
    modifiers: 1,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers: 1,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers: 1,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Alt',
    code: 'AltLeft',
    windowsVirtualKeyCode: 18,
    nativeVirtualKeyCode: 18,
    modifiers: 0,
  });
}

async function clickPage(client) {
  const point = await evaluate(
    client,
    `(() => {
      const rect = document.querySelector('[data-region="page-editor"]').getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + Math.min(48, rect.height / 2)),
      };
    })()`,
  );
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

test('the menu bar opens File and Settings from the keyboard', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-menu-keys-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);

  const binary = electronBinary();
  const port = await freePort();
  session.child = await launchWithSandboxFallback({
    binary,
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') {
            return null;
          }
          const client = await openPage(port, session);
          return evaluate(client, READY);
        },
        20_000,
      );
    },
  });
  const client = await openPage(port, session);
  await clickPage(client);
  await waitForMenu(client, (state) => state.activeRegion === 'page-editor', 'the page has focus');

  await pressKey(client, 'Alt', 'AltLeft', 18, 1);
  const bar = await waitForMenu(
    client,
    (state) => state.accessKeys === 'true' && state.activeId === 'menu-top-file',
    'Alt focuses the menu bar',
  );
  assert.equal(bar.barRole, 'menubar');
  assert.deepEqual(
    bar.keys.map((entry) => entry.text),
    ['F', 'E', 'V', 'I', 'o', 'T', 'H'],
  );
  assert.equal(bar.keys.every((entry) => entry.underline === 'underline'), true, JSON.stringify(bar.keys));
  assert.equal(bar.panels.length, 0);

  await pressKey(client, 'Escape', 'Escape', 27);
  const restored = await waitForMenu(
    client,
    (state) => state.activeRegion === 'page-editor' && state.accessKeys === 'false',
    'Esc returns to the page',
  );
  assert.equal(restored.panels.length, 0);

  await pressKey(client, 'F10', 'F10', 121);
  await waitForMenu(
    client,
    (state) => state.activeId === 'menu-top-file' && state.accessKeys === 'true',
    'F10 focuses the menu bar',
  );
  await pressKey(client, 'F10', 'F10', 121);
  await waitForMenu(
    client,
    (state) => state.activeRegion === 'page-editor' && state.accessKeys === 'false',
    'a second F10 leaves the menu bar',
  );

  await pressChord(client, 'f', 'KeyF', 70);
  const file = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-new',
    'Alt+F opens File on New',
  );
  assert.equal(file.panels.length, 1);
  assert.equal(file.panels[0].label, 'File');
  assert.equal(file.focused.role, 'menuitem');
  assert.equal(file.focused.label, 'New Ctrl+N');
  assert.equal(file.focused.disabled, null);
  assert.equal(file.openItem.role, 'menuitem');
  assert.equal(file.openItem.label, 'Open… Ctrl+O');
  assert.equal(file.openItem.disabled, null);

  await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
  await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
  const openItem = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-open',
    'Down lands on Open',
  );
  assert.equal(openItem.openItem.disabled, null);

  await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
  const saveItem = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-save',
    'Down lands on Save',
  );
  assert.equal(saveItem.saveItem.disabled, null);
  assert.equal(saveItem.saveItem.label, 'Save Ctrl+S');

  await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
  const saveAsItem = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-save-as',
    'Down lands on Save as',
  );
  assert.equal(saveAsItem.saveAsItem.disabled, null);
  assert.equal(saveAsItem.saveAsItem.label, 'Save as… Ctrl+Shift+S');

  await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
  const exportItem = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-export',
    'Down skips Print and lands on Export',
  );
  assert.equal(exportItem.exportItem.expanded, 'false');

  await pressKey(client, 'ArrowRight', 'ArrowRight', 39);
  const submenu = await waitForMenu(
    client,
    (state) =>
      state.panels.some((panel) => panel.id === 'menu-panel-file-export') &&
      state.activeId === 'menu-panel-file-export',
    'Right opens the Export submenu',
  );
  assert.equal(submenu.pdf.disabled, 'true');
  assert.equal(submenu.pdf.label, 'PDF…');

  await pressKey(client, 'ArrowLeft', 'ArrowLeft', 37);
  await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-file-export' && state.panels.length === 1,
    'Left closes the Export submenu',
  );

  await pressKey(client, 'Home', 'Home', 36);
  await waitForMenu(client, (state) => state.focused?.id === 'menu-item-file-new', 'Home returns to New');
  await pressKey(client, 'Enter', 'Enter', 13);
  const created = await waitForMenu(
    client,
    (state) => state.tabs.some((tab) => tab.title === 'Untitled 2' && tab.selected === 'true'),
    'Enter on New opens a tab',
  );
  assert.equal(created.panels.length, 0);
  assert.equal(created.accessKeys, 'false');
  assert.equal(created.activeRegion, 'page-editor');

  await pressChord(client, 't', 'KeyT', 84);
  const tools = await waitForMenu(
    client,
    (state) => state.focused?.id === 'menu-item-tools-settings',
    'Alt+T opens Tools on Settings',
  );
  assert.equal(tools.settings.role, 'menuitem');
  assert.equal(tools.settings.label, 'Settings Ctrl+comma');
  assert.equal(tools.settings.disabled, null);
  assert.equal(tools.spelling.role, 'menuitem');
  assert.equal(tools.spelling.disabled, 'true');

  await pressKey(client, 'Enter', 'Enter', 13);
  const settings = await waitForMenu(
    client,
    (state) => state.settingsPage && state.tabs.some((tab) => tab.title === 'Settings' && tab.selected === 'true'),
    'Enter on Settings opens the Settings tab',
  );
  assert.equal(settings.panels.length, 0);
});

const HOVER_PROBE = `(() => {
  const swatch = document.createElement('span');
  swatch.style.backgroundColor = 'var(--color-surface-raised-hover)';
  document.body.appendChild(swatch);
  const fill = getComputedStyle(swatch).backgroundColor;
  swatch.style.backgroundColor = 'var(--color-accent)';
  const accent = getComputedStyle(swatch).backgroundColor;
  swatch.remove();
  const rows = [...document.querySelectorAll('.menu-item')].map((node) => {
    const style = getComputedStyle(node);
    const before = getComputedStyle(node, '::before');
    const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    return {
      id: node.getAttribute('data-item'),
      fill: style.backgroundColor === fill,
      ring,
      hovered: node.matches(':hover'),
      focusVisible: node.matches(':focus-visible'),
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      borderTop: style.borderTopWidth,
      borderRight: style.borderRightWidth,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      shadow: style.boxShadow,
      before: before.backgroundColor,
      accent,
    };
  });
  const bar = document.querySelector('[data-region="menu-bar"]');
  return {
    input: bar ? bar.getAttribute('data-input') : null,
    highlighted: rows.filter((row) => row.fill).map((row) => row.id),
    rings: rows.filter((row) => row.ring || row.focusVisible).map((row) => row.id),
    rows,
  };
})()`;

async function launchMenu(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-menu-hover-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') {
            return null;
          }
          const client = await openPage(port, session);
          return evaluate(client, READY);
        },
        20_000,
      );
    },
  });
  return openPage(port, session);
}

async function pointOf(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${selector} is not on screen`);
  return point;
}

async function hoverSelector(client, selector) {
  const point = await pointOf(client, selector);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
}

async function readHover(client) {
  return evaluate(client, HOVER_PROBE);
}

async function waitForHover(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await readHover(client);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

function assertPointerHighlight(state, id) {
  assert.deepEqual(state.highlighted, [id], JSON.stringify(state));
  assert.deepEqual(state.rings, [], JSON.stringify(state));
  assert.equal(state.input, 'pointer', JSON.stringify(state));
  const row = state.rows.find((item) => item.id === id);
  assert.equal(row.focusVisible, false, JSON.stringify(row));
  assert.match(row.shadow, /3px 0px 0px 0px inset/, JSON.stringify(row));
  assert.equal(row.before, 'rgba(0, 0, 0, 0)', JSON.stringify(row));
}

function assertKeyboardRing(state, id) {
  assert.deepEqual(state.highlighted, [id], JSON.stringify(state));
  assert.deepEqual(state.rings, [id], JSON.stringify(state));
  assert.equal(state.input, 'keyboard', JSON.stringify(state));
  const row = state.rows.find((item) => item.id === id);
  const width = parseFloat(row.outlineWidth);
  const offset = parseFloat(row.outlineOffset);
  assert.ok(width > 0, JSON.stringify(row));
  // Fully inside the item, so a neighbour cannot clip one side of the ring.
  assert.ok(Math.abs(width + offset) < 0.25, JSON.stringify(row));
  assert.equal(row.borderTop, row.borderRight, JSON.stringify(row));
  assert.equal(row.borderRight, row.borderBottom, JSON.stringify(row));
  assert.equal(row.borderBottom, row.borderLeft, JSON.stringify(row));
  assert.equal(row.borderLeft, '0px', JSON.stringify(row));
  assert.match(row.shadow, /0px 0px 0px 2px inset/, JSON.stringify(row));
  assert.doesNotMatch(row.shadow, /3px 0px 0px 0px inset/, JSON.stringify(row));
  assert.equal(row.before, 'rgba(0, 0, 0, 0)', JSON.stringify(row));
  assert.notEqual(row.before, row.accent, JSON.stringify(row));
}

test('pointer hover does not show the focus ring, and only one item stays highlighted', { timeout: 60_000 }, async (t) => {
  const client = await launchMenu(t);
  await evaluate(client, `document.querySelector('[data-menu="file"]').click()`);
  await waitForMenu(client, (state) => state.panels.some((panel) => panel.id === 'menu-panel-file'), 'File is open');

  await hoverSelector(client, '[data-item="file-new"]');
  const hoveredNew = await waitForHover(
    client,
    (state) => state.highlighted.length === 1 && state.highlighted[0] === 'file-new',
    'hovering New highlights New',
  );
  assertPointerHighlight(hoveredNew, 'file-new');

  await hoverSelector(client, '[data-item="file-template"]');
  const hoveredTemplate = await waitForHover(
    client,
    (state) => state.highlighted.length === 1 && state.highlighted[0] === 'file-template',
    'moving the pointer clears New',
  );
  assertPointerHighlight(hoveredTemplate, 'file-template');
  assert.equal(hoveredTemplate.highlighted.includes('file-new'), false);

  await pressKey(client, 'ArrowLeft', 'ArrowLeft', 37);
  const keyed = await waitForHover(
    client,
    (state) => state.input === 'keyboard' && state.highlighted.length === 1,
    'the keyboard leaves one highlighted item',
  );
  const keyedRow = keyed.rows.find((item) => item.id === keyed.highlighted[0]);
  assert.equal(keyedRow.hovered, true, JSON.stringify(keyedRow));
  assertKeyboardRing(keyed, keyed.highlighted[0]);

  await hoverSelector(client, '[data-item="file-close"]');
  const hoveredAgain = await waitForHover(
    client,
    (state) => state.input === 'pointer' && state.highlighted.length === 1 && state.highlighted[0] === 'file-close',
    'the pointer after the keyboard leaves one highlighted item',
  );
  assertPointerHighlight(hoveredAgain, 'file-close');
});
