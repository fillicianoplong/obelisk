import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { rendererImportBanMessage } from '../../../scripts/renderer-import-ban.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lintRenderer(filename, source) {
  return spawnSync(process.execPath, [eslintBin, '--stdin', '--stdin-filename', filename], {
    cwd: root,
    input: source,
    encoding: 'utf8',
  });
}

test('lint fails when a renderer file imports fs', () => {
  const result = lintRenderer(
    path.join('src', 'renderer', 'fs-import-probe.ts'),
    "import fs from 'fs';\nexport const disk = fs;\n",
  );
  assert.notEqual(result.status, 0);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /fs-import-probe\.ts/);
  assert.match(output, new RegExp(rendererImportBanMessage));
});

test('lint fails for other Node built-ins and Electron main APIs', () => {
  const samples = [
    ["import { readFile } from 'fs/promises';\nexport const read = readFile;\n", 'fs-promises-probe.ts'],
    ["import fs from 'node:fs';\nexport const disk = fs;\n", 'node-fs-probe.ts'],
    ["import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n", 'node-fs-promises-probe.ts'],
    ["import test from 'node:test';\nexport const runner = test;\n", 'node-test-probe.ts'],
    ["import { app } from 'electron';\nexport const mainApp = app;\n", 'electron-probe.ts'],
    ["import { app } from 'electron/main';\nexport const mainApp = app;\n", 'electron-main-probe.ts'],
    ["import type { PathLike } from 'fs';\nexport type DiskPath = PathLike;\n", 'fs-type-probe.ts'],
    ["declare function require(name: string): unknown;\nconst fs = require('fs');\nexport const disk = fs;\n", 'require-fs-probe.ts'],
    ["declare function require(name: string): unknown;\nconst electron = require('electron/main');\nexport const mainApi = electron;\n", 'require-electron-probe.ts'],
    ["import fs = require('fs');\nexport const disk = fs;\n", 'import-equals-probe.ts'],
    ["import fs from 'fs';\nexport const Probe = () => fs;\n", 'fs-import-probe.tsx'],
  ];
  for (const [source, name] of samples) {
    const result = lintRenderer(path.join('src', 'renderer', name), source);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, new RegExp(rendererImportBanMessage), output);
  }
});

test('lint allows renderer imports that are not Node or Electron main APIs', () => {
  const samples = [
    ["import { APP_NAME } from '../shared/app-info.js';\nexport const title = APP_NAME;\n", 'shared-probe.ts'],
    ["import { createRoot } from 'react-dom/client';\nexport const root = createRoot;\n", 'react-probe.ts'],
    ["import disk from './fs';\nexport const value = disk;\n", 'relative-fs-probe.ts'],
    ["import store from 'electron-store';\nexport const value = store;\n", 'electron-store-probe.ts'],
  ];
  for (const [source, name] of samples) {
    const result = lintRenderer(path.join('src', 'renderer', name), source);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, 0, output);
  }
});
