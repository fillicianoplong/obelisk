import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readAppFile } from '../../../dist/main/security/app-files.js';
import { resolveAppFile } from '../../../dist/main/security/app-path.js';
import { CONTENT_SECURITY_POLICY } from '../../../dist/main/security/csp.js';
import { isAllowedRequestUrl } from '../../../dist/main/security/request-policy.js';
import { secureWebPreferences } from '../../../dist/main/security/window-options.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ARCHITECTURE_POLICY = [
  "default-src 'none'",
  "script-src app:",
  "style-src app:",
  "font-src app:",
  "img-src app: data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

test('CSP string matches the architecture policy', () => {
  assert.equal(CONTENT_SECURITY_POLICY, ARCHITECTURE_POLICY);
  assert.equal(CONTENT_SECURITY_POLICY.includes('unsafe-inline'), false);
  assert.equal(CONTENT_SECURITY_POLICY.includes('unsafe-eval'), false);
  assert.equal(CONTENT_SECURITY_POLICY.includes('http:'), false);
  assert.equal(CONTENT_SECURITY_POLICY.includes('https:'), false);
});

test('request filter allows only app, data, and blob URLs', () => {
  assert.equal(isAllowedRequestUrl('app://obelisk/index.html'), true);
  assert.equal(isAllowedRequestUrl('data:text/plain,hi'), true);
  assert.equal(isAllowedRequestUrl('blob:app://obelisk/11111111-1111-1111-1111-111111111111'), true);
  for (const url of [
    'http://example.invalid/obelisk-probe',
    'https://example.invalid/obelisk-probe',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ws://example.invalid/socket',
    'wss://example.invalid/socket',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'about:blank',
    'ftp://example.invalid/file',
  ]) {
    assert.equal(isAllowedRequestUrl(url), false, url);
  }
  assert.equal(isAllowedRequestUrl('not a url'), false);
  assert.equal(isAllowedRequestUrl(''), false);
});

test('app protocol paths stay inside the renderer root', () => {
  const rendererRoot = path.resolve(root, 'dist/renderer');
  assert.equal(
    resolveAppFile(rendererRoot, 'app://obelisk/index.html'),
    path.join(rendererRoot, 'index.html'),
  );
  assert.equal(
    resolveAppFile(rendererRoot, 'app://obelisk/assets/main.js'),
    path.join(rendererRoot, 'assets', 'main.js'),
  );
  assert.equal(resolveAppFile(rendererRoot, 'app://Obelisk/index.html'), path.join(rendererRoot, 'index.html'));
  // The URL parser drops dot segments that would climb out of the host path,
  // so these stay inside the renderer root instead of reaching the repo root.
  for (const url of [
    'app://obelisk/../package.json',
    'app://obelisk/foo/../../package.json',
    'app://obelisk/%2e%2e/package.json',
  ]) {
    assert.equal(resolveAppFile(rendererRoot, url), path.join(rendererRoot, 'package.json'), url);
  }

  for (const url of [
    'app://obelisk/assets/..%2F..%2Fpackage.json',
    'app://obelisk/..%5C..%5Cpackage.json',
    'app://obelisk/C:/Windows/system32/calc.exe',
    'app://obelisk/C%3A/Windows/system32',
    'app://obelisk/index.html%00.png',
    'app://evil.example/index.html',
    'app://user:pass@obelisk/index.html',
    'app:///etc/passwd',
    'file:///etc/passwd',
    'https://example.invalid/index.html',
    'app://obelisk/',
    'app://obelisk',
  ]) {
    assert.equal(resolveAppFile(rendererRoot, url), null, url);
  }
});

test('app file reads refuse symlinks that leave the root', async (t) => {
  const rendererRoot = await mkdtemp(path.join(tmpdir(), 'obelisk-app-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'obelisk-outside-'));
  try {
    await writeFile(path.join(rendererRoot, 'index.html'), '<h1>Obelisk</h1>');
    await writeFile(path.join(rendererRoot, 'note.exe'), 'nope');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');

    const page = await readAppFile(rendererRoot, 'app://obelisk/index.html');
    assert.ok(page);
    assert.equal(page.data.toString('utf8'), '<h1>Obelisk</h1>');
    assert.match(page.mime, /^text\/html/);
    assert.equal(await readAppFile(rendererRoot, 'app://obelisk/missing.html'), null);
    assert.equal(await readAppFile(rendererRoot, 'app://obelisk/note.exe'), null);

    try {
      await symlink(path.join(outside, 'secret.txt'), path.join(rendererRoot, 'leak.txt'));
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : '';
      if (code === 'EPERM' || code === 'EACCES') {
        t.skip('this environment cannot create symlinks');
        return;
      }
      throw error;
    }

    assert.equal(await readAppFile(rendererRoot, 'app://obelisk/leak.txt'), null);
  } finally {
    await rm(rendererRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('window options enable the sandbox and disable Node and webviews', () => {
  const preferences = secureWebPreferences(path.join(root, 'dist/preload/index.js'));
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.nodeIntegrationInWorker, false);
  assert.equal(preferences.nodeIntegrationInSubFrames, false);
  assert.equal(preferences.webviewTag, false);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.allowRunningInsecureContent, false);
  assert.equal(preferences.experimentalFeatures, false);
  assert.equal(preferences.navigateOnDragDrop, false);
});

test('main does not load file:// or start a crash reporter or updater', async () => {
  const mainDir = path.join(root, 'src/main');
  const files = await sourceFiles(mainDir);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    assert.equal(source.includes('loadFile('), false, relative);
    assert.equal(source.includes('crashReporter'), false, relative);
    assert.equal(source.includes('autoUpdater'), false, relative);
  }
  const entry = await readFile(path.join(mainDir, 'index.ts'), 'utf8');
  assert.match(entry, /loadURL\(APP_START_URL\)/);
  assert.match(entry, /registerAppScheme\(/);
  assert.match(entry, /installAppProtocol\(/);
  assert.match(entry, /installSessionSecurity\(/);
  assert.match(entry, /secureWebPreferences\(/);
  assert.match(entry, /installContentsGuards\(/);
});

async function sourceFiles(dir) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(fullPath)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}
