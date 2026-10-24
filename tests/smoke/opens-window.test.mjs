import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import electronImport from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function electronBinary(imported) {
  if (typeof imported === 'string' && imported.length > 0) {
    return imported;
  }
  if (imported && typeof imported === 'object' && typeof imported.default === 'string') {
    return imported.default;
  }
  throw new Error('Could not resolve the Electron binary from the electron package.');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a debugging port.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function launch(binary, args, userDataDir) {
  const child = spawn(binary, args, {
    cwd: root,
    detached: process.platform !== 'win32',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-16_000);
  });
  child.stdout?.on('data', (chunk) => {
    stdout = (stdout + chunk.toString()).slice(-8_000);
  });
  child.userDataDir = userDataDir;
  Object.defineProperty(child, 'output', {
    get() {
      return `${stdout}\n${stderr}`.trim();
    },
  });
  return child;
}

async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`DevTools list returned HTTP ${response.status}`);
  }
  const targets = await response.json();
  return targets.filter((target) => target.type === 'page');
}

async function waitForObeliskWindow(port, child) {
  const deadline = Date.now() + 45_000;
  let lastNote = 'debugger not up yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited early (${child.exitCode}). ${child.output}`);
    }
    try {
      const pages = await pageTargets(port);
      if (pages.length === 1 && pages[0].title === 'Obelisk') {
        return pages;
      }
      lastNote = `pages=${pages.length} titles=${pages.map((page) => page.title).join(', ')}`;
    } catch (error) {
      lastNote = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for one Obelisk window (${lastNote}). ${child.output}`);
}

test('the built app starts and opens one window', { timeout: 60_000 }, async () => {
  const binary = electronBinary(electronImport);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-smoke-'));
  const port = await freePort();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
  let child = launch(binary, args, userDataDir);

  try {
    try {
      await waitForObeliskWindow(port, child);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sandboxBlocked = /sandbox|namespace|chrome-sandbox/i.test(message);
      if (!sandboxBlocked || process.platform === 'win32') {
        throw error;
      }
      stopProcess(child);
      child = launch(binary, [...args, '--no-sandbox'], userDataDir);
      await waitForObeliskWindow(port, child);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    const pages = await pageTargets(port);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].title, 'Obelisk');
  } finally {
    stopProcess(child);
    await rm(userDataDir, { recursive: true, force: true });
  }
});
