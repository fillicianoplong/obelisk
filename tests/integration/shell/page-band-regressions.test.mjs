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
  focusPage,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const sheet = document.querySelector('.page-sheet');
  const band = document.querySelector('[data-page-part="header"]');
  if (!sheet || !sheet.editorCommands || !band) return null;
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  return true;
})()`;

const PHRASE = 'sdfsdf asdfsdf fasdfsda';
const WORD = 'asdfsdf';

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function launchApp(session, port) {
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1'],
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

async function click(client, x, y, clickCount = 1) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
    clickCount: 0,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount,
  });
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${selector} is not visible`);
  await click(client, point.x, point.y);
}

async function clickMenu(client, label) {
  const point = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.menu-button')].find((node) => (node.textContent || '').trim().startsWith(${JSON.stringify(label)}));
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${label} menu is missing`);
  await click(client, point.x, point.y);
}

async function pressEscape(client) {
  const event = {
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

function wordPointExpression(rootSelector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const at = node.textContent.indexOf(${JSON.stringify(WORD)});
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + ${JSON.stringify(WORD)}.length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        }
      }
      node = walker.nextNode();
    }
    return null;
  })()`;
}

async function selectionText(client) {
  return evaluate(
    client,
    `(() => {
      const selection = document.getSelection();
      const dom = selection ? selection.toString() : '';
      const header = document.querySelector('[data-header-editor="true"]');
      if (header) {
        return dom;
      }
      const sheet = document.querySelector('[data-region="page-editor"]');
      return dom || (sheet?.editorCommands?.selection?.().text ?? '');
    })()`,
  );
}

async function doubleClickWord(client, rootSelector) {
  const point = await evaluate(client, wordPointExpression(rootSelector));
  assert.ok(point, `${WORD} is not visible in ${rootSelector}`);
  await click(client, point.x, point.y, 1);
  await sleep(40);
  await click(client, point.x, point.y, 2);
  await sleep(80);
  return selectionText(client);
}

async function bodyHit(client, theme) {
  return evaluate(
    client,
    `(() => {
      document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      const block = document.querySelector('[data-region="page-editor"] > p');
      const frame = document.querySelector('.page-frame');
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(node.length, 12));
      const rect = range.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 24);
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const textStyle = getComputedStyle(block);
      const frameStyle = frame ? getComputedStyle(frame) : null;
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        text: node.textContent,
        width: rect.width,
        height: rect.height,
        color: textStyle.color,
        opacity: textStyle.opacity,
        background: frameStyle ? frameStyle.backgroundColor : '',
        hit: hit ? (hit.getAttribute('data-region') || hit.className || hit.tagName) : null,
        inSheet: Boolean(hit && hit.closest('.page-sheet')),
        inFrame: Boolean(hit && (hit.classList.contains('page-frame') || hit.closest('.page-frame'))),
        framesZ: getComputedStyle(document.querySelector('.page-frames')).zIndex,
        hostZ: getComputedStyle(document.querySelector('.editor-host')).zIndex,
        bandZ: getComputedStyle(document.querySelector('.page-band-layer')).zIndex,
      };
    })()`,
  );
}

test('Pages body text is visible in light and dark', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-body-paint-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  const client = await launchApp(session, port);
  await focusPage(client);
  await evaluate(
    client,
    `(() => {
      document.querySelector('.page-sheet').editorCommands.replaceText('Visible body text on the sheet.');
      return true;
    })()`,
  );
  await sleep(80);

  for (const theme of ['light', 'dark']) {
    const hit = await bodyHit(client, theme);
    assert.equal(hit.theme, theme, JSON.stringify(hit));
    assert.ok(hit.width > 2 && hit.height > 2, JSON.stringify(hit));
    assert.equal(hit.inSheet, true, JSON.stringify(hit));
    assert.equal(hit.inFrame, false, JSON.stringify(hit));
    assert.notEqual(hit.color, hit.background, JSON.stringify(hit));
    assert.notEqual(hit.color, 'rgba(0, 0, 0, 0)', JSON.stringify(hit));
    assert.equal(hit.opacity, '1', JSON.stringify(hit));
    assert.equal(hit.framesZ, '0', JSON.stringify(hit));
    assert.equal(hit.hostZ, '1', JSON.stringify(hit));
    assert.equal(hit.bandZ, '2', JSON.stringify(hit));
  }
});

