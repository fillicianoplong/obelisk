import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isInsideDirectory, SMOKE_MARKER_FILE } from '../../../dist/main/security/app-data.js';
import {
  bindLaunchedApp,
  electronBinary,
  launch,
  sleep,
  stopElectron,
} from '../electron-launch.mjs';

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function field(text, key) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  assert.ok(line, `${key} is missing from the smoke marker`);
  return line.slice(key.length + 1);
}

async function treeStamp(directory) {
  const rows = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const info = await stat(full);
        rows.push(`${path.relative(directory, full)}|${info.size}`);
      }
    }
  }
  await walk(directory);
  rows.sort();
  return rows.join('\n');
}

async function waitForMarker(child, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Electron exited ${child.exitCode}. ${child.output}`);
    }
    try {
      return await readFile(marker, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    await sleep(100);
  }
  throw new Error(`Smoke marker missing. ${child.output}`);
}

function waitForCode(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function launchSmoke(binary, env, ready) {
  let child = launch(binary, ['.'], env);
  try {
    await ready(child);
    return child;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stopElectron(child);
    if (process.platform === 'win32' || !/sandbox|namespace|chrome-sandbox/i.test(message)) {
      throw error;
    }
  }

  child = launch(binary, ['.', '--no-sandbox'], env);
  try {
    await ready(child);
    return child;
  } catch (error) {
    await stopElectron(child);
    throw error;
  }
}

test('the app writes its marker under app data and not beside the executable', { timeout: 45_000 }, async (t) => {
  const binary = electronBinary();
  const installDir = path.dirname(binary);
  const before = await treeStamp(installDir);
  const home = await mkdtemp(path.join(tmpdir(), 'obelisk-appdata-'));
  const appData = process.platform === 'win32'
    ? path.join(home, 'AppData', 'Roaming')
    : path.join(home, '.config');
  await mkdir(appData, { recursive: true });
  await mkdir(path.join(home, 'local'), { recursive: true });
  const expectedUserData = path.join(appData, 'Obelisk');
  const marker = path.join(expectedUserData, SMOKE_MARKER_FILE);
  const session = { child: undefined, client: undefined, userDataDir: home };
  const finish = bindLaunchedApp(t, session);

  try {
    session.child = await launchSmoke(
      binary,
      {
        OBELISK_PACKAGED_SMOKE: '1',
        HOME: home,
        USERPROFILE: home,
        APPDATA: appData,
        LOCALAPPDATA: path.join(home, 'local'),
        XDG_CONFIG_HOME: appData,
        XDG_CACHE_HOME: path.join(home, 'cache'),
      },
      (running) => waitForMarker(running, marker, 20_000),
    );

    const text = await readFile(marker, 'utf8');
    const code = await waitForCode(session.child, 15_000);
    assert.equal(code, 0, session.child.output);
    assert.equal(samePath(field(text, 'userData'), expectedUserData), true);
    assert.equal(samePath(field(text, 'cwd'), expectedUserData), true);
    assert.equal(samePath(field(text, 'exe'), binary), true);
    assert.equal(isInsideDirectory(installDir, field(text, 'userData')), false);
    assert.equal(await treeStamp(installDir), before);
  } finally {
    await finish();
  }
});
