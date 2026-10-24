import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronImport from 'electron';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OUTPUT_LIMIT = 200_000;

export function electronBinary() {
  if (typeof electronImport === 'string' && electronImport.length > 0) {
    return electronImport;
  }
  if (electronImport && typeof electronImport === 'object' && typeof electronImport.default === 'string') {
    return electronImport.default;
  }
  throw new Error('Could not resolve the Electron binary from the electron package.');
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

export function stopProcess(child) {
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

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function launch(binary, args, env = {}) {
  let lastError;
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
    stopProcess(child);
    if (!sandboxBlocked || process.platform === 'win32') {
      throw error;
    }
  }

  child = launch(binary, [...args, '--no-sandbox'], env);
  try {
    await ready(child);
    return child;
  } catch (error) {
    stopProcess(child);
    throw error;
  }
}
