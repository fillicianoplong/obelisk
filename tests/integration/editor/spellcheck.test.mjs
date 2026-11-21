import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
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

async function seedDictionary(userDataDir) {
  const sourceDir = path.join(homedir(), '.config', 'Electron', 'Dictionaries');
  let names;
  try {
    names = (await readdir(sourceDir)).filter((name) => name.startsWith('en-US') && name.endsWith('.bdic'));
  } catch {
    return;
  }
  if (names.length === 0) {
    return;
  }
  const target = path.join(userDataDir, 'Dictionaries');
  await mkdir(target, { recursive: true });
  await copyFile(path.join(sourceDir, names[0]), path.join(target, names[0]));
}

async function rightClick(client, point) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'right', clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'right', clickCount: 1,
  });
}

async function menuLabels(client) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const labels = await evaluate(client, `(() => {
      const menu = document.querySelector('[data-region="context-menu"]');
      if (!menu) return null;
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      if (items.length === 0) return null;
      return items.map((node) => node.getAttribute('aria-label') || '');
    })()`);
    if (labels !== null) {
      return labels;
    }
    await sleep(40);
  }
  return null;
}

async function closeMenu(client) {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await sleep(50);
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

test('spell check starts on, skips code, and the Tools toggle is saved', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-spell-'));
  await seedDictionary(userDataDir);
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

    const point = await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.replaceText('Say hllo there');
      const text = editor.querySelector('p')?.firstChild;
      if (!text || typeof text.textContent !== 'string') return null;
      const start = text.textContent.indexOf('hllo');
      if (start < 0) return null;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 4);
      const rect = range.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    assert.ok(point);
    const known = await evaluate(client, `(() => new Promise((resolve) => {
      const deadline = Date.now() + 2000;
      const tick = () => {
        const lookup = typeof window.obelisk['spell:lookup'] === 'function'
          ? window.obelisk['spell:lookup']('hllo')
          : null;
        if (lookup && lookup.misspelled === true) {
          resolve(lookup);
          return;
        }
        if (Date.now() > deadline) {
          resolve(lookup);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    }))()`);
    await rightClick(client, point);
    const suggestions = await menuLabels(client);
    assert.ok(suggestions);
    const checkerReady = known !== null && known.misspelled === true;
    if (checkerReady) {
      assert.equal(suggestions.includes('Add to dictionary'), true);
      assert.equal(suggestions.includes('Spelling suggestions'), false);
      assert.equal(suggestions.includes('hello'), true);
    } else {
      assert.equal(suggestions[0], 'Spelling suggestions');
    }
    await closeMenu(client);

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
    await rightClick(client, point);
    const hidden = await menuLabels(client);
    assert.ok(hidden);
    assert.equal(hidden[0], 'Spelling suggestions');
    assert.equal(hidden.includes('Add to dictionary'), false);
    await closeMenu(client);

    await clickSelector(client, '[data-menu="tools"]');
    await sleep(50);
    await clickSelector(client, '[data-item="tools-spelling"]');
    const restored = await evaluate(client, `(() => new Promise((resolve) => {
      const deadline = Date.now() + 2000;
      const tick = () => {
        const editor = document.querySelector('[data-region="page-editor"]');
        if (editor && editor.getAttribute('spellcheck') === 'true') {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    }))()`);
    assert.equal(restored, true);
    if (checkerReady) {
      const again = await evaluate(client, `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        const text = editor.querySelector('p')?.firstChild;
        const start = text && text.textContent ? text.textContent.indexOf('hllo') : -1;
        if (!text || start < 0) return null;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 4);
        const rect = range.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`);
      assert.ok(again);
      await rightClick(client, again);
      const back = await menuLabels(client);
      assert.ok(back);
      assert.equal(back.includes('hello'), true);
      assert.equal(back.includes('Add to dictionary'), true);
    }
  } finally {
    await finish();
  }
});
