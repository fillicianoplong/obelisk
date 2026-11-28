import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

const READY = `(() => {
  const title = document.querySelector('[data-region="title-bar"]');
  const page = document.querySelector('.page-sheet');
  if (!title || !page || !window.obeliskTheme || document.title !== 'Obelisk') {
    return null;
  }
  return true;
})()`;

function themeProbe() {
  return `(async () => {
    const result = await window.obeliskTheme.get();
    return {
      attribute: document.documentElement.getAttribute('data-theme'),
      result,
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

async function launch(session) {
  const port = await freePort();
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
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
  return { client, port };
}

test('FR-06: Dark theme set through prefs survives a restart', { timeout: 120_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-prefs-dark-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const { client } = await launch(session);
    const set = await evaluate(
      client,
      `window.obelisk['prefs:set']({ key: 'theme', value: 'dark' })`,
    );
    assert.equal(set.status, 'ok');
    const saved = JSON.parse(await readFile(path.join(userDataDir, 'preferences.json'), 'utf8'));
    assert.equal(saved.theme, 'dark');

    await closeElectron(session.child, undefined);
    session.child = undefined;
    session.client?.close();
    session.client = undefined;

    const { client: restarted } = await launch(session);
    const after = await evaluate(restarted, themeProbe());
    assert.equal(after.attribute, 'dark', JSON.stringify(after));
    assert.deepEqual(after.result, { status: 'ok', theme: 'dark' });
  } finally {
    await finish();
  }
});