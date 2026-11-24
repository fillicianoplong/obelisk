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
  if (!editor || editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  return document.documentElement.dataset.shellCommands === 'ready' ? true : null;
})()`;

const LINES = 'First line here\\nSecond line here\\nThird line here\\nFourth line here\\nFifth line here';

const STATE = `(() => {
  const gutter = document.querySelector('.block-handle');
  const menu = document.querySelector('.block-menu');
  const context = document.querySelector('[data-region="context-menu"]');
  const rect = gutter ? gutter.getBoundingClientRect() : null;
  const blocks = [...document.querySelectorAll('[data-region="page-editor"] > p')];
  const top = rect ? Math.round(rect.top) : null;
  const gutterBlock = rect ? blocks.findIndex((block) => {
    const box = block.getBoundingClientRect();
    return Math.abs(box.top - rect.top) < 2;
  }) : -1;
  const selection = getSelection();
  return {
    gutterShown: gutter !== null && !gutter.hidden && rect.height > 0,
    gutterBlock,
    gutterTop: top,
    menuOpen: menu !== null && menu.isConnected && !menu.hidden,
    menuOpenMark: gutter?.getAttribute('data-menu-open') ?? null,
    contextKind: context ? context.getAttribute('data-context-kind') : null,
    activeIsEditor: document.activeElement === document.querySelector('[data-region="page-editor"]'),
    selectionType: selection.type,
    caretText: selection.anchorNode ? selection.anchorNode.textContent : null,
  };
})()`;

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-block-menus-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  const openPage = async () => {
    const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    assert.ok(page, 'the page has no DevTools socket');
    if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
      session.client?.close();
      session.client = openCdp(page.webSocketDebuggerUrl);
    }
    return session.client;
  };
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
          return evaluate(await openPage(), READY);
        },
        20_000,
      );
    },
  });
  const client = await openPage();
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.focus();
    editor.editorCommands.replaceText('${LINES}');
  })()`);
  await sleep(150);
  return { client };
}

function mouse(client, type, point, button = 'none') {
  return client.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button,
    clickCount: button === 'none' ? 0 : 1,
  });
}

async function click(client, point, button = 'left') {
  await mouse(client, 'mouseMoved', point);
  await mouse(client, 'mousePressed', point, button);
  await mouse(client, 'mouseReleased', point, button);
  await sleep(150);
}

async function glide(client, from, to, steps = 12) {
  for (let step = 1; step <= steps; step += 1) {
    await mouse(client, 'mouseMoved', {
      x: Math.round(from.x + ((to.x - from.x) * step) / steps),
      y: Math.round(from.y + ((to.y - from.y) * step) / steps),
    });
    await sleep(15);
  }
  await sleep(100);
}

async function key(client, name, code, virtualKey) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey });
  await sleep(120);
}

function linePoint(client, index, dx = 20) {
  return evaluate(client, `(() => {
    const block = document.querySelectorAll('[data-region="page-editor"] > p')[${index}];
    const rect = block.getBoundingClientRect();
    return { x: Math.round(rect.left + ${dx}), y: Math.round(rect.top + rect.height / 2) };
  })()`);
}

function centerOf(client, selector) {
  return evaluate(client, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
  })()`);
}

async function waitState(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, STATE);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function poll(check, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not appear within ${STEP_TIMEOUT_MS} ms`);
}

async function openGripMenu(client, line = 0) {
  const point = await linePoint(client, line);
  await mouse(client, 'mouseMoved', point);
  await waitState(client, (state) => state.gutterShown && state.gutterBlock === line, 'gutter on the line');
  const grip = await centerOf(client, '.block-gutter-grip');
  await glide(client, point, grip, 6);
  await click(client, grip);
  await waitState(client, (state) => state.menuOpen, 'grip menu open');
  return grip;
}

