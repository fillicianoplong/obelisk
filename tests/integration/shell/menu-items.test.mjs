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
  if (document.querySelector('[data-page="start"]') && !document.querySelector('[data-region="page-editor"]')) {
    document.querySelector('.start-action-primary')?.click();
  }
  return true;
})()`;

const SNAPSHOT = `(() => {
  const item = (id) => {
    const node = document.querySelector('[data-item="' + id + '"]');
    if (!node) {
      return null;
    }
    return {
      disabled: node.getAttribute('aria-disabled'),
      expanded: node.getAttribute('aria-expanded'),
    };
  };
  const editor = document.querySelector('[data-region="page-editor"]');
  const commands = editor && editor.editorCommands;
  const snapshot = commands ? commands.blockSnapshot() : [];
  const blocks = Array.isArray(snapshot) ? snapshot.length : 0;
  const hasBold = Boolean(editor && editor.querySelector('strong'));
  const text = editor ? editor.textContent : '';
  return {
    cut: item('edit-cut'),
    bold: item('format-bold'),
    blocks,
    hasBold,
    text,
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
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers });
}

async function pressChord(client, key, code, virtualKey) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 });
}

async function waitForState(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, SNAPSHOT);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

test('the menu bar enables formatting only with a selection and runs Insert', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-menu-items-'));
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
      editor.editorCommands.insertText('Bold me');
      editor.focus();
    })()`,
  );

  await pressChord(client, 'e', 'KeyE', 69);
  const editClosed = await waitForState(client, (state) => state.cut?.disabled === 'true', 'Cut is disabled with no selection');
  assert.equal(editClosed.cut.disabled, 'true');

  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.setSelection(1, 8);
    })()`,
  );
  await pressChord(client, 'e', 'KeyE', 69);
  await waitForState(client, (state) => state.cut?.disabled === null, 'Cut is enabled with a selection');
  await pressKey(client, 't', 'KeyT', 84);
  await waitForState(client, (state) => state.text.trim() === '', 'Edit > Cut removes the selection');

  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.insertText('Bold me');
      editor.editorCommands.setSelection(1, 5);
      editor.focus();
    })()`,
  );
  await pressChord(client, 'o', 'KeyO', 79);
  await pressKey(client, 'Enter', 'Enter', 13);
  await pressKey(client, 'Enter', 'Enter', 13);
  await waitForState(client, (state) => state.hasBold === true, 'Format > Bold applies bold');

  await pressChord(client, 'i', 'KeyI', 73);
  await pressKey(client, '1', 'Digit1', 49);
  await pressKey(client, 'Enter', 'Enter', 13);
  const afterInsert = await waitForState(client, (state) => state.blocks >= 2, 'Insert > Heading 1 adds a block');
  assert.ok(afterInsert.blocks >= 2);
});

test('Shift+arrow then the Edit menu enables Cut immediately', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-menu-shift-'));
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
  await client.send('Page.bringToFront');
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.insertText('Bold me');
      editor.editorCommands.setSelection(2, 2);
      editor.focus();
    })()`,
  );
  const point = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-region="page-editor"]').getBoundingClientRect();
    return { x: Math.round(rect.left + 30), y: Math.round(rect.top + 140) };
  })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', clickCount: 0 });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.editorCommands.setSelection(2, 2);
    editor.focus();
  })()`);
  async function extendWithShiftArrow() {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8,
    });
    for (let step = 0; step < 4; step += 1) {
      await pressKey(client, 'ArrowRight', 'ArrowRight', 39, 8);
    }
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 0,
    });
    return evaluate(client, `document.querySelector('[data-region="page-editor"]').editorCommands.selection()`);
  }
  let selected = await extendWithShiftArrow();
  if (selected.empty) {
    await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.setSelection(2, 2);
      editor.focus();
    })()`);
    selected = await extendWithShiftArrow();
  }
  assert.equal(selected.empty, false, `Shift+arrow selection: ${JSON.stringify(selected)}`);
  await pressChord(client, 'e', 'KeyE', 69);
  const edit = await waitForState(client, (state) => state.cut?.disabled === null, 'Cut is enabled right after Shift+arrow');
  assert.equal(edit.cut.disabled, null);
});