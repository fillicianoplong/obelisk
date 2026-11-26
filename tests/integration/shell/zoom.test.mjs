import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  const frame = document.querySelector('.page-frame');
  const sheet = document.querySelector('.page-sheet');
  const zoom = document.querySelector('.status-zoom');
  if (!frame || !sheet || !zoom || !sheet.editorCommands) return null;
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  return true;
})()`;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} expected ${expected}`);
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function launchApp(session, port) {
  const binary = electronBinary();
  session.child = await launchWithSandboxFallback({
    binary,
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1'],
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
  return openPage(port, session);
}

async function click(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${selector} is not visible`);
  await click(client, point.x, point.y);
}

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  const event = { key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

async function settle(client) {
  const layout = await evaluate(
    client,
    `document.querySelector('.page-sheet').editorCommands.layoutPages()`,
  );
  await evaluate(
    client,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
  );
  return layout;
}

async function readZoom(client) {
  return evaluate(
    client,
    `(() => {
      const button = document.querySelector('.status-zoom');
      const frame = document.querySelector('.page-frame');
      const region = document.querySelector('.page-region');
      const sheet = document.querySelector('.page-sheet');
      const frameRect = frame ? frame.getBoundingClientRect() : { width: 0, left: 0 };
      const regionRect = region.getBoundingClientRect();
      let caretTop = null;
      try {
        caretTop = sheet.editorView.coordsAtPos(sheet.editorView.state.selection.head).top;
      } catch (error) {
        caretTop = null;
      }
      const menu = document.querySelector('#status-zoom-menu');
      const presets = menu
        ? [...menu.querySelectorAll('[data-zoom-preset]')].map((item) => ({
          label: (item.textContent || '').trim(),
          checked: item.getAttribute('aria-checked'),
        }))
        : [];
      return {
        label: (button.querySelector('.status-zoom-value')?.textContent || '').trim(),
        name: button.getAttribute('aria-label'),
        expanded: button.getAttribute('aria-expanded'),
        popup: button.getAttribute('aria-haspopup'),
        tooltip: (document.querySelector('#status-zoom-tooltip')?.textContent || '').trim(),
        width: Math.round(button.getBoundingClientRect().width),
        height: Math.round(button.getBoundingClientRect().height),
        frameWidth: frameRect.width,
        frameLeft: frameRect.left,
        regionLeft: regionRect.left,
        scrollLeft: region.scrollLeft,
        caretTop,
        focus: document.activeElement?.getAttribute('data-region') || document.activeElement?.className || '',
        pageLabel: (document.querySelector('[data-status-item="page"]')?.textContent || '').trim(),
        viewMode: region.getAttribute('data-page-view'),
        presets,
      };
    })()`,
  );
}

async function waitForZoom(client, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    await settle(client);
    last = await readZoom(client);
    if (last.label === label) {
      return last;
    }
    await sleep(40);
  }
  assert.fail(`zoom stayed ${JSON.stringify(last)}`);
}

async function savedZoom(directory) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = await readFile(path.join(directory, 'settings.json'), 'utf8');
      const parsed = JSON.parse(last);
      if (Object.hasOwn(parsed, 'zoom')) {
        return parsed.zoom;
      }
    } catch {
      // The file is written after the click.
    }
    await sleep(40);
  }
  assert.fail(`settings.json did not record zoom: ${last}`);
}

test('the zoom menu, shortcuts, and wheel step through presets and keep the caret', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-zoom-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    let zoom = await readZoom(client);
    assert.equal(zoom.label, '100%');
    assert.equal(zoom.name, 'Zoom 100%');
    assert.equal(zoom.popup, 'menu');
    assert.equal(zoom.expanded, 'false');
    assert.equal(zoom.tooltip, 'Zoom (Ctrl+wheel)');
    assert.equal(zoom.width, 60);
    assert.equal(zoom.height, 24);
    near(zoom.frameWidth, 816, '100% sheet');
    const caretBefore = zoom.caretTop;

    await clickSelector(client, '.status-zoom');
    zoom = await readZoom(client);
    assert.equal(zoom.expanded, 'true');
    assert.deepEqual(zoom.presets.map((item) => item.label), ['200%', '150%', '125%', '100%', '75%', '50%']);
    assert.equal(zoom.presets.find((item) => item.checked === 'true')?.label, '100%');

    await clickSelector(client, '[data-zoom-preset="150"]');
    zoom = await waitForZoom(client, '150%');
    assert.equal(zoom.expanded, 'false');
    assert.equal(zoom.focus, 'page-editor');
    near(zoom.frameWidth, 1224, '150% sheet');
    assert.ok(caretBefore !== null && zoom.caretTop !== null);
    assert.ok(Math.abs(zoom.caretTop - caretBefore) < 4, `caret moved from ${caretBefore} to ${zoom.caretTop}`);
    assert.equal(await savedZoom(userDataDir), 150);

    await pressKey(client, '-', 'Minus', 189, 2);
    zoom = await waitForZoom(client, '125%');
    await pressKey(client, '0', 'Digit0', 48, 2);
    zoom = await waitForZoom(client, '100%');
    near(zoom.frameWidth, 816, 'back to 100%');

    const point = await evaluate(
      client,
      `(() => {
        const region = document.querySelector('.page-region');
        const rect = region.getBoundingClientRect();
        return { x: Math.round(rect.left + 80), y: Math.round(rect.top + 80) };
      })()`,
    );
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -120,
      modifiers: 2,
    });
    zoom = await waitForZoom(client, '125%');
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -40,
      modifiers: 2,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -40,
      modifiers: 2,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -40,
      modifiers: 2,
    });
    zoom = await waitForZoom(client, '150%');

    await pressKey(client, '0', 'Digit0', 48, 2);
    await waitForZoom(client, '100%');
    await pressKey(client, '-', 'Minus', 189, 2);
    await pressKey(client, '-', 'Minus', 189, 2);
    zoom = await waitForZoom(client, '50%');
    near(zoom.frameWidth, 408, '50% sheet');
    assert.ok(zoom.frameLeft > zoom.regionLeft + 24, '50% sheet stays centred');
    await pressKey(client, '-', 'Minus', 189, 2);
    zoom = await waitForZoom(client, '50%');

    await pressKey(client, '0', 'Digit0', 48, 2);
    await waitForZoom(client, '100%');
    await pressKey(client, '+', 'Equal', 187, 2);
    await pressKey(client, '+', 'Equal', 187, 2);
    await pressKey(client, '+', 'Equal', 187, 2);
    zoom = await waitForZoom(client, '200%');
    near(zoom.frameWidth, 1632, '200% sheet');
    assert.equal(zoom.scrollLeft, 0);
    near(zoom.frameLeft - zoom.regionLeft, 24, '200% left edge');
    await pressKey(client, '+', 'Equal', 187, 2);
    zoom = await waitForZoom(client, '200%');

    const viewButton = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.menu-button')].find((node) => (node.textContent || '').trim().startsWith('View'));
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`,
    );
    assert.ok(viewButton, 'View menu is missing');
    await click(client, viewButton.x, viewButton.y);
    const menu = await evaluate(
      client,
      `(() => {
        const zoomIn = document.querySelector('[data-item="view-zoom-in"]');
        const zoomOut = document.querySelector('[data-item="view-zoom-out"]');
        const reset = document.querySelector('[data-item="view-zoom-100"]');
        if (!zoomIn || !zoomOut || !reset) return null;
        return {
          zoomIn: zoomIn.getAttribute('aria-disabled'),
          zoomOut: zoomOut.getAttribute('aria-disabled'),
          reset: reset.getAttribute('aria-disabled'),
        };
      })()`,
    );
    assert.ok(menu, 'zoom menu items are missing');
    assert.equal(menu.zoomIn, 'true');
    assert.equal(menu.zoomOut, null);
    assert.equal(menu.reset, null);
    await clickSelector(client, '[data-item="view-zoom-100"]');
    zoom = await waitForZoom(client, '100%');

    await evaluate(
      client,
      `(() => {
        const line = 'Cool roofs and street trees lower the heat on a long city block.';
        const parts = [];
        for (let index = 0; index < 80; index += 1) parts.push(line);
        document.querySelector('.page-sheet').editorCommands.replaceText(parts.join('\\n'));
        return true;
      })()`,
    );
    await settle(client);
    await evaluate(
      client,
      `(() => {
        const editor = document.querySelector('.page-sheet');
        const count = editor.editorCommands.blockSnapshot().length;
        editor.editorCommands.setParagraphCaret(count - 1, 0);
        return count;
      })()`,
    );
    const pages = await settle(client);
    assert.ok(pages.pageCount >= 2, JSON.stringify(pages));
    await sleep(50);
    zoom = await readZoom(client);
    assert.equal(zoom.pageLabel, pages.label);
    assert.match(zoom.pageLabel, /^Page [2-9] of /);

    await click(client, viewButton.x, viewButton.y);
    await clickSelector(client, '[data-item="view-pageless"]');
    const pageless = await settle(client);
    await sleep(50);
    zoom = await readZoom(client);
    assert.equal(zoom.viewMode, 'pageless');
    assert.equal(zoom.pageLabel, pageless.label);
    assert.match(zoom.pageLabel, /^Page \d+ of \d+$/);
  } finally {
    await finish();
  }
});

test('a saved zoom preset is restored and a non-preset falls back to 100%', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-zoom-saved-'));
  await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({ theme: 'dark', zoom: 150 })}\n`);
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    const zoom = await readZoom(client);
    assert.equal(zoom.label, '150%', 'the first paint already uses the saved zoom');
    near(zoom.frameWidth, 1224, 'restored 150% sheet');
    const kept = JSON.parse(await readFile(path.join(userDataDir, 'settings.json'), 'utf8'));
    assert.equal(kept.theme, 'dark');
    assert.equal(kept.zoom, 150);
  } finally {
    await finish();
  }

  const fallbackDir = await mkdtemp(path.join(tmpdir(), 'obelisk-zoom-fallback-'));
  await writeFile(path.join(fallbackDir, 'settings.json'), `${JSON.stringify({ zoom: 90, spelling: false })}\n`);
  const fallback = { child: undefined, client: undefined, userDataDir: fallbackDir };
  const finishFallback = bindLaunchedApp(t, fallback);
  try {
    const port = await freePort();
    const client = await launchApp(fallback, port);
    const zoom = await readZoom(client);
    assert.equal(zoom.label, '100%');
    near(zoom.frameWidth, 816, 'fallback sheet');
    await sleep(200);
    const kept = JSON.parse(await readFile(path.join(fallbackDir, 'settings.json'), 'utf8'));
    assert.equal(kept.zoom, 90);
    assert.equal(kept.spelling, false);
  } finally {
    await finishFallback();
  }
});