test('grip Copy then grip Paste puts the block text on the next line', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openGripMenu(client, 0);
  const copy = await centerOf(client, '.block-menu [data-action="edit-copy"]');
  assert.ok(copy, 'Copy is in the grip menu');
  await click(client, copy);
  await waitState(client, (state) => !state.menuOpen, 'copy closes the grip menu');
  await openGripMenu(client, 1);
  const paste = await centerOf(client, '.block-menu [data-action="edit-paste"]');
  assert.ok(paste, 'Paste is in the grip menu');
  await click(client, paste);
  const lines = await poll(async () => {
    const text = await evaluate(client, `(() => {
      return [...document.querySelectorAll('[data-region="page-editor"] > p')].map((node) => node.textContent);
    })()`);
    return text[1] === 'First line here' ? text : null;
  }, 'grip Paste replaces the next line');
  assert.equal(lines[0], 'First line here');
  assert.equal(lines[1], 'First line here');
});

test('the add and grip controls stay on their block while the grip menu is open', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const grip = await openGripMenu(client, 0);
  const opened = await evaluate(client, STATE);
  assert.equal(opened.menuOpenMark, 'true');
  assert.equal(await evaluate(client, `document.querySelector('.block-gutter-grip').getAttribute('aria-expanded')`), 'true');
  // The pointer crosses the other lines on its way into the menu.
  const below = await linePoint(client, 3, 200);
  await glide(client, grip, below);
  const menu = await centerOf(client, '.block-menu');
  await glide(client, below, menu);
  const state = await evaluate(client, STATE);
  assert.equal(state.menuOpen, true);
  assert.equal(state.gutterShown, true);
  assert.equal(state.gutterBlock, 0, 'the controls did not follow the pointer');
  assert.equal(state.gutterTop, opened.gutterTop);
});

test('a click outside the grip menu closes it, wherever it lands', { timeout: 90_000 }, async (t) => {
  const { client } = await launchApp(t);
  const places = [
    ['text below the menu', async () => {
      const menu = await centerOf(client, '.block-menu');
      const line = await linePoint(client, 4);
      return { x: menu.right + 40, y: line.y };
    }],
    ['empty page margin', async () => ({ x: 6, y: 300 })],
    ['menu bar', async () => {
      const bar = await centerOf(client, '[role="menubar"]');
      return { x: 12, y: bar.y };
    }],
    ['status bar', async () => centerOf(client, '[data-region="status-bar"]')],
  ];
  for (const [label, where] of places) {
    await openGripMenu(client, 0);
    const point = await where();
    assert.ok(point, label);
    await click(client, point);
    await waitState(client, (state) => !state.menuOpen, `closes on ${label}`);
    await key(client, 'Escape', 'Escape', 27);
  }
});

test('one outside click closes both the grip menu and a right-click menu over it', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const grip = await openGripMenu(client, 0);
  await click(client, grip, 'right');
  const both = await waitState(client, (state) => state.contextKind === 'block', 'block context menu');
  assert.equal(both.menuOpen, false, 'the grip menu closes when the context menu opens');
  const line = await linePoint(client, 4, 400);
  await click(client, line);
  await waitState(client, (state) => !state.menuOpen && state.contextKind === null, 'everything closed');
});

test('a second click on the grip closes its menu', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const grip = await openGripMenu(client, 0);
  await click(client, grip);
  await waitState(client, (state) => !state.menuOpen && state.menuOpenMark === null, 'closed by the grip');
});

test('Esc closes the grip menu and puts the caret back in the block text', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openGripMenu(client, 1);
  await key(client, 'Escape', 'Escape', 27);
  const state = await waitState(client, (snap) => !snap.menuOpen, 'menu closed');
  assert.equal(state.activeIsEditor, true);
  assert.equal(state.selectionType, 'Caret');
  assert.equal(state.caretText, 'Second line here');
});

test('the controls stay on the block while its right-click menu is open', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const point = await linePoint(client, 2);
  await mouse(client, 'mouseMoved', point);
  await waitState(client, (state) => state.gutterShown && state.gutterBlock === 2, 'gutter on line 3');
  const grip = await centerOf(client, '.block-gutter-grip');
  await glide(client, point, grip, 6);
  await click(client, grip, 'right');
  await waitState(client, (state) => state.contextKind === 'block', 'block context menu');
  const panel = await centerOf(client, '[data-region="context-menu"] .menu-panel--root');
  await glide(client, grip, panel);
  const open = await evaluate(client, STATE);
  assert.equal(open.gutterShown, true);
  assert.equal(open.gutterBlock, 2);
  // Hovering the panel can open a submenu, which Esc closes first.
  for (let press = 0; press < 3; press += 1) {
    await key(client, 'Escape', 'Escape', 27);
    await sleep(80);
    if ((await evaluate(client, STATE)).contextKind === null) {
      break;
    }
  }
  await waitState(client, (state) => state.contextKind === null && state.menuOpenMark === null, 'context menu closed');
  const after = await linePoint(client, 4);
  await mouse(client, 'mouseMoved', after);
  await waitState(client, (state) => state.gutterBlock === 4, 'hover follows the pointer again');
});

test('the slash menu Link item opens the Link dialog with the standard field focus', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.focus();
    editor.editorCommands.replaceText('');
  })()`);
  await client.send('Input.insertText', { text: '/' });
  await sleep(100);
  await client.send('Input.insertText', { text: 'link' });
  await sleep(150);
  await key(client, 'Enter', 'Enter', 13);
  const dialog = await poll(
    () => evaluate(client, `(() => {
      const field = document.querySelector('.link-dialog [data-link-text]');
      if (!field || document.activeElement !== field) {
        return null;
      }
      const style = getComputedStyle(field);
      const search = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
      return { outline: style.outlineStyle, border: style.borderTopColor, accent: search.trim(), text: document.querySelector('[data-region="page-editor"]').textContent };
    })()`),
    'Link dialog with the Text field focused',
  );
  assert.equal(dialog.outline, 'none', 'no browser focus ring on the field');
  assert.equal(dialog.text, '', 'the typed /link is removed');
  await key(client, 'Tab', 'Tab', 9);
  const address = await evaluate(client, `(() => {
    const field = document.querySelector('.link-dialog [data-link-address]');
    return document.activeElement === field ? getComputedStyle(field).outlineStyle : null;
  })()`);
  assert.equal(address, 'none', 'the Address field matches');
});

const SLASH = `(() => {
  const host = document.querySelector('.slash-menu-host');
  const gutter = document.querySelector('.block-handle');
  const rect = gutter ? gutter.getBoundingClientRect() : null;
  const blocks = [...document.querySelectorAll('[data-region="page-editor"] > *')];
  const add = document.querySelector('.block-gutter-add');
  return {
    open: host?.dataset.open === 'true',
    texts: blocks.map((block) => block.textContent),
    gutterShown: gutter !== null && !gutter.hidden && rect.height > 0,
    gutterBlock: rect ? blocks.findIndex((block) => Math.abs(block.getBoundingClientRect().top - rect.top) < 2) : -1,
    menuControl: gutter?.getAttribute('data-menu-control') ?? null,
    addFill: add ? getComputedStyle(add).backgroundColor : null,
  };
})()`;

async function slashState(client) {
  return evaluate(client, SLASH);
}

async function waitSlash(client, predicate, label) {
  return poll(async () => {
    const state = await slashState(client);
    return predicate(state) ? state : null;
  }, label);
}

/** Types / on a new empty last line so the typed slash menu opens there. */
async function openTypedSlashMenu(client) {
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.focus();
  })()`);
  const end = await linePoint(client, 4, 400);
  await click(client, end);
  await key(client, 'End', 'End', 35);
  await key(client, 'Enter', 'Enter', 13);
  await client.send('Input.insertText', { text: '/' });
  return waitSlash(client, (state) => state.open, 'typed slash menu open');
}

async function clickAddOnLine(client, line) {
  const point = await linePoint(client, line);
  await mouse(client, 'mouseMoved', point);
  await waitState(client, (state) => state.gutterShown && state.gutterBlock === line, `gutter on line ${line + 1}`);
  const add = await centerOf(client, '.block-gutter-add');
  await glide(client, point, add, 6);
  await click(client, add);
  return add;
}

