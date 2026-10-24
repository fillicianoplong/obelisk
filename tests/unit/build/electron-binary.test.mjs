import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureElectronBinary } from '../../../scripts/electron-binary.mjs';
import { electronBinaryFrom } from '../../integration/electron-launch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), 'obelisk-electron-'));
}

async function writeInstall(packageRoot, source) {
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'install.js'), source);
}

test('a missing Electron install script fails with a clear message', async () => {
  const directory = await tempRoot();
  try {
    assert.throws(
      () => ensureElectronBinary(directory),
      /The Electron binary is missing\. node_modules\/electron\/install\.js is not in this install/,
    );
    assert.throws(() => electronBinaryFrom(directory), /The Electron binary is missing\./);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed Electron install fails with a clear message', async () => {
  const directory = await tempRoot();
  const packageRoot = path.join(directory, 'node_modules', 'electron');
  try {
    await writeInstall(packageRoot, 'process.exit(1);\n');
    assert.throws(
      () => ensureElectronBinary(directory),
      /The Electron binary is missing\. node node_modules\/electron\/install\.js exited 1\./,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an Electron install that writes no executable fails with a clear message', async () => {
  const directory = await tempRoot();
  const packageRoot = path.join(directory, 'node_modules', 'electron');
  try {
    await writeInstall(
      packageRoot,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron.exe');",
        '',
      ].join('\n'),
    );
    assert.throws(
      () => ensureElectronBinary(directory),
      /finished without writing the executable named in node_modules\/electron\/path\.txt/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one Electron install leaves a single executable path', async () => {
  const directory = await tempRoot();
  const packageRoot = path.join(directory, 'node_modules', 'electron');
  const marker = path.join(directory, 'install-count.txt');
  try {
    await writeInstall(
      packageRoot,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `const marker = ${JSON.stringify(marker)};`,
        "const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;",
        "fs.writeFileSync(marker, String(count + 1));",
        "const dist = path.join(__dirname, 'dist');",
        "fs.mkdirSync(dist, { recursive: true });",
        "fs.writeFileSync(path.join(dist, 'electron.exe'), '');",
        "fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron.exe');",
        '',
      ].join('\n'),
    );
    const binary = ensureElectronBinary(directory);
    assert.equal(binary, path.join(packageRoot, 'dist', 'electron.exe'));
    assert.equal(electronBinaryFrom(directory), binary);
    assert.equal(await readFile(marker, 'utf8'), '1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Electron launch tests do not import the electron package', async () => {
  const files = [
    'scripts/electron-binary.mjs',
    'scripts/run-tests.mjs',
    'tests/integration/electron-launch.mjs',
    'tests/integration/smoke/opens-window.test.mjs',
    'tests/integration/security/window-baseline.test.mjs',
    'tests/integration/shell/window-shell.test.mjs',
  ];
  const importsElectron = /(?:from\s+|require\(\s*|import\(\s*)['"]electron['"]/;
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.equal(importsElectron.test(source), false, `${file} imports the electron package`);
  }

  const runner = await readFile(path.join(root, 'scripts/run-tests.mjs'), 'utf8');
  const ensureAt = runner.indexOf('ensureElectronBinary(');
  const testFlagAt = runner.indexOf("'--test'");
  assert.ok(ensureAt > 0, 'the test runner does not install the Electron binary');
  assert.ok(testFlagAt > ensureAt, 'Electron is installed after tests have already started');
  assert.match(runner, /--test-concurrency=1/);
  assert.match(runner, /opens-window\.test\.mjs/);
  assert.match(runner, /window-baseline\.test\.mjs/);
});
