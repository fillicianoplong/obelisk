import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  debuggerTargets,
  electronBinary,
  freePort,
  launchWithSandboxFallback,
  sleep,
  stopProcess,
  waitFor,
} from '../electron-launch.mjs';

test('the built app starts and opens one window', { timeout: 60_000 }, async () => {
  const binary = electronBinary();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-smoke-'));
  const port = await freePort();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
  let child;

  try {
    child = await launchWithSandboxFallback({
      binary,
      args,
      ready(running) {
        return waitFor(
          running,
          async () => {
            const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
            return pages.length === 1 && pages[0].title === 'Obelisk';
          },
          45_000,
        );
      },
    });

    await sleep(500);
    const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].title, 'Obelisk');
  } finally {
    if (child) {
      stopProcess(child);
    }
    await rm(userDataDir, { recursive: true, force: true });
  }
});