test('a click or right-click outside the slash menu closes it, wherever it lands', { timeout: 120_000 }, async (t) => {
  const { client } = await launchApp(t);
  const places = [
    ['text on another line', 'left', async () => linePoint(client, 1, 30)],
    ['empty page margin', 'left', async () => ({ x: 6, y: 300 })],
    ['menu bar', 'left', async () => {
      const bar = await centerOf(client, '[role="menubar"]');
      return { x: 12, y: bar.y };
    }],
    ['status bar', 'left', async () => centerOf(client, '[data-region="status-bar"]')],
    ['right-click on another line', 'right', async () => linePoint(client, 0, 30)],
  ];
  for (const [label, button, where] of places) {
    await openTypedSlashMenu(client);
    const point = await where();
    assert.ok(point, label);
    await click(client, point, button);
    await waitSlash(client, (state) => !state.open, `slash menu closes on ${label}`);
    await key(client, 'Escape', 'Escape', 27);
    await key(client, 'Escape', 'Escape', 27);
  }
  await openTypedSlashMenu(client);
  await evaluate(client, `window.dispatchEvent(new Event('blur'))`);
  await waitSlash(client, (state) => !state.open, 'slash menu closes when the window loses focus');
});

test('+ opens the slash menu on an empty paragraph without typing a slash', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await clickAddOnLine(client, 1);
  const open = await waitSlash(client, (state) => state.open, 'slash menu from +');
  assert.equal(open.texts[2], '', 'no / in the new paragraph');
  assert.equal(open.texts.length, 6);
  await key(client, 'Escape', 'Escape', 27);
  const closed = await waitSlash(client, (state) => !state.open, 'Esc closes it');
  assert.equal(closed.texts[2], '', 'Esc leaves an empty paragraph');
  assert.equal(closed.texts.length, 6);
});

test('the add and grip controls stay on the new block while the slash menu from + is open', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const add = await clickAddOnLine(client, 1);
  const open = await waitSlash(client, (state) => state.open && state.gutterShown, 'controls with the slash menu');
  assert.equal(open.gutterBlock, 2, 'the controls move to the new paragraph');
  assert.equal(open.menuControl, 'add', '+ keeps its pressed look');
  assert.notEqual(open.addFill, 'rgba(0, 0, 0, 0)');
  // The pointer crosses other lines on its way into the menu.
  const far = await linePoint(client, 5, 200);
  await glide(client, add, far);
  const panel = await centerOf(client, '.slash-menu-panel');
  await glide(client, far, panel);
  const during = await slashState(client);
  assert.equal(during.open, true);
  assert.equal(during.gutterShown, true);
  assert.equal(during.gutterBlock, 2, 'the controls did not follow the pointer');
  // Typing to filter keeps them too.
  await client.send('Input.insertText', { text: 'he' });
  await sleep(150);
  const typed = await slashState(client);
  assert.equal(typed.open, true);
  assert.equal(typed.gutterBlock, 2);
  await key(client, 'Escape', 'Escape', 27);
  await waitSlash(client, (state) => !state.open && state.menuControl === null, 'released on close');
  const after = await linePoint(client, 4);
  await mouse(client, 'mouseMoved', after);
  await waitState(client, (state) => state.gutterBlock === 4, 'hover follows the pointer again');
});

test('the controls stay on the block while a right-click menu on its text is open', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const point = await linePoint(client, 1);
  await mouse(client, 'mouseMoved', point);
  await waitState(client, (state) => state.gutterShown && state.gutterBlock === 1, 'gutter on line 2');
  await click(client, point, 'right');
  await waitState(client, (state) => state.contextKind === 'text', 'text context menu');
  const panel = await centerOf(client, '[data-region="context-menu"] .menu-panel--root');
  await glide(client, point, panel);
  const open = await evaluate(client, STATE);
  assert.equal(open.gutterShown, true);
  assert.equal(open.gutterBlock, 1);
  assert.equal(open.menuOpenMark, null, 'a text menu does not press the grip');
  for (let press = 0; press < 3; press += 1) {
    await key(client, 'Escape', 'Escape', 27);
    await sleep(80);
    if ((await evaluate(client, STATE)).contextKind === null) {
      break;
    }
  }
  await waitState(client, (state) => state.contextKind === null, 'context menu closed');
  const after = await linePoint(client, 4);
  await mouse(client, 'mouseMoved', after);
  await waitState(client, (state) => state.gutterBlock === 4, 'hover follows the pointer again');
});
