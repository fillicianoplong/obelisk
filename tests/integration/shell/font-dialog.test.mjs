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

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function pressChord(client, key, code, virtualKey) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 });
}

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers });
}

test('the Font dialog and block context menu apply formatting', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-font-dialog-'));
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
  const client = await openPage(port, session);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.replaceText('Decorated');
      editor.editorCommands.setSelection(1, 10);
      editor.focus();
    })()`,
  );
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68, modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68, modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });

  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let dialogOpen = false;
  while (Date.now() < deadline) {
    dialogOpen = await evaluate(client, `Boolean(document.querySelector('[data-font-dialog]'))`);
    if (dialogOpen) {
      break;
    }
    await sleep(30);
  }
  assert.equal(dialogOpen, true, 'Ctrl+D opens the Font dialog');

  await evaluate(
    client,
    `(() => {
      const style = document.querySelector('[data-font-style]');
      style.value = 'bold';
      style.dispatchEvent(new Event('change', { bubbles: true }));
      const ok = document.querySelector('.font-dialog-button-primary');
      ok.click();
    })()`,
  );
  await sleep(120);
  const hasBold = await evaluate(
    client,
    `Boolean(document.querySelector('[data-region="page-editor"] strong'))`,
  );
  assert.equal(hasBold, true, 'OK applies bold from the Font dialog');

  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.focusBlock(0);
      const handle = document.querySelector('.block-handle-layer .block-handle');
      const rect = handle.getBoundingClientRect();
      handle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 }));
    })()`,
  );
  await sleep(200);
  const menu = await evaluate(
    client,
    `(() => {
      const host = document.querySelector('[data-region="context-menu"]');
      if (!host) {
        return { labels: [] };
      }
      const labels = [...host.querySelectorAll('.menu-panel--root .menu-item .menu-label')].map((node) => node.textContent);
      return { labels };
    })()`,
  );
  assert.deepEqual(menu.labels.slice(0, 4), ['Cut', 'Copy', 'Paste', 'Font…']);
  assert.ok(menu.labels.includes('Block'));
  assert.ok(menu.labels.includes('Paragraph…'));
});