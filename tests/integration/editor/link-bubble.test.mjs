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

const ADDRESS = 'https://docs.blender.org/manual/en/latest/getting_started/installing/windows.html';
const LINK_TEXT = 'Blender manual';

/** Sets up three lines with a link on the second, and records Open link requests instead of opening the browser. */
const SETUP = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  editor.focus();
  editor.editorCommands.replaceText('Install notes\\nDownload it from the ${LINK_TEXT} and run it.\\nThen pick a theme.');
  const view = editor.editorView;
  const start = view.state.doc.child(0).nodeSize;
  const text = view.state.doc.child(1).textContent;
  const from = start + 1 + text.indexOf('${LINK_TEXT}');
  const mark = view.state.schema.marks.link.create({ address: ${JSON.stringify(ADDRESS)} });
  view.dispatch(view.state.tr.addMark(from, from + ${LINK_TEXT.length}, mark));
  window.__linkOpens = [];
  // Capture runs before the shell's listener, so tests see the request and nothing opens.
  window.addEventListener('obelisk:editor-shell-command', (event) => {
    if (event.detail && event.detail.command === 'link-open') {
      window.__linkOpens.push(event.detail.address ?? null);
      event.stopImmediatePropagation();
    }
  }, true);
  return true;
})()`;

const STATE = `(() => {
  const bubble = document.querySelector('[data-region="link-bubble"]');
  const link = document.querySelector('[data-region="page-editor"] a.editor-link');
  const tooltip = document.querySelector('.link-bubble-tooltip');
  const active = document.activeElement;
  const selection = getSelection();
  const open = bubble !== null && !bubble.hidden;
  const box = open ? bubble.getBoundingClientRect() : null;
  const linkBox = link ? link.getBoundingClientRect() : null;
  return {
    open,
    address: open ? bubble.querySelector('.link-bubble-address-text').textContent : null,
    top: box ? Math.round(box.top) : null,
    left: box ? Math.round(box.left) : null,
    linkBottom: linkBox ? Math.round(linkBox.bottom) : null,
    linkLeft: linkBox ? Math.round(linkBox.left) : null,
    hasLink: link !== null,
    lines: [...document.querySelectorAll('[data-region="page-editor"] > p')].map((p) => p.textContent),
    focusControl: active && active.dataset ? active.dataset.control ?? null : null,
    activeIsEditor: active === document.querySelector('[data-region="page-editor"]'),
    caretInLink: selection.anchorNode ? selection.anchorNode.parentElement?.closest('a.editor-link') !== null : false,
    tooltip: tooltip && !tooltip.hidden ? tooltip.textContent : null,
    opens: window.__linkOpens ?? [],
    dialog: (() => {
      const dialog = document.querySelector('.link-dialog');
      if (!dialog) {
        return null;
      }
      return {
        text: dialog.querySelector('[data-link-text]')?.value ?? null,
        address: dialog.querySelector('[data-link-address]')?.value ?? null,
      };
    })(),
  };
})()`;

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-link-bubble-'));
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
  await evaluate(client, SETUP);
  await sleep(150);
  return { client };
}

function mouse(client, type, point, button = 'none', modifiers = 0) {
  return client.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button,
    modifiers,
    clickCount: button === 'none' ? 0 : 1,
  });
}

async function click(client, point, { button = 'left', modifiers = 0 } = {}) {
  await mouse(client, 'mouseMoved', point, 'none', modifiers);
  await mouse(client, 'mousePressed', point, button, modifiers);
  await mouse(client, 'mouseReleased', point, button, modifiers);
  await sleep(150);
}

async function key(client, name, code, virtualKey, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await sleep(120);
}

function centerOf(client, selector) {
  return evaluate(client, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
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

async function openBubbleByClick(client, label = 'bubble open after a click') {
  const link = await centerOf(client, '[data-region="page-editor"] a.editor-link');
  assert.ok(link, 'the link is on the page');
  // Two quick clicks in the same place are a double-click, which selects a word instead.
  await sleep(600);
  await click(client, link);
  return waitState(client, (state) => state.open, label);
}

test('a plain click on a link shows the bubble under it, and opens nothing', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const state = await openBubbleByClick(client);
  assert.equal(state.address, 'docs.blender.org/…/windows.html');
  assert.ok(state.top >= state.linkBottom && state.top <= state.linkBottom + 8, `bubble sits under the link: ${JSON.stringify(state)}`);
  assert.ok(Math.abs(state.left - state.linkLeft) <= 1, 'bubble lines up with the link');
  assert.equal(state.activeIsEditor, true, 'focus stays in the text');
  assert.equal(state.caretInLink, true, 'the caret goes where I clicked');
  assert.deepEqual(state.opens, [], 'a plain click does not open the link');
  // Hovering the address shows the full address.
  const address = await centerOf(client, '.link-bubble-address');
  await mouse(client, 'mouseMoved', address);
  await waitState(client, (snap) => snap.tooltip === ADDRESS, 'full address tooltip');
});

test('Open and the address both open the full address right away', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openBubbleByClick(client);
  await click(client, await centerOf(client, '.link-bubble-button[data-control="open"]'));
  const afterOpen = await waitState(client, (state) => !state.open && state.opens.length === 1, 'Open closes and asks');
  assert.deepEqual(afterOpen.opens, [ADDRESS]);
  assert.equal(afterOpen.activeIsEditor, true);
  await openBubbleByClick(client);
  await click(client, await centerOf(client, '.link-bubble-address'));
  const afterAddress = await waitState(client, (state) => !state.open && state.opens.length === 2, 'address click asks');
  assert.deepEqual(afterAddress.opens, [ADDRESS, ADDRESS]);
});

test('Edit opens the Ctrl+K dialog filled in for the link', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openBubbleByClick(client);
  await click(client, await centerOf(client, '.link-bubble-button[data-control="edit"]'));
  const state = await waitState(client, (snap) => snap.dialog !== null, 'link dialog');
  assert.equal(state.open, false);
  assert.deepEqual(state.dialog, { text: LINK_TEXT, address: ADDRESS });
});

test('Remove unlinks and keeps the text', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openBubbleByClick(client);
  await click(client, await centerOf(client, '.link-bubble-button[data-control="remove"]'));
  const state = await waitState(client, (snap) => !snap.open && !snap.hasLink, 'link removed');
  assert.equal(state.lines[1], `Download it from the ${LINK_TEXT} and run it.`);
  assert.equal(state.activeIsEditor, true);
});

test('Esc, an outside click, and typing each close the bubble', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await openBubbleByClick(client, 'bubble open after click 1');
  await key(client, 'Escape', 'Escape', 27);
  const afterEsc = await waitState(client, (state) => !state.open, 'Esc closes');
  assert.equal(afterEsc.caretInLink, true, 'Esc leaves the caret in the text');
  assert.equal(afterEsc.activeIsEditor, true);

  await openBubbleByClick(client, 'bubble open after click 2');
  await click(client, await centerOf(client, '[data-region="status-bar"]'));
  await waitState(client, (state) => !state.open, 'status bar click closes');

  await openBubbleByClick(client, 'bubble open after click 3');
  await click(client, { x: 6, y: 300 });
  await waitState(client, (state) => !state.open, 'margin click closes');

  await openBubbleByClick(client);
  await client.send('Input.insertText', { text: 'x' });
  await waitState(client, (state) => !state.open, 'typing closes');
  assert.deepEqual((await evaluate(client, STATE)).opens, []);
});

test('Ctrl+click opens the link right away with no bubble', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const link = await centerOf(client, '[data-region="page-editor"] a.editor-link');
  await click(client, link, { modifiers: 2 });
  const state = await waitState(client, (snap) => snap.opens.length === 1, 'Ctrl+click asks to open');
  assert.deepEqual(state.opens, [ADDRESS]);
  await sleep(150);
  assert.equal((await evaluate(client, STATE)).open, false);
});

test('Alt+Enter on a link opens the bubble with keyboard focus, and Tab moves through it', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    const view = editor.editorView;
    const start = view.state.doc.child(0).nodeSize;
    const text = view.state.doc.child(1).textContent;
    const pos = start + 1 + text.indexOf('${LINK_TEXT}') + 3;
    view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, pos)));
    view.focus();
  })()`);
  await sleep(100);
  await key(client, 'Enter', 'Enter', 13, 1);
  const opened = await waitState(client, (state) => state.open && state.focusControl === 'open', 'focus on Open');
  assert.equal(opened.tooltip, 'Open link');
  const ring = await evaluate(client, `getComputedStyle(document.activeElement).outlineStyle`);
  assert.equal(ring, 'solid', 'keyboard focus shows the ring');
  await key(client, 'Tab', 'Tab', 9);
  assert.equal((await evaluate(client, STATE)).focusControl, 'edit');
  await key(client, 'Tab', 'Tab', 9);
  assert.equal((await evaluate(client, STATE)).focusControl, 'remove');
  await key(client, 'Tab', 'Tab', 9);
  assert.equal((await evaluate(client, STATE)).focusControl, 'address', 'Tab wraps to the address');
  await key(client, 'Tab', 'Tab', 9, 8);
  assert.equal((await evaluate(client, STATE)).focusControl, 'remove', 'Shift+Tab goes back');
  await key(client, 'ArrowLeft', 'ArrowLeft', 37);
  assert.equal((await evaluate(client, STATE)).focusControl, 'edit');
  await key(client, 'ArrowLeft', 'ArrowLeft', 37);
  await key(client, 'ArrowLeft', 'ArrowLeft', 37);
  assert.equal((await evaluate(client, STATE)).focusControl, 'address');
  await key(client, 'Enter', 'Enter', 13);
  const asked = await waitState(client, (state) => !state.open && state.opens.length === 1, 'Enter on the address asks');
  assert.deepEqual(asked.opens, [ADDRESS]);
  assert.equal(asked.activeIsEditor, true, 'focus goes back to the text');

  await key(client, 'Enter', 'Enter', 13, 1);
  await waitState(client, (state) => state.open && state.focusControl === 'open', 'reopened from the keyboard');
  await key(client, 'Escape', 'Escape', 27);
  const closed = await waitState(client, (state) => !state.open, 'Esc closes');
  assert.equal(closed.activeIsEditor, true, 'Esc puts focus back in the text');
  assert.equal(closed.caretInLink, true);
});