test('a double-click selects only the word in the body, header, and footer', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-word-click-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  const client = await launchApp(session, port);
  await focusPage(client);
  await evaluate(
    client,
    `(() => {
      document.querySelector('.page-sheet').editorCommands.replaceText(${JSON.stringify(PHRASE)});
      return true;
    })()`,
  );
  await sleep(80);

  const body = await doubleClickWord(client, '[data-region="page-editor"]');
  assert.equal(body, WORD, `pages body selected ${JSON.stringify(body)}`);

  await clickSelector(client, '[data-page-band-page="1"][data-page-part="header"] .page-band-hit');
  await waitFor(
    session.child,
    async () => evaluate(client, `document.querySelector('[data-header-editor="true"]') ? true : null`),
    5_000,
  );
  await client.send('Input.insertText', { text: PHRASE });
  await sleep(80);
  const header = await doubleClickWord(client, '[data-header-editor="true"]');
  assert.equal(header, WORD, `header selected ${JSON.stringify(header)}`);

  await clickSelector(client, '[data-insert-close]');
  await sleep(40);
  await evaluate(
    client,
    `(() => {
      const band = document.querySelector('[data-page-band-page="1"][data-page-part="footer"]');
      band.scrollIntoView({ block: 'center' });
      return true;
    })()`,
  );
  await sleep(40);
  await clickSelector(client, '[data-page-band-page="1"][data-page-part="footer"] .page-band-hit');
  await waitFor(
    session.child,
    async () => evaluate(client, `document.querySelector('[data-header-editor="true"]') ? true : null`),
    5_000,
  );
  await client.send('Input.insertText', { text: PHRASE });
  await sleep(80);
  const footer = await doubleClickWord(client, '[data-header-editor="true"]');
  assert.equal(footer, WORD, `footer selected ${JSON.stringify(footer)}`);

  await clickSelector(client, '[data-insert-close]');
  await sleep(40);
  await clickMenu(client, 'View');
  await sleep(30);
  await clickSelector(client, '[data-item="view-pageless"]');
  await evaluate(client, `document.querySelector('.page-region').scrollTop = 0`);
  // A press within 500ms of the previous one at the same point is a triple-click.
  await sleep(600);
  const pageless = await doubleClickWord(client, '[data-region="page-editor"]');
  assert.equal(pageless, WORD, `pageless body selected ${JSON.stringify(pageless)}`);
});

test('Escape from page 1 header returns the caret there without the page ring', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-band-escape-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  const client = await launchApp(session, port);
  await focusPage(client);
  await evaluate(
    client,
    `(() => {
      const line = 'Cool roofs and street trees lower the heat on a long city block.';
      const parts = [];
      for (let index = 0; index < 80; index += 1) parts.push(line);
      const editor = document.querySelector('.page-sheet');
      editor.editorCommands.replaceText(parts.join('\\n'));
      const view = editor.editorView;
      const Selection = view.state.selection.constructor;
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(view.state.doc.content.size))));
      return editor.editorCommands.layoutPages();
    })()`,
  );
  const before = await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('.page-sheet');
      return editor.editorCommands.pageSnapshot();
    })()`,
  );
  assert.ok(before.pageCount >= 2, JSON.stringify(before));
  assert.equal(before.page, before.pageCount, JSON.stringify(before));

  await evaluate(client, `document.querySelector('.page-region').scrollTop = 0`);
  await sleep(40);
  await clickSelector(client, '[data-page-band-page="1"][data-page-part="header"] .page-band-hit');
  await waitFor(
    session.child,
    async () => evaluate(client, `document.querySelector('[data-header-editor="true"]') ? true : null`),
    5_000,
  );
  await pressEscape(client);

  const after = await waitFor(
    session.child,
    async () => evaluate(
      client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        if (!editor || document.querySelector('[data-header-editor="true"]')) return null;
        const view = editor.editorView;
        const coords = view.coordsAtPos(view.state.selection.head);
        const frame = document.querySelector('.page-frame[data-page="1"]').getBoundingClientRect();
        const page2 = document.querySelector('.page-frame[data-page="2"]');
        const snapshot = editor.editorCommands.pageSnapshot();
        const inside = coords.top >= frame.top && coords.top <= frame.bottom
          && coords.left >= frame.left && coords.left <= frame.right;
        if (!inside || snapshot.page !== 1) return null;
        return {
          page: snapshot.page,
          active: document.activeElement === editor,
          source: editor.getAttribute('data-focus-source'),
          ring: document.querySelector('.page-frame[data-caret-focus]')?.getAttribute('data-page') || null,
          page2Ring: page2?.getAttribute('data-caret-focus') || null,
          inside,
        };
      })()`,
    ),
    5_000,
  );
  assert.equal(after.page, 1, JSON.stringify(after));
  assert.equal(after.inside, true, JSON.stringify(after));
  assert.equal(after.active, true, JSON.stringify(after));
  assert.equal(after.source, null, JSON.stringify(after));
  assert.equal(after.ring, null, JSON.stringify(after));
  assert.equal(after.page2Ring, null, JSON.stringify(after));
});
