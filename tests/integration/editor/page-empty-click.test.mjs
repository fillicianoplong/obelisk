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
  if (!editor.editorCommands) {
    return null;
  }
  return true;
})()`;

const CARET_BLOCK = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const view = editor?.editorView;
  if (!view) {
    return null;
  }
  const head = view.state.selection.head;
  const blockIndex = view.state.doc.resolve(head).index(0);
  const blocks = [...editor.children];
  const block = blocks[blockIndex];
  return {
    blockIndex,
    tag: block?.tagName?.toLowerCase() ?? '',
    text: (block?.textContent ?? '').replace(/\\u200b/g, '').trim(),
    page: editor.editorCommands.pageSnapshot().page,
  };
})()`;

const CLICK_BELOW_TITLE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor) return null;
  const paragraphs = [...editor.querySelectorAll(':scope > p')];
  const title = paragraphs[4];
  if (!title) return null;
  const titleRect = title.getBoundingClientRect();
  const breakNode = editor.querySelector('.page-break');
  const breakRect = breakNode?.getBoundingClientRect();
  const gapTop = titleRect.bottom + 8;
  const gapBottom = breakRect ? breakRect.top - 8 : titleRect.bottom + 120;
  if (gapBottom <= gapTop) {
    return null;
  }
  const y = Math.round((gapTop + gapBottom) / 2);
  return {
    x: Math.round(titleRect.left + titleRect.width / 2),
    y,
    titleText: (title.textContent || '').trim(),
  };
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (pages.length !== 1) {
    return null;
  }
  return pages[0].webSocketDebuggerUrl;
}

async function launchApp(session, port) {
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          session.client?.close();
          session.client = openCdp(url);
          return evaluate(session.client, READY);
        },
        20_000,
      );
    },
  });
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

async function openMla(client) {
  let state = 'pending';
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline && state !== 'clicked') {
    state = await evaluate(
      client,
      `(() => {
        const file = document.querySelector('[data-menu="file"]');
        if (!file) return 'no file';
        if (file.getAttribute('aria-expanded') !== 'true') {
          file.click();
          return 'opening file';
        }
        const template = document.querySelector('[data-item="file-template"]');
        if (!template) return 'no template';
        template.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        if (template.getAttribute('aria-expanded') !== 'true') {
          template.click();
          return 'opening template';
        }
        const mla = document.querySelector('[data-command="new-mla"]');
        if (!mla || mla.getAttribute('aria-disabled') === 'true') return 'mla unavailable';
        mla.click();
        return 'clicked';
      })()`,
    );
    if (state !== 'clicked') {
      await sleep(30);
    }
  }
  assert.equal(state, 'clicked', state);
}

test('clicking below the Title in the MLA template keeps the caret on page 1', { timeout: 120_000 }, async (t) => {
  const port = await freePort();
  const session = { userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-page-click-')) };
  const finish = bindLaunchedApp(t, session);
  await launchApp(session, port);
  await openMla(session.client);

  let clickPoint = null;
  const pointDeadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < pointDeadline) {
    clickPoint = await evaluate(session.client, CLICK_BELOW_TITLE);
    if (clickPoint && clickPoint.titleText === 'Title') {
      break;
    }
    await sleep(40);
  }
  assert.ok(clickPoint, 'could not locate the gap below the MLA title');
  await click(session.client, clickPoint.x, clickPoint.y);
  await sleep(80);

  const caret = await evaluate(session.client, CARET_BLOCK);
  assert.ok(caret, 'caret state is missing');
  assert.equal(caret.page, 1, `caret is on page ${caret.page}`);
  assert.notEqual(caret.text, 'Works Cited', `caret landed in ${caret.text}`);
  assert.ok(caret.blockIndex < 6, `block index ${caret.blockIndex} is past the page break`);

  await finish();
});