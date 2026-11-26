import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import {
  emptyManifest,
  minimalDocument,
  paragraph,
  textRun,
} from '../../../scripts/make-hostile-fixtures/documents.mjs';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const frame = document.querySelector('.page-frame');
  const sheet = document.querySelector('.page-sheet');
  if (!frame || !sheet || !sheet.editorCommands) return null;
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  return true;
})()`;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} expected ${expected}`);
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function launchApp(session, port, extraArgs = []) {
  const binary = electronBinary();
  session.child = await launchWithSandboxFallback({
    binary,
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1', ...extraArgs],
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

async function click(client, x, y) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
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

async function readLayout(client) {
  return evaluate(
    client,
    `(() => {
      const frame = document.querySelector('.page-frame');
      const sheet = document.querySelector('.page-sheet');
      const rect = frame ? frame.getBoundingClientRect() : null;
      const style = sheet ? getComputedStyle(sheet) : null;
      const dialog = document.querySelector('[data-page-setup]');
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      return {
        frames: document.querySelectorAll('.page-frame').length,
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        paddingTop: style ? style.paddingTop : '',
        paddingLeft: style ? style.paddingLeft : '',
        orientation: document.querySelector('.page-canvas')?.getAttribute('data-page-orientation') || '',
        save: document.querySelector('[data-save-state]')?.getAttribute('data-save-state') || '',
        unsaved: tab ? tab.getAttribute('data-unsaved') : '',
        dialog: dialog !== null,
        valid: dialog ? dialog.getAttribute('data-page-setup-valid') : '',
        message: document.querySelector('[data-page-setup-message]')?.textContent || '',
        caption: (document.querySelector('.page-setup-caption')?.textContent || '').replace(/\\s+/g, ' ').trim(),
        okDisabled: document.querySelector('[data-page-ok]')?.disabled ?? null,
        paper: document.querySelector('[data-page-paper]')?.textContent || '',
        paperRow: (() => {
          const row = document.querySelector('.page-setup-paper-row');
          const label = row?.querySelector('.page-setup-section');
          const value = row?.querySelector('[data-page-paper]');
          if (!label || !value) return false;
          const labelRect = label.getBoundingClientRect();
          const valueRect = value.getBoundingClientRect();
          return Math.abs(labelRect.top - valueRect.top) < 8 && valueRect.left > labelRect.right;
        })(),
        actionsAtEnd: (() => {
          const dialog = document.querySelector('[data-page-setup]');
          const cancel = document.querySelector('[data-page-cancel]');
          if (!dialog || !cancel) return false;
          const dialogRect = dialog.getBoundingClientRect();
          const cancelRect = cancel.getBoundingClientRect();
          return dialogRect.right - cancelRect.right < 24 && cancelRect.left > dialogRect.left + dialogRect.width / 2;
        })(),
      };
    })()`,
  );
}

async function openPageSetup(client) {
  await clickMenu(client, 'Format');
  await sleep(50);
  await clickSelector(client, '[data-item="format-page-setup"]');
  await sleep(50);
  const layout = await readLayout(client);
  assert.equal(layout.dialog, true);
  return layout;
}

test('Page setup applies orientation and margins, and refuses a margin over 3 inches', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-page-setup-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    let layout = await readLayout(client);
    near(layout.width, 816, 'portrait width');
    near(layout.height, 1056, 'portrait height');
    assert.equal(layout.paddingTop, '96px');
    assert.equal(layout.paddingLeft, '96px');
    assert.equal(layout.unsaved, 'false');

    layout = await openPageSetup(client);
    assert.equal(layout.paper, 'Letter (8.5 × 11 in)');
    assert.equal(layout.valid, 'true');
    assert.equal(layout.message, '0.25 to 3 in');
    assert.equal(layout.caption, 'Letter · Portrait · Normal');
    assert.equal(layout.paperRow, true);
    assert.equal(layout.actionsAtEnd, true);
    assert.equal(layout.okDisabled, false);

    await clickSelector(client, '[data-orientation-choice="landscape"]');
    await clickSelector(client, '[data-preset="narrow"]');
    await sleep(30);
    layout = await readLayout(client);
    near(layout.width, 816, 'the document waits for OK');
    assert.equal(layout.unsaved, 'false');
    await clickSelector(client, '[data-page-ok]');
    await sleep(80);
    layout = await readLayout(client);
    assert.equal(layout.dialog, false);
    assert.equal(layout.orientation, 'landscape');
    near(layout.width, 1056, 'landscape width');
    near(layout.height, 816, 'landscape height');
    assert.equal(layout.paddingTop, '48px');
    assert.equal(layout.paddingLeft, '48px');
    assert.equal(layout.unsaved, 'true');
    assert.equal(layout.save, 'unsaved');

    await openPageSetup(client);
    await clickSelector(client, '[data-preset="wide"]');
    await pressKey(client, 'Escape', 'Escape', 27);
    await sleep(50);
    layout = await readLayout(client);
    assert.equal(layout.dialog, false);
    assert.equal(layout.paddingLeft, '48px');
    assert.equal(layout.orientation, 'landscape');

    await openPageSetup(client);
    await clickSelector(client, '[data-margin="left"]');
    await pressKey(client, 'a', 'KeyA', 65, 2);
    await client.send('Input.insertText', { text: '3.5' });
    await sleep(50);
    layout = await readLayout(client);
    assert.equal(layout.valid, 'false');
    assert.equal(layout.message, 'A margin must be between 0.25 and 3 inches.');
    assert.equal(layout.okDisabled, true);
    await clickSelector(client, '[data-page-cancel]');
    await sleep(30);
    layout = await readLayout(client);
    assert.equal(layout.dialog, false);
    assert.equal(layout.paddingLeft, '48px');

    await clickMenu(client, 'View');
    await sleep(30);
    await clickSelector(client, '[data-item="view-pageless"]');
    await sleep(30);
    await clickMenu(client, 'Format');
    await sleep(30);
    const enabled = await evaluate(
      client,
      `(() => {
        const setup = document.querySelector('[data-item="format-page-setup"]');
        const header = document.querySelector('[data-item="format-header"]');
        return {
          setup: setup ? setup.getAttribute('aria-disabled') : 'missing',
          header: header ? header.getAttribute('aria-disabled') : 'missing',
        };
      })()`,
    );
    assert.equal(enabled.setup, 'true');
    assert.equal(enabled.header, 'true');

    await pressKey(client, 'Escape', 'Escape', 27);
    await sleep(30);
    await clickMenu(client, 'View');
    await sleep(30);
    await clickSelector(client, '[data-item="view-pages"]');
    await sleep(30);
    await clickMenu(client, 'Format');
    await sleep(30);
    const restored = await evaluate(
      client,
      `(() => {
        const setup = document.querySelector('[data-item="format-page-setup"]');
        const header = document.querySelector('[data-item="format-header"]');
        return {
          setup: setup ? setup.getAttribute('aria-disabled') : 'missing',
          header: header ? header.getAttribute('aria-disabled') : 'missing',
          view: document.querySelector('.page-region')?.getAttribute('data-page-view') || '',
        };
      })()`,
    );
    assert.equal(restored.view, 'pages');
    assert.equal(restored.setup, null);
    assert.equal(restored.header, null);
  } finally {
    await finish();
  }
});

test('a saved page setup comes back when the file opens', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-page-setup-open-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const file = path.join(userDataDir, 'wide-landscape.obk');

  try {
    const document = minimalDocument([paragraph(3, [textRun('The margins are in the file.')])]);
    document.view = 'pages';
    document.page = {
      paper: 'letter',
      orientation: 'landscape',
      margins: { top: 0.5, right: 1.5, bottom: 0.5, left: 1.5 },
    };
    const encoded = await encodeObk(document, emptyManifest('0.1.45.0'));
    assert.equal(encoded.ok, true, encoded.message);
    await writeFile(file, encoded.bytes);
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, decoded.message);
    assert.equal(decoded.document.page.orientation, 'landscape');
    assert.equal(decoded.document.page.margins.left, 1.5);

    const port = await freePort();
    const client = await launchApp(session, port, [file]);
    const layout = await waitFor(
      session.child,
      async () => {
        const next = await readLayout(client);
        if (Math.abs(next.width - 1056) < 2 && next.paddingLeft === '144px') {
          return next;
        }
        return null;
      },
      20_000,
    );
    assert.equal(layout.orientation, 'landscape');
    near(layout.width, 1056, 'reopened width');
    near(layout.height, 816, 'reopened height');
    assert.equal(layout.paddingTop, '48px');
    assert.equal(layout.paddingLeft, '144px');
    assert.equal(layout.unsaved, 'false');
  } finally {
    await finish();
  }
});
