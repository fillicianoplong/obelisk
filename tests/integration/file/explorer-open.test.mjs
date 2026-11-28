import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import {
  emptyManifest,
  minimalDocument,
  paragraph,
  textRun,
} from '../../../scripts/make-hostile-fixtures/documents.mjs';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launch,
  launchWithSandboxFallback,
  openCdp,
  waitFor,
} from '../electron-launch.mjs';

const READ_SHELL = `(() => {
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  const list = document.querySelector('[role="tablist"]');
  if (!list) return null;
  const tabs = [...list.querySelectorAll('[role="tab"]')].map((tab) => ({
    title: tab.getAttribute('data-title'),
    selected: tab.getAttribute('aria-selected') === 'true',
  }));
  const notice = document.querySelector('.open-notice-text');
  const windows = { length: 1 };
  return {
    tabs,
    notice: notice ? notice.textContent.trim() : null,
    windows,
  };
})()`;

async function writeObk(filePath, label) {
  const encoded = await encodeObk(
    minimalDocument([paragraph(3, [textRun(label)])]),
    emptyManifest('0.1.64.0'),
  );
  assert.equal(encoded.ok, true, encoded.message);
  await writeFile(filePath, encoded.bytes);
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

async function launchWithFiles(session, port, filePaths) {
  const binary = electronBinary();
  session.child = await launchWithSandboxFallback({
    binary,
    args: [
      '.',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${session.userDataDir}`,
      '--force-device-scale-factor=1',
      ...filePaths,
    ],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') {
            return null;
          }
          const client = await openPage(port, session);
          return evaluate(client, READ_SHELL);
        },
        25_000,
      );
    },
  });
  return openPage(port, session);
}

async function readShell(client, child) {
  return waitFor(child, () => evaluate(client, READ_SHELL), 10_000);
}

test('a cold start with an .obk path opens the file in one tab', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-explorer-cold-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const file = path.join(userDataDir, 'Explorer open.obk');

  try {
    await writeObk(file, 'From Explorer');
    const client = await launchWithFiles(session, await freePort(), [file]);
    const state = await readShell(client, session.child);
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].title, 'Explorer open.obk');
    assert.equal(state.tabs[0].selected, true);
    assert.equal(state.notice, null);
  } finally {
    await finish();
  }
});

test('a cold start with a missing .obk path shows the unreadable message', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-explorer-miss-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const missing = path.join(userDataDir, 'missing.obk');

  try {
    const client = await launchWithFiles(session, await freePort(), [missing]);
    const state = await readShell(client, session.child);
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].title, 'Untitled 1');
    assert.equal(state.notice, 'This file could not be read, so it was not opened.');
  } finally {
    await finish();
  }
});

test(
  'a second launch opens another file in the same window',
  { skip: process.platform !== 'win32' ? 'requestSingleInstanceLock needs Windows for this launch path' : false, timeout: 120_000 },
  async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-explorer-second-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const first = path.join(userDataDir, 'one.obk');
  const second = path.join(userDataDir, 'two.obk');

  try {
    await writeObk(first, 'One');
    await writeObk(second, 'Two');
    const port = await freePort();
    const client = await launchWithFiles(session, port, [first]);
    const afterFirst = await readShell(client, session.child);
    assert.equal(afterFirst.tabs.length, 1);
    assert.equal(afterFirst.tabs[0].title, 'one.obk');

    const binary = electronBinary();
    const otherData = await mkdtemp(path.join(tmpdir(), 'obelisk-explorer-second-user-'));
    const again = launch(binary, ['.', second, `--user-data-dir=${otherData}`]);
    await waitFor(again, () => again.exitCode !== null, 20_000);
    assert.equal(again.exitCode, 0);

    const afterSecond = await readShell(client, session.child);
    assert.equal(afterSecond.tabs.length, 2);
    assert.deepEqual(
      afterSecond.tabs.map((tab) => tab.title).sort(),
      ['one.obk', 'two.obk'],
    );
    assert.equal(afterSecond.tabs.find((tab) => tab.selected)?.title, 'two.obk');
    assert.equal(afterSecond.notice, null);
  } finally {
    await finish();
  }
  },
);

test('argv with flags and twenty-one .obk paths opens only the first twenty tabs', { timeout: 300_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-explorer-many-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const paths = [];
    for (let index = 0; index < 21; index += 1) {
      const file = path.join(userDataDir, `paper-${String(index + 1).padStart(2, '0')}.obk`);
      await writeObk(file, `Paper ${index + 1}`);
      paths.push(file);
    }
    const port = await freePort();
    const client = await launchWithFiles(session, port, [
      '--inspect',
      '--no-sandbox',
      userDataDir,
      ...paths,
    ]);
    const state = await waitFor(
      session.child,
      async () => {
        const next = await evaluate(client, READ_SHELL);
        if (next && next.tabs.length === 20) {
          return next;
        }
        return null;
      },
      120_000,
    );
    assert.equal(state.tabs.length, 20);
    assert.equal(state.tabs[0].title, 'paper-01.obk');
    assert.equal(state.tabs[19].title, 'paper-20.obk');
    assert.equal(state.tabs.find((tab) => tab.title === 'paper-21.obk'), undefined);
  } finally {
    await finish();
  }
});