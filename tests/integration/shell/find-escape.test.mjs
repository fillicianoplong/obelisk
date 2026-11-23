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

const SETUP = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  editor.focus();
  editor.editorCommands.replaceText('Pick a theme for the theme demo.\\nThen save it.');
  return true;
})()`;

const STATE = `(() => {
  const page = document.querySelector('[data-region="page-editor"]');
  const view = page.editorView;
  const style = getComputedStyle(page);
  const after = getComputedStyle(page, '::after');
  const active = document.activeElement;
  return {
    findOpen: document.querySelector('.find-bubble') !== null,
    findFocused: active instanceof HTMLInputElement && active.closest('.find-bubble') !== null,
    pageFocused: active === page,
    focusSource: page.getAttribute('data-focus-source'),
    outline: style.outlineStyle,
    afterOutline: after.outlineStyle,
    selection: { from: view.state.selection.from, to: view.state.selection.to },
  };
})()`;

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-find-escape-'));
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

async function key(client, name, code, virtualKey, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await sleep(120);
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


test('Esc in the find bubble returns to the text with no focus ring on the page', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  // Select the first "theme" so Find starts with it and the selection can come back.
  await evaluate(client, `(() => {
    const page = document.querySelector('[data-region="page-editor"]');
    page.editorCommands.setSelection(8, 13);
    page.focus();
    return true;
  })()`);
  const before = await waitState(client, (state) => state.selection.to - state.selection.from === 5, 'theme selected');
  await key(client, 'f', 'KeyF', 70, 2);
  await waitState(client, (state) => state.findOpen && state.findFocused, 'Ctrl+F opens Find with focus in its field');
  await key(client, 'Escape', 'Escape', 27);
  const closed = await waitState(client, (state) => !state.findOpen, 'Esc closes Find');
  await sleep(200);
  const settled = await evaluate(client, STATE);
  assert.equal(settled.pageFocused, true, `focus is back in the text: ${JSON.stringify(settled)}`);
  assert.equal(settled.focusSource, null, 'the page is not marked as keyboard focused');
  assert.equal(settled.outline, 'none', 'no focus ring on the page');
  assert.equal(settled.afterOutline, 'none', 'no focus ring drawn around the page');
  assert.deepEqual(settled.selection, before.selection, 'the selection is back where it was');
  assert.equal(closed.findFocused, false);
});

test('Esc from the document still closes Find with no focus ring', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await key(client, 'f', 'KeyF', 70, 2);
  await waitState(client, (state) => state.findOpen && state.findFocused, 'Ctrl+F opens Find');
  await evaluate(client, `(() => {
    document.querySelector('[data-region="page-editor"]').focus();
    return true;
  })()`);
  await waitState(client, (state) => state.pageFocused, 'focus moves to the text');
  await key(client, 'Escape', 'Escape', 27);
  await waitState(client, (state) => !state.findOpen, 'Esc closes Find');
  await sleep(200);
  const settled = await evaluate(client, STATE);
  assert.equal(settled.pageFocused, true);
  assert.equal(settled.focusSource, null);
});
