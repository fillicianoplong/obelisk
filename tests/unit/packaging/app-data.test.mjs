import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APP_DATA_DIR_NAME,
  isInsideDirectory,
  resolveAppDataDir,
  SMOKE_MARKER_FILE,
} from '../../../dist/main/security/app-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('default app data is the Obelisk folder under app data', () => {
  assert.equal(APP_DATA_DIR_NAME, 'Obelisk');
  assert.equal(SMOKE_MARKER_FILE, 'smoke-write.txt');
  assert.equal(
    resolveAppDataDir('/home/ada/.config', '', '/home/ada', path.posix),
    '/home/ada/.config/Obelisk',
  );
  assert.equal(
    resolveAppDataDir('/home/ada/.config', '   ', '/home/ada', path.posix),
    '/home/ada/.config/Obelisk',
  );
  assert.equal(
    resolveAppDataDir('/tmp/appdata', 'profile', '/tmp/cwd', path.posix),
    '/tmp/cwd/profile',
  );
  assert.equal(
    resolveAppDataDir('/tmp/appdata', '/tmp/explicit', '/tmp/cwd', path.posix),
    '/tmp/explicit',
  );
});

test('app data for an MSIX install is outside the install folder', () => {
  const appData = 'C:\\Users\\Ada\\AppData\\Roaming';
  const userData = resolveAppDataDir(appData, '', 'C:\\Users\\Ada', path.win32);
  const install = 'C:\\Program Files\\WindowsApps\\Obelisk.Dev_0.1.0.0_x64__abc';
  assert.equal(userData, 'C:\\Users\\Ada\\AppData\\Roaming\\Obelisk');
  assert.equal(isInsideDirectory(install, userData, path.win32), false);
  assert.equal(isInsideDirectory(install, `${install}\\logs`, path.win32), true);
  assert.equal(isInsideDirectory(install.toLowerCase(), install, path.win32), true);
  assert.equal(
    isInsideDirectory('C:\\Program Files\\WindowsApps\\Other', userData, path.win32),
    false,
  );
  assert.equal(
    isInsideDirectory('D:\\Apps\\Obelisk', 'C:\\Users\\Ada\\AppData\\Roaming\\Obelisk', path.win32),
    false,
  );
});

test('writable paths are configured before the window starts', async () => {
  const entry = await readFile(path.join(root, 'src/main/index.ts'), 'utf8');
  const configureAt = entry.indexOf('configureWritablePaths()');
  const callAt = entry.lastIndexOf('startApp();');
  assert.ok(configureAt > 0);
  assert.ok(callAt > configureAt);
  const startBody = entry.slice(entry.indexOf('function startApp'), callAt);
  assert.match(startBody, /createWindow\(/);
  assert.match(startBody, /app\.whenReady\(/);
  const windowBody = entry.slice(entry.indexOf('function createWindow'), entry.indexOf('function startApp'));
  assert.match(windowBody, /new BrowserWindow\(/);
  assert.match(entry, /OBELISK_PACKAGED_SMOKE === '1'/);
  assert.match(entry, /SMOKE_MARKER_FILE/);
  const writable = await readFile(path.join(root, 'src/main/security/writable-paths.ts'), 'utf8');
  assert.match(writable, /setPath\('userData'/);
  assert.match(writable, /setPath\('sessionData'/);
  assert.match(writable, /setPath\('crashDumps'/);
  assert.match(writable, /setAppLogsPath/);
  assert.match(writable, /disk-cache-dir/);
  assert.match(writable, /process\.chdir\(userData\)/);
  assert.match(writable, /isInsideDirectory/);
});
