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
  const menu = document.querySelector('#menu-top-file');
  const tab = document.querySelector('[role="tab"][aria-selected="true"]');
  const status = document.querySelector('[data-region="status-bar"]');
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (!editor || !editor.editorCommands || !menu || !tab || !status) {
    return null;
  }
  if (editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  return true;
})()`;

const SNAPSHOT = `(() => {
  const active = document.activeElement;
  const marked = active && active.closest ? active.closest('[data-region]') : null;
  const marker = marked ? marked.getAttribute('data-region') : null;
  const region = marker === 'page-editor' || marker === 'page' ? 'page' : marker;
  const editor = document.querySelector('[data-region="page-editor"]');
  const selection = editor && editor.editorCommands ? editor.editorCommands.selection() : null;
  const dom = window.getSelection();
  const announcer = document.getElementById('focus-region-announce');
  return {
    region,
    id: active && active.id ? active.id : null,
    className: active && active.className ? String(active.className) : '',
    names: {
      menu: document.querySelector('[data-region="menu-bar"]')?.getAttribute('aria-label') ?? null,
      tabs: document.querySelector('[role="tablist"]')?.getAttribute('aria-label') ?? null,
      document: editor ? editor.getAttribute('aria-label') : null,
      status: document.querySelector('[data-region="status-bar"]')?.getAttribute('aria-label') ?? null,
    },
    selection,
    domText: dom ? dom.toString().replace(/\\u200b/g, '') : '',
    announcement: announcer ? (announcer.dataset.regionAnnouncement || '') : '',
    liveText: announcer ? (announcer.textContent || '') : '',
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

async function pressF6(client, shift = false) {
  await pressKey(client, 'F6', 'F6', 117, shift ? 8 : 0);
}

function assertSelection(snapshot, expected, label) {
  assert.equal(snapshot.selection.anchor, expected.anchor, `${label} anchor ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.selection.head, expected.head, `${label} head ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.selection.text, expected.text, `${label} text ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.domText, expected.text, `${label} dom ${JSON.stringify(snapshot)}`);
}

test('F6 cycles the four regions and the page selection survives', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-region-cycle-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
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
    const placed = await evaluate(
      client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        editor.editorCommands.insertText('Pendulum lab');
        editor.editorCommands.setSelection(1, 9);
        return editor.editorCommands.selection();
      })()`,
    );
    assert.equal(placed.text, 'Pendulum');
    assert.equal(placed.anchor, 1);
    assert.equal(placed.head, 9);

    const names = await evaluate(client, SNAPSHOT);
    assert.deepEqual(names.names, {
      menu: 'Menu bar',
      tabs: 'Tabs',
      document: 'Document',
      status: 'Status bar',
    });

    const forward = [];
    for (let step = 0; step < 4; step += 1) {
      await pressF6(client);
      forward.push(await evaluate(client, SNAPSHOT));
    }
    assert.deepEqual(forward.map((snapshot) => snapshot.region), [
      'status-bar',
      'menu-bar',
      'tab-strip',
      'page',
    ]);
    assert.equal(forward[0].id, null, JSON.stringify(forward[0]));
    assert.match(forward[0].className, /status-bar/);
    assert.equal(forward[1].id, 'menu-top-file');
    assert.match(forward[2].id, /^tab-/);
    assert.equal(forward[3].region, 'page');
    assertSelection(forward[3], placed, 'after four F6 presses');
    assert.deepEqual(forward.map((snapshot) => snapshot.announcement), [
      'Status bar',
      'Menu bar',
      'Tabs',
      'Document',
    ]);

    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let live = forward[3].liveText;
    while (live !== 'Document' && Date.now() < deadline) {
      await sleep(20);
      live = (await evaluate(client, SNAPSHOT)).liveText;
    }
    assert.equal(live, 'Document');

    const backward = [];
    for (let step = 0; step < 4; step += 1) {
      await pressF6(client, true);
      backward.push(await evaluate(client, SNAPSHOT));
    }
    assert.deepEqual(backward.map((snapshot) => snapshot.region), [
      'tab-strip',
      'menu-bar',
      'status-bar',
      'page',
    ]);
    assertSelection(backward[3], placed, 'after four Shift+F6 presses');

    await evaluate(client, `document.getElementById('menu-top-edit').focus({ preventScroll: true })`);
    await pressF6(client);
    const leftMenu = await evaluate(client, SNAPSHOT);
    assert.equal(leftMenu.region, 'tab-strip');
    await pressF6(client, true);
    const backToEdit = await evaluate(client, SNAPSHOT);
    assert.equal(backToEdit.region, 'menu-bar');
    assert.equal(backToEdit.id, 'menu-top-edit');

    await evaluate(
      client,
      `document.querySelector('.status-save').focus({ preventScroll: true })`,
    );
    await pressF6(client);
    const leftStatus = await evaluate(client, SNAPSHOT);
    assert.equal(leftStatus.region, 'menu-bar');
    await pressF6(client, true);
    const backToSave = await evaluate(client, SNAPSHOT);
    assert.equal(backToSave.region, 'status-bar');
    assert.match(backToSave.className, /status-save/);

    await pressF6(client, true);
    const pageAgain = await evaluate(client, SNAPSHOT);
    assert.equal(pageAgain.region, 'page');
    assertSelection(pageAgain, placed, 'after leaving the remembered status item');
  } finally {
    await finish();
  }
});
