import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  freePort,
  launchWithSandboxFallback,
  waitFor,
} from '../electron-launch.mjs';

test('the built app starts and opens one window', { timeout: 45_000 }, async (t) => {
  const binary = electronBinary();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-smoke-'));
  const port = await freePort();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    session.child = await launchWithSandboxFallback({
      binary,
      args,
      ready(running) {
        return waitFor(
          running,
          async () => {
            const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
            return pages.length === 1 && pages[0].title === 'Obelisk';
          },
          20_000,
        );
      },
    });

    const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].title, 'Obelisk');
  } finally {
    await finish();
  }
});
