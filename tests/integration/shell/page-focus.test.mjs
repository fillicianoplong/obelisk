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
  const page = document.querySelector('.page-sheet');
  const tab = document.querySelector('.tab-new');
  const menu = document.querySelector('.menu-button');
  if (!page || !tab || !menu || page.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

function ringExpression() {
  return `(() => {
    const page = document.querySelector('.page-sheet');
    const style = getComputedStyle(page);
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--color-focus-outer)';
    document.body.appendChild(swatch);
    const token = getComputedStyle(swatch).color;
    swatch.style.color = 'Highlight';
    const highlight = getComputedStyle(swatch).color;
    swatch.remove();
    return {
      active: document.activeElement === page,
      source: page.getAttribute('data-focus-source'),
      focusVisible: page.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      token,
      highlight,
      forced: window.matchMedia('(forced-colors: active)').matches,
    };
  })()`;
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

async function clickPage(client) {
  const point = await evaluate(
    client,
    `(() => {
      const rect = document.querySelector('.page-sheet').getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + Math.min(48, rect.height / 2)),
      };
    })()`,
  );
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function clickMenu(client) {
  const point = await evaluate(
    client,
    `(() => {
      const rect = document.querySelector('.menu-button').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  const event = {
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

function assertNoPageRing(state, label) {
  assert.equal(state.active, true, `${label} ${JSON.stringify(state)}`);
  assert.equal(state.source, null, `${label} ${JSON.stringify(state)}`);
  assert.equal(state.outlineStyle, 'none', `${label} ${JSON.stringify(state)}`);
  assert.equal(state.outlineWidth, '0px', `${label} ${JSON.stringify(state)}`);
}

function assertKeyboardRing(state, label) {
  assert.equal(state.active, true, `${label} ${JSON.stringify(state)}`);
  assert.equal(state.source, 'keyboard', `${label} ${JSON.stringify(state)}`);
  assert.equal(state.outlineStyle, 'solid', `${label} ${JSON.stringify(state)}`);
  assert.ok(parseFloat(state.outlineWidth) > 0, `${label} ${JSON.stringify(state)}`);
  const expected = state.forced ? state.highlight : state.token;
  assert.equal(state.outlineColor, expected, `${label} ${JSON.stringify(state)}`);
}

async function readRing(client) {
  return evaluate(client, ringExpression());
}

// The keyboard source is recorded on the focus event. Escape restores the page
// on a timer, and that timer is what records the source when the page is
// already focused. Read the ring after that settles.
async function settleRing(client, check, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    const state = await readRing(client);
    try {
      check(state, label);
      return state;
    } catch (error) {
      lastError = error;
    }
    await sleep(30);
  }
  throw lastError ?? new Error(`${label} did not settle within ${STEP_TIMEOUT_MS} ms`);
}

test('the page focus ring follows keyboard focus and stays off for a click', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-page-focus-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const binary = electronBinary();
    const port = await freePort();
    session.child = await launchWithSandboxFallback({
      binary,
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
        window.addEventListener('keydown', (event) => {
          if (event.key !== 'F6' && event.key !== 'Escape') {
            return;
          }
          const page = document.querySelector('.page-sheet');
          // A second focus() on the page does not fire a focus event, so the
          // keyboard source would stay unset. Leave and come back.
          if (document.activeElement === page) {
            page.blur();
          }
          page.focus();
        });
      })()`,
    );

    await clickPage(client);
    await settleRing(client, (state, label) => {
      assertNoPageRing(state, label);
      assert.equal(state.focusVisible, true, JSON.stringify(state));
    }, 'click');

    await evaluate(client, `document.querySelector('.tab-new').focus()`);
    await pressKey(client, 'Tab', 'Tab', 9);
    await settleRing(client, assertKeyboardRing, 'Tab');

    await clickPage(client);
    await settleRing(client, assertNoPageRing, 'click after keyboard focus');

    const menu = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('.menu-button');
        button.focus({ focusVisible: true });
        const style = getComputedStyle(button);
        const page = getComputedStyle(document.querySelector('.page-sheet'));
        return {
          buttonOutline: style.outlineStyle,
          buttonWidth: style.outlineWidth,
          pageOutline: page.outlineStyle,
          pageWidth: page.outlineWidth,
        };
      })()`,
    );
    assert.equal(menu.buttonOutline, 'solid', JSON.stringify(menu));
    assert.ok(parseFloat(menu.buttonWidth) > 0, JSON.stringify(menu));
    assert.equal(menu.pageOutline, 'none', JSON.stringify(menu));
    assert.equal(menu.pageWidth, '0px', JSON.stringify(menu));

    await pressKey(client, 'F6', 'F6', 117);
    await settleRing(client, assertKeyboardRing, 'F6');

    await clickMenu(client);
    await pressKey(client, 'F6', 'F6', 117, 8);
    await settleRing(client, assertKeyboardRing, 'Shift+F6');

    await clickMenu(client);
    await pressKey(client, 'Escape', 'Escape', 27);
    await settleRing(client, assertKeyboardRing, 'Escape');

    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    await clickPage(client);
    await settleRing(client, (state, label) => {
      assert.equal(state.forced, true, JSON.stringify(state));
      assertNoPageRing(state, label);
    }, 'contrast click');

    await clickMenu(client);
    await pressKey(client, 'Escape', 'Escape', 27);
    await settleRing(client, assertKeyboardRing, 'contrast Escape');
  } finally {
    await finish();
  }
});
