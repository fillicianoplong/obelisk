import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const childScript = path.join(here, 'kill-save-child.mjs');
const RUNS = 20;
const OLD_LENGTH = 64;
const NEW_LENGTH = 8 * 1024 * 1024;
const OLD_FILL = 0x11;
const NEW_FILL = 0x22;
const TEMP_FILE_PATTERN = /^\.~obk-[0-9a-f]{32}\.tmp$/;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFill(bytes, fill) {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== fill) {
      return false;
    }
  }
  return true;
}

function outcome(bytes) {
  if (bytes.length === OLD_LENGTH && isFill(bytes, OLD_FILL)) {
    return 'old';
  }
  if (bytes.length === NEW_LENGTH && isFill(bytes, NEW_FILL)) {
    return 'new';
  }
  return `partial length ${bytes.length}`;
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return true;
    }
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function spawnNode(args, options = {}) {
  return spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });
}

function collect(stream) {
  let text = '';
  stream?.on('data', (chunk) => {
    text += chunk.toString();
  });
  return () => text;
}

async function holdTarget(target, heldFile, releaseFile) {
  const script = `
param(
  [Parameter(Mandatory = $true)][string] $Target,
  [Parameter(Mandatory = $true)][string] $Held,
  [Parameter(Mandatory = $true)][string] $Release
)
$ErrorActionPreference = 'Stop'
$stream = New-Object System.IO.FileStream(
  $Target,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)
try {
  Set-Content -LiteralPath $Held -Value 'held' -Encoding ascii
  while (-not (Test-Path -LiteralPath $Release)) {
    Start-Sleep -Milliseconds 30
  }
} finally {
  $stream.Dispose()
}
`;
  const scriptFile = path.join(path.dirname(target), 'hold-open.ps1');
  await writeFile(scriptFile, script);
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-Target', target, '-Held', heldFile, '-Release', releaseFile],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const stderr = collect(child.stderr);
  await waitFor(async () => {
    try {
      await stat(heldFile);
      return true;
    } catch {
      return false;
    }
  }, 30000, 'the file lock').catch((error) => {
    child.kill();
    throw new Error(`${error.message} exit ${child.exitCode ?? 'running'} ${stderr()}`);
  });
  return child;
}

async function oneRun(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-kill-'));
  const target = path.join(dir, 'paper.obk');
  const readyFile = path.join(dir, 'ready');
  const doneFile = path.join(dir, 'done');
  const heldFile = path.join(dir, 'held');
  const releaseFile = path.join(dir, 'release');
  await writeFile(target, Buffer.alloc(OLD_LENGTH, OLD_FILL));

  let holder = null;
  let child = null;
  try {
    if (process.platform === 'win32') {
      holder = await holdTarget(target, heldFile, releaseFile);
    }
    child = spawnNode([childScript, target, readyFile, doneFile, String(NEW_LENGTH), String(NEW_FILL)]);
    const stderr = collect(child.stderr);
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await waitFor(async () => {
      try {
        await stat(readyFile);
        return true;
      } catch {
        return false;
      }
    }, 15000, `run ${run} to start the save`);

    await waitFor(async () => {
      if (child.exitCode !== null) {
        return true;
      }
      const names = await readdir(dir);
      return names.some((name) => TEMP_FILE_PATTERN.test(name));
    }, 15000, `run ${run} to open its temp file`).catch(() => undefined);

    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    await exited;
    if (holder) {
      await writeFile(releaseFile, 'release').catch(() => undefined);
      await Promise.race([
        new Promise((resolve) => {
          holder.once('exit', resolve);
        }),
        delay(2000),
      ]);
      holder.kill();
      holder = null;
    }
    const bytes = await readFile(target);
    const kind = outcome(bytes);
    if (kind !== 'old' && kind !== 'new') {
      throw new Error(`Run ${run} left ${kind}. ${stderr()}`);
    }
    return kind;
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
    }
    if (holder) {
      await writeFile(releaseFile, 'release').catch(() => undefined);
      holder.kill();
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('ending the process during 20 large saves leaves the old or the complete new file', { timeout: 180_000 }, async (t) => {
  let oldCount = 0;
  let newCount = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const kind = await oneRun(run);
    if (kind === 'old') {
      oldCount += 1;
    } else {
      newCount += 1;
    }
  }
  t.diagnostic(`${oldCount} kept the previous file, ${newCount} landed the complete new file.`);
  assert.equal(oldCount + newCount, RUNS);
  // On Windows the target is held without sharing delete, so the rename cannot
  // finish before the process is killed. Every run keeps the previous file.
  if (process.platform === 'win32') {
    assert.equal(oldCount, RUNS);
  }
});
