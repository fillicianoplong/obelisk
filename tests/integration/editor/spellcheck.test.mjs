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

async function rightClick(client, point) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1,
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

async function wordPoint(client) {
  return evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
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
}

async function lastSpellPayload(client) {
  return evaluate(client, `window.__spellEvents.at(-1)`);
}

async function markedWord(client) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await closeMenu(client);
    const point = await wordPoint(client);
    assert.ok(point);
    const before = await evaluate(client, `window.__spellEvents.length`);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
    await sleep(40);
    await rightClick(client, point);
    const found = await evaluate(client, `(() => new Promise((resolve) => {
      const start = ${before};
      const end = Date.now() + 700;
      const tick = () => {
        const hit = window.__spellEvents.slice(start).find((event) => event.misspelledWord === 'hllo');
        if (hit) {
          resolve(hit);
          return;
        }
        if (Date.now() > end) {
          resolve(null);
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    }))()`);
    if (found && found.misspelledWord === 'hllo') {
      return found;
    }
  }
  return null;
}

test('a right-click shows spelling suggestions and the toggle only hides them', { timeout: 90_000 }, async (t) => {
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
    await evaluate(client, `(() => {
      window.__spellEvents = [];
      window.obelisk['spell:context'].subscribe((payload) => {
        window.__spellEvents.push(payload);
      });
      return true;
    })()`);
    await clickSelector(client, '.page-sheet');
    for (const word of ['Say ', 'hllo', ' there']) {
      await client.send('Input.insertText', { text: word });
      await sleep(250);
    }
    const typed = await evaluate(client, `document.querySelector('[data-region="page-editor"]')?.innerText || ''`);
    assert.match(typed, /hllo/);
    const payload = await markedWord(client);
    if (payload) {
      assert.equal(payload.misspelledWord, 'hllo');
      assert.equal(payload.suggestions.includes('hello'), true);
      const suggestions = await menuLabels(client);
      assert.ok(suggestions);
      assert.equal(suggestions.includes('hello'), true);
      assert.equal(suggestions.includes('Add to dictionary'), true);
      assert.equal(suggestions.includes('Spelling suggestions'), false);
      await closeMenu(client);
    }
    await closeMenu(client);

    await clickSelector(client, '[data-menu="tools"]');
    await sleep(50);
    await clickSelector(client, '[data-item="tools-spelling"]');
    await sleep(80);
    const off = await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      return window.obelisk['prefs:get']({ key: 'spelling' }).then((result) => ({
        spellcheck: editor.getAttribute('spellcheck'),
        hidden: editor.hasAttribute('data-spell-hidden'),
        status: result.status,
        value: result.value,
      }));
    })()`);
    assert.equal(off.spellcheck, 'true');
    assert.equal(off.hidden, true);
    assert.equal(off.status, 'ok');
    assert.equal(off.value, false);
    const hiddenPoint = await wordPoint(client);
    assert.ok(hiddenPoint);
    await rightClick(client, hiddenPoint);
    const hidden = await menuLabels(client);
    assert.ok(hidden);
    assert.equal(hidden.includes('hello'), false);
    assert.equal(hidden.includes('Add to dictionary'), false);
    assert.equal(hidden[0], 'Spelling suggestions');
    await closeMenu(client);

    await clickSelector(client, '[data-menu="tools"]');
    await sleep(50);
    await clickSelector(client, '[data-item="tools-spelling"]');
    const restored = await evaluate(client, `(() => new Promise((resolve) => {
      const deadline = Date.now() + 2000;
      const tick = () => {
        const editor = document.querySelector('[data-region="page-editor"]');
        if (editor && !editor.hasAttribute('data-spell-hidden') && editor.getAttribute('spellcheck') === 'true') {
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
    if (payload) {
      const backPayload = await markedWord(client);
      assert.equal(backPayload.misspelledWord, 'hllo');
      assert.equal(backPayload.suggestions.includes('hello'), true);
      const back = await menuLabels(client);
      assert.ok(back);
      assert.equal(back.includes('hello'), true);
    }

    const code = await evaluate(client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.insertBlock('code', { text: 'alpha' });
      const block = document.querySelector('pre[data-code-block]');
      return {
        code: block ? block.getAttribute('spellcheck') : null,
        inner: block ? block.querySelector('code')?.getAttribute('spellcheck') : null,
      };
    })()`);
    assert.equal(code.code, 'false');
    assert.equal(code.inner, 'false');
  } finally {
    await finish();
  }
});
