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
  if (!editor || editor.getAttribute('contenteditable') !== 'true' || !editor.editorCommands) {
    return null;
  }
  return document.documentElement.dataset.shellCommands === 'ready' ? true : null;
})()`;

const SETUP = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  editor.focus();
  editor.editorCommands.replaceText('Alpha beta gamma.\\nDelta end\\nComma, then stop.');
  return true;
})()`;

const STATE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const selection = editor.editorCommands.selection();
  return {
    text: selection.text,
    from: selection.from,
    to: selection.to,
    empty: selection.empty,
    contextOpen: document.querySelector('[data-region="context-menu"]') !== null,
  };
})()`;

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-double-click-'));
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

function pointAt(client, line, offset) {
  return evaluate(client, `(() => {
    const block = document.querySelectorAll('[data-region="page-editor"] > p')[${line}];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = ${offset};
    let node = walker.nextNode();
    while (node && left > node.length) {
      left -= node.length;
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(node, Math.min(left, node.length));
    range.setEnd(node, Math.min(left, node.length));
    const rect = range.getBoundingClientRect();
    return { x: Math.round(rect.left + 1), y: Math.round(rect.top + rect.height / 2) };
  })()`);
}

function pointOfWord(client, line, word) {
  return evaluate(client, `(() => {
    const block = document.querySelectorAll('[data-region="page-editor"] > p')[${line}];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const at = node.textContent.indexOf(${JSON.stringify(word)});
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + ${JSON.stringify(word)}.length);
    const rect = range.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
}

async function mouse(client, type, point, button = 'none', clickCount = 1) {
  const held = button === 'left' ? 1 : button === 'right' ? 2 : button === 'middle' ? 4 : 0;
  await client.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button,
    buttons: type === 'mouseReleased' || button === 'none' ? 0 : held,
    clickCount: button === 'none' ? 0 : clickCount,
  });
}

async function doubleClick(client, point) {
  await mouse(client, 'mouseMoved', point);
  await mouse(client, 'mousePressed', point, 'left', 1);
  await mouse(client, 'mouseReleased', point, 'left', 1);
  await mouse(client, 'mousePressed', point, 'left', 2);
  const immediate = await evaluate(client, STATE);
  await mouse(client, 'mouseReleased', point, 'left', 2);
  await sleep(40);
  return immediate;
}

async function tripleClick(client, point) {
  await doubleClick(client, point);
  await mouse(client, 'mousePressed', point, 'left', 3);
  await mouse(client, 'mouseReleased', point, 'left', 3);
  await sleep(80);
}

async function drag(client, from, to) {
  await mouse(client, 'mouseMoved', from);
  await mouse(client, 'mousePressed', from, 'left', 1);
  await mouse(client, 'mouseMoved', to, 'left', 1);
  await mouse(client, 'mouseReleased', to, 'left', 1);
  await sleep(80);
}

async function waitText(client, text) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, STATE);
    if (last && last.text === text) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`selection did not become ${JSON.stringify(text)}: ${JSON.stringify(last)}`);
}

test('a double-click selects the word and not the space after it', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const immediate = await doubleClick(client, await pointOfWord(client, 0, 'beta'));
  assert.equal(/\s/.test(immediate.text), false, `the word flashed a wider selection: ${JSON.stringify(immediate)}`);
  assert.ok(immediate.text === '' || immediate.text === 'beta', JSON.stringify(immediate));
  const beta = await waitText(client, 'beta');
  assert.equal(beta.text, 'beta');
  assert.equal(/\s/.test(beta.text), false);

  await doubleClick(client, await pointOfWord(client, 1, 'end'));
  const end = await waitText(client, 'end');
  assert.equal(end.text, 'end');

  await doubleClick(client, await pointOfWord(client, 0, 'gamma'));
  const gamma = await waitText(client, 'gamma');
  assert.equal(gamma.text, 'gamma');

  await doubleClick(client, await pointOfWord(client, 2, 'Comma'));
  const comma = await waitText(client, 'Comma');
  assert.equal(comma.text, 'Comma');
});

test('triple-click and drag-select still include the spaces', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await tripleClick(client, await pointOfWord(client, 0, 'beta'));
  const line = await waitText(client, 'Alpha beta gamma.');
  assert.equal(line.text, 'Alpha beta gamma.');

  const start = await pointAt(client, 0, 1);
  const end = await pointAt(client, 0, 9);
  await drag(client, start, end);
  const dragged = await evaluate(client, STATE);
  assert.equal(dragged.text.includes(' '), true, JSON.stringify(dragged));
  assert.ok(dragged.text.startsWith('Alpha'), JSON.stringify(dragged));
});

test('a triple-click then drag extends by whole lines', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const from = await pointOfWord(client, 0, 'beta');
  const to = await pointOfWord(client, 1, 'end');
  await mouse(client, 'mouseMoved', from);
  await mouse(client, 'mousePressed', from, 'left', 1);
  await mouse(client, 'mouseReleased', from, 'left', 1);
  await mouse(client, 'mousePressed', from, 'left', 2);
  await mouse(client, 'mouseReleased', from, 'left', 2);
  await mouse(client, 'mousePressed', from, 'left', 3);
  await mouse(client, 'mouseMoved', to, 'left', 3);
  await mouse(client, 'mouseReleased', to, 'left', 3);
  const selected = await waitText(client, 'Alpha beta gamma.Delta end');
  assert.equal(selected.text, 'Alpha beta gamma.Delta end');
});

test('a double-click with a menu open selects only the word', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const margin = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-region="page-editor"]').getBoundingClientRect();
    return { x: Math.round(rect.right - 8), y: Math.round(rect.top + 24) };
  })()`);
  await mouse(client, 'mouseMoved', margin);
  await mouse(client, 'mousePressed', margin, 'right', 1);
  await mouse(client, 'mouseReleased', margin, 'right', 1);
  const opened = await evaluate(client, STATE);
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let menu = opened;
  while (Date.now() < deadline && !menu.contextOpen) {
    await sleep(30);
    menu = await evaluate(client, STATE);
  }
  assert.equal(menu.contextOpen, true, JSON.stringify(menu));
  await doubleClick(client, await pointOfWord(client, 0, 'beta'));
  const selected = await waitText(client, 'beta');
  assert.equal(selected.text, 'beta');
  assert.equal(selected.contextOpen, false);
});
