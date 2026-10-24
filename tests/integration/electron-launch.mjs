import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingElectronBinary, missingElectronBinaryMessage } from '../../scripts/electron-binary.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OUTPUT_LIMIT = 200_000;

export function electronBinaryFrom(root) {
  const binary = existingElectronBinary(root);
  if (!binary) {
    throw new Error(missingElectronBinaryMessage());
  }
  return binary;
}

export function electronBinary() {
  return electronBinaryFrom(repoRoot);
}

export function freePort() {
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

const PROCESS_EXIT_TIMEOUT_MS = 15_000;

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function stopProcess(child) {
  if (!child.pid || hasExited(child)) {
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

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (hasExited(child)) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    }
    child.once('exit', finish);
    if (hasExited(child)) {
      finish();
    }
  });
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitUntilPidExits(pid) {
  const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  while (Date.now() < deadline && pidExists(pid)) {
    await sleep(100);
  }
}

export async function stopElectron(child) {
  if (!child) {
    return;
  }
  const exited = waitForExit(child, PROCESS_EXIT_TIMEOUT_MS);
  stopProcess(child);
  await exited;
  if (child.pid) {
    await waitUntilPidExits(child.pid);
  }
}

export async function closeElectron(child, userDataDir) {
  await stopElectron(child);
  if (!userDataDir) {
    return;
  }
  await rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 15,
    retryDelay: 200,
  });
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function launch(binary, args, env = {}) {
  let lastError;
  // Linux returns ETXTBSY when exec hits a binary that is still being written.
  // Windows returns EBUSY for the same overlap. That case is not retried: the
  // test runner installs the binary once before these files start.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return startElectron(binary, args, env);
    } catch (error) {
      lastError = error;
      if (!error || error.code !== 'ETXTBSY') {
        throw error;
      }
      pause(250);
    }
  }
  throw lastError;
}

function startElectron(binary, args, env) {
  const child = spawn(binary, args, {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-OUTPUT_LIMIT);
  });
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-OUTPUT_LIMIT);
  });
  Object.defineProperty(child, 'output', {
    get() {
      return `${stdout}\n${stderr}`.trim();
    },
  });
  return child;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function debuggerTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`DevTools list returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function waitFor(child, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastNote = 'not ready';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited early (${child.exitCode}). ${child.output}`);
    }
    try {
      const result = await check();
      if (result) {
        return result;
      }
      lastNote = 'condition false';
    } catch (error) {
      lastNote = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`Timed out (${lastNote}). ${child.output}`);
}

export async function launchWithSandboxFallback({ binary, args, env, ready }) {
  let child = launch(binary, args, env);
  try {
    await ready(child);
    return child;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sandboxBlocked = /sandbox|namespace|chrome-sandbox/i.test(message);
    await stopElectron(child);
    if (!sandboxBlocked || process.platform === 'win32') {
      throw error;
    }
  }

  child = launch(binary, [...args, '--no-sandbox'], env);
  try {
    await ready(child);
    return child;
  } catch (error) {
    await stopElectron(child);
    throw error;
  }
}
