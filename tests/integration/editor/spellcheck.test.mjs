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
  waitFor,
} from '../electron-launch.mjs';

const READY = `document.documentElement.dataset.shellCommands === 'ready'
  && Boolean(document.querySelector('[data-region="page-editor"]')?.editorCommands)`;

async function pageUrl(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

async function clickSelector(client, selector) {
  const point = await evaluate(client, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1) return null;
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  assert.ok(point, selector);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
}

test('spell check starts on, skips code, and the Tools toggle is saved', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-spell-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      ready(child) {
        return waitFor(child, async () => {
          const url = await pageUrl(port);
          if (!url) return null;
          if (!session.client) session.client = openCdp(url);
          const ready = await evaluate(session.client, READY);
          return ready ? true : null;
        }, 20_000);
      },
    });
    const client = session.client;
    const before = await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.replaceText('Note');
      editor.editorCommands.insertBlock('code', { text: 'alpha' });
      const code = document.querySelector('pre[data-code-block]');
      return {
        page: editor.getAttribute('spellcheck'),
        code: code ? code.getAttribute('spellcheck') : null,
        inner: code ? code.querySelector('code')?.getAttribute('spellcheck') : null,
      };
    })()`);
    assert.equal(before.page, 'true');
    assert.equal(before.code, 'false');
    assert.equal(before.inner, 'false');

    await clickSelector(client, '[data-menu="tools"]');
    await sleep(50);
    await clickSelector(client, '[data-item="tools-spelling"]');
    await sleep(80);
    const off = await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      return window.obelisk['prefs:get']({ key: 'spelling' }).then((result) => ({
        page: editor.getAttribute('spellcheck'),
        status: result.status,
        value: result.value,
      }));
    })()`);
    assert.equal(off.page, 'false');
    assert.equal(off.status, 'ok');
    assert.equal(off.value, false);
  } finally {
    await finish();
  }
});
