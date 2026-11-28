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
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`],
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

test('Settings tab lists SRS preference controls', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-prefs-tab-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const client = await launchApp(session, await freePort());
    await evaluate(client, `document.getElementById('menu-top-tools')?.click()`);
    await sleep(50);
    await evaluate(client, `document.querySelector('[data-item="tools-settings"]')?.click()`);
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let labels = null;
    while (Date.now() < deadline) {
      labels = await evaluate(client, `(() => {
        const panel = document.querySelector('[data-preferences]:not([data-preferences="loading"])');
        if (!panel) return null;
        const rows = [...panel.querySelectorAll('.preferences-label, .preferences-legend')].map((n) => n.textContent?.trim());
        const themes = [...panel.querySelectorAll('input[name="preferences-theme"]')].map((n) => n.value);
        if (themes.length === 0) return null;
        return { rows, themes };
      })()`);
      if (labels !== null) {
        break;
      }
      await sleep(30);
    }
    assert.ok(labels, 'preferences panel');
    assert.deepEqual(labels.themes.sort(), ['dark', 'light', 'match-windows']);
    assert.ok(labels.rows.some((row) => row === 'Theme'));
    assert.ok(labels.rows.some((row) => row === 'Spelling'));
    assert.ok(labels.rows.some((row) => row === 'Default font'));
    assert.ok(labels.rows.some((row) => row === 'Default font size'));
    assert.ok(labels.rows.some((row) => row === 'Restore tabs on launch'));
    assert.ok(labels.rows.some((row) => row === 'Show page edges in Pages view'));
  } finally {
    await finish();
  }
});