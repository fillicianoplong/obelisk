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
  if (!editor || !editor.editorCommands) {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
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

async function openMlaTab(client) {
  let step = 'pending';
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline && step !== 'clicked') {
    step = await evaluate(
      client,
      `(() => {
        const file = document.querySelector('[data-menu="file"]');
        if (!file) return 'no file';
        if (file.getAttribute('aria-expanded') !== 'true') {
          file.click();
          return 'opened file';
        }
        const template = document.querySelector('[data-item="file-template"]');
        if (!template) return 'no template';
        template.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        if (template.getAttribute('aria-expanded') !== 'true') {
          template.click();
          return 'opened template';
        }
        const mla = document.querySelector('[data-command="new-mla"]');
        if (!mla || mla.getAttribute('aria-disabled') === 'true') return 'mla unavailable';
        mla.click();
        return 'clicked';
      })()`,
    );
    if (step !== 'clicked') {
      await sleep(30);
    }
  }
  assert.equal(step, 'clicked');
  const titleDeadline = Date.now() + STEP_TIMEOUT_MS;
  let title = '';
  while (Date.now() < titleDeadline) {
    title = await evaluate(
      client,
      `document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-title') ?? ''`,
    );
    if (title === 'Untitled 2') {
      break;
    }
    await sleep(40);
  }
  assert.equal(title, 'Untitled 2');
}

async function caretContext(client) {
  return evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const view = editor?.editorView;
      if (!editor?.editorCommands || !view) return null;
      const sel = editor.editorCommands.selection();
      const $pos = view.state.doc.resolve(Math.max(0, Math.min(sel.head, view.state.doc.content.size)));
      const blockIndex = $pos.index(0);
      const blockText = view.state.doc.child(blockIndex).textContent;
      const layout = editor.editorCommands.pageSnapshot();
      return { blockIndex, blockText, head: sel.head, page: layout.page };
    })()`,
  );
}

test('clicking below the MLA Title keeps the caret off Works Cited', async (t) => {
  const port = await freePort();
  const session = { userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-page-click-mla-')) };
  const finish = bindLaunchedApp(t, session);
  await launchApp(session, port);
  await openMlaTab(session.client);

  const point = await evaluate(
    session.client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const title = editor?.querySelectorAll(':scope > p')[4];
      if (!title) return null;
      const rect = title.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.bottom + 18),
      };
    })()`,
  );
  assert.ok(point, 'Title paragraph is missing');

  await click(session.client, point.x, point.y);
  await sleep(80);
  const caret = await caretContext(session.client);
  assert.ok(caret, 'caret context missing');
  assert.notEqual(caret.blockText, 'Works Cited', JSON.stringify(caret));
  assert.equal(caret.page, 1, JSON.stringify(caret));

  await finish();
});

test('clicking the bottom gap on a page stays on that page', async (t) => {
  const port = await freePort();
  const session = { userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-page-click-gap-')) };
  const finish = bindLaunchedApp(t, session);
  await launchApp(session, port);

  await evaluate(
    session.client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const lines = [];
      for (let index = 0; index < 40; index += 1) {
        lines.push('Line ' + index + ' keeps the body on the first sheet.');
      }
      editor.editorCommands.replaceText(lines.join('\\n'));
      return true;
    })()`,
  );
  await sleep(200);

  const point = await evaluate(
    session.client,
    `(() => {
      const frame = document.querySelector('.page-frame[data-page="1"]');
      const editor = document.querySelector('[data-region="page-editor"]');
      if (!frame || !editor) return null;
      const frameRect = frame.getBoundingClientRect();
      const blocks = [...editor.querySelectorAll(':scope > p')];
      const lastOnPage = blocks.findLast((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > frameRect.top && rect.top < frameRect.bottom;
      });
      if (!lastOnPage) return null;
      const lastRect = lastOnPage.getBoundingClientRect();
      const y = Math.min(frameRect.bottom - 12, lastRect.bottom + 24);
      return { x: Math.round(frameRect.left + frameRect.width / 2), y: Math.round(y) };
    })()`,
  );
  assert.ok(point, 'page gap point missing');

  await click(session.client, point.x, point.y);
  await sleep(80);
  const caret = await caretContext(session.client);
  assert.ok(caret, 'caret context missing');
  assert.equal(caret.page, 1, JSON.stringify(caret));
  assert.notEqual(caret.blockText, 'Works Cited', JSON.stringify(caret));

  await finish();
});