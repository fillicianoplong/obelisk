import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest, minimalDocument } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import {
  bindLaunchedApp,
  closeElectron,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  waitFor,
} from '../electron-launch.mjs';

const SHELL_READY = `(() => {
  const strip = document.querySelector('[role="tablist"]');
  if (document.documentElement.dataset.shellCommands !== 'ready' || !strip) {
    return null;
  }
  const tabs = [...strip.querySelectorAll('[role="tab"]')].map((tab) => ({
    title: tab.getAttribute('data-title'),
    selected: tab.getAttribute('aria-selected') === 'true',
    id: tab.getAttribute('data-tab-id'),
  }));
  const notice = document.querySelector('.open-notice-text');
  return {
    tabs,
    message: notice ? notice.textContent : null,
  };
})()`;

async function writeObk(filePath) {
  const encoded = await encodeObk(minimalDocument(), emptyManifest('0.1.63.0'));
  assert.equal(encoded.ok, true);
  await writeFile(filePath, encoded.bytes);
}

async function launchApp(userDataDir) {
  const port = await freePort();
  const child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const page = (await debuggerTargets(port)).find((target) => target.type === 'page');
          if (!page?.webSocketDebuggerUrl || page.title !== 'Obelisk') {
            return null;
          }
          const client = openCdp(page.webSocketDebuggerUrl);
          const ready = await evaluate(client, SHELL_READY);
          client.close();
          return ready;
        },
        30_000,
      );
    },
  });
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl);
  const client = openCdp(page.webSocketDebuggerUrl);
  return { child, client, port };
}

async function sessionFixture(directory) {
  const first = path.join(directory, 'alpha.obk');
  const second = path.join(directory, 'bravo.obk');
  await writeObk(first);
  await writeObk(second);
  await writeFile(
    path.join(directory, 'preferences.json'),
    `${JSON.stringify({
      version: 1,
      theme: 'match-windows',
      spelling: true,
      defaultFont: 'Liberation Serif',
      defaultSize: 12,
      restoreTabs: true,
      showPageEdges: true,
      zoom: 100,
      view: 'pages',
    })}\n`,
  );
  await writeFile(
    path.join(directory, 'session.json'),
    `${JSON.stringify({
      version: 1,
      paths: [first, second],
      activePath: second,
    })}\n`,
  );
  return { first, second };
}

test('AC-31: restore tabs reopens saved files in order with the active tab', { timeout: 120_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-restore-tabs-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const { first, second } = await sessionFixture(userDataDir);
  try {
    const { child, client } = await launchApp(userDataDir);
    session.child = child;
    session.client = client;
    const view = await evaluate(client, SHELL_READY);
    assert.equal(view.tabs.length, 2);
    assert.equal(view.tabs[0].title, 'alpha.obk');
    assert.equal(view.tabs[1].title, 'bravo.obk');
    assert.equal(view.tabs[1].selected, true);
    assert.equal(view.message, null);
    await closeElectron(child, undefined);
    session.client?.close();
    await unlink(second);
    const restarted = await launchApp(userDataDir);
    session.child = restarted.child;
    session.client = restarted.client;
    const after = await evaluate(restarted.client, SHELL_READY);
    assert.equal(after.tabs.length, 1);
    assert.equal(after.tabs[0].title, 'alpha.obk');
    assert.equal(after.tabs[0].selected, true);
    assert.match(after.message, /bravo\.obk could not be found/);
    const sessionText = await readFile(path.join(userDataDir, 'session.json'), 'utf8');
    assert.equal(sessionText.includes(first), true);
  } finally {
    await finish();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});