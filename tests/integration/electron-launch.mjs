import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingElectronBinary, missingElectronBinaryMessage } from '../../scripts/electron-binary.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OUTPUT_LIMIT = 200_000;
const DEVTOOLS_TIMEOUT_MS = 8_000;

export const STEP_TIMEOUT_MS = 8_000;

const liveChildren = new Set();
const closingApps = new Map();

process.on('exit', () => {
  for (const child of liveChildren) {
    stopProcess(child);
  }
});

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
  if (!child?.pid || hasExited(child)) {
    return;
  }
  if (process.platform === 'win32') {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    if (killed.status !== 0) {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process tree is already gone.
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process tree is already gone.
    }
  }
}

export function killElectronTree(child) {
  stopProcess(child);
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

async function closeElectronOnce(child, userDataDir) {
  await stopElectron(child);
  if (child && hasExited(child)) {
    liveChildren.delete(child);
  }
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

export async function closeElectron(child, userDataDir) {
  const key = userDataDir ?? `pid:${child?.pid ?? 'none'}`;
  const existing = closingApps.get(key);
  if (existing) {
    await existing;
    return;
  }
  const job = closeElectronOnce(child, userDataDir);
  closingApps.set(key, job);
  try {
    await job;
  } finally {
    if (closingApps.get(key) === job) {
      closingApps.delete(key);
    }
  }
}

export function bindLaunchedApp(t, resources) {
  let finished = false;
  const killTree = () => {
    try {
      resources.client?.close?.();
    } catch {
      // The DevTools socket may already be closed.
    }
    // The child may not be stored yet when a launch step is still waiting.
    for (const child of liveChildren) {
      killElectronTree(child);
    }
    killElectronTree(resources.child);
  };
  t.signal.addEventListener('abort', killTree);
  t.after(async () => {
    killTree();
    if (finished) {
      return;
    }
    finished = true;
    await closeElectron(resources.child, resources.userDataDir);
  });
  return async function finishLaunch() {
    if (finished) {
      return;
    }
    finished = true;
    killTree();
    await closeElectron(resources.child, resources.userDataDir);
  };
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
  liveChildren.add(child);
  child.once('exit', () => {
    liveChildren.delete(child);
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

export async function debuggerTargets(port, timeoutMs = 2_000) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`DevTools list returned HTTP ${response.status}`);
  }
  return response.json();
}

function suspended(detail) {
  return `${detail} The renderer may be suspended because the session is locked or the window is not in the foreground.`;
}

export function openCdp(wsUrl, timeoutMs = DEVTOOLS_TIMEOUT_MS) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== 'function') {
    throw new Error('This Node version has no WebSocket client.');
  }
  const ws = new Socket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  let failed = false;
  let openedSettled = false;

  function failPending(error) {
    if (failed) {
      return;
    }
    failed = true;
    for (const [, call] of pending) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    pending.clear();
  }

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) {
      events.push(message);
      return;
    }
    const call = pending.get(message.id);
    if (!call) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) {
      call.reject(new Error(JSON.stringify(message.error)));
      return;
    }
    call.resolve(message.result);
  });

  let rejectOpened = () => {};
  let openTimer;
  const opened = new Promise((resolve, reject) => {
    rejectOpened = reject;
    openTimer = setTimeout(() => {
      if (openedSettled) {
        return;
      }
      openedSettled = true;
      reject(new Error(suspended(`DevTools socket did not open within ${timeoutMs} ms.`)));
      try {
        ws.close();
      } catch {
        // The socket is already closing.
      }
    }, timeoutMs);
    ws.addEventListener('open', () => {
      if (openedSettled) {
        return;
      }
      openedSettled = true;
      clearTimeout(openTimer);
      resolve();
    });
    ws.addEventListener('error', () => {
      if (!openedSettled) {
        openedSettled = true;
        clearTimeout(openTimer);
        reject(new Error('DevTools socket failed.'));
      }
      failPending(new Error('DevTools socket failed.'));
    });
    ws.addEventListener('close', () => {
      if (!openedSettled) {
        openedSettled = true;
        clearTimeout(openTimer);
        reject(new Error('DevTools socket closed.'));
      }
      failPending(new Error('DevTools socket closed.'));
    });
  });
  opened.catch(() => {
    // send() reports the same failure. This keeps an early socket error from being unhandled.
  });

  return {
    events,
    url: wsUrl,
    async send(method, params = {}) {
      await opened;
      if (failed || ws.readyState !== Socket.OPEN) {
        throw new Error('DevTools socket closed.');
      }
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(suspended(`DevTools ${method} did not answer within ${timeoutMs} ms.`)));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      ws.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      clearTimeout(openTimer);
      if (!openedSettled) {
        openedSettled = true;
        rejectOpened(new Error('DevTools socket closed.'));
      }
      failPending(new Error('DevTools socket closed.'));
      try {
        ws.close();
      } catch {
        // The socket is already closing.
      }
    },
  };
}

export async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

export async function waitFor(child, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastNote = 'not ready';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited early (${child.exitCode}). ${child.output}`);
    }
    const remaining = Math.max(1, deadline - Date.now());
    let timedOut = false;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => check()),
        sleep(remaining).then(() => {
          timedOut = true;
          return null;
        }),
      ]);
      if (timedOut) {
        break;
      }
      if (result) {
        return result;
      }
      lastNote = 'condition false';
    } catch (error) {
      lastNote = error instanceof Error ? error.message : String(error);
    }
    const pause = Math.min(200, Math.max(0, deadline - Date.now()));
    if (pause === 0) {
      break;
    }
    await sleep(pause);
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
