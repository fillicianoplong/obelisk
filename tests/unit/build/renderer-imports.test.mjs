import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  bannedSpecifiersIn,
  isBannedRendererSpecifier,
} from '../../../scripts/renderer-import-ban.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rendererDir = path.join(root, 'src/renderer');

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(fullPath)));
    } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

test('renderer import ban covers Node built-ins and Electron main APIs', () => {
  for (const specifier of [
    'fs',
    'fs/promises',
    'node:fs',
    'node:fs/promises',
    'node:test',
    'path',
    'node:path',
    'child_process',
    'os',
    'net',
    'crypto',
    'http',
    'https',
    'electron',
    'electron/main',
    'electron/common',
  ]) {
    assert.equal(isBannedRendererSpecifier(specifier), true, specifier);
  }
  for (const specifier of [
    './fs',
    '../shared/app-info.js',
    'react',
    'react-dom/client',
    'electron-store',
    'fsevents',
  ]) {
    assert.equal(isBannedRendererSpecifier(specifier), false, specifier);
  }
});

test('renderer source scan finds fs, node:, and electron imports', () => {
  assert.deepEqual(bannedSpecifiersIn("import fs from 'fs';\n"), ['fs']);
  assert.deepEqual(
    bannedSpecifiersIn("import { readFile } from 'fs/promises';\n"),
    ['fs/promises'],
  );
  assert.deepEqual(bannedSpecifiersIn('import fs from "node:fs";\n'), ['node:fs']);
  assert.deepEqual(
    bannedSpecifiersIn("import { app } from 'electron/main';\n"),
    ['electron/main'],
  );
  assert.deepEqual(bannedSpecifiersIn("const fs = require('fs');\n"), ['fs']);
  assert.deepEqual(
    bannedSpecifiersIn("import type { PathLike } from 'node:fs';\n"),
    ['node:fs'],
  );
  assert.deepEqual(
    bannedSpecifiersIn("export { readFile } from 'fs';\n"),
    ['fs'],
  );
  assert.deepEqual(bannedSpecifiersIn("const fs = import('node:fs');\n"), ['node:fs']);
  assert.deepEqual(
    bannedSpecifiersIn("import { APP_NAME } from '../shared/app-info.js';\n"),
    [],
  );
  assert.deepEqual(
    bannedSpecifiersIn("import { createRoot } from 'react-dom/client';\n"),
    [],
  );
  assert.deepEqual(bannedSpecifiersIn("// import fs from 'fs';\n"), []);
});

test('renderer files do not import Node or Electron main APIs', async () => {
  const files = await filesUnder(rendererDir);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const banned = bannedSpecifiersIn(source);
    assert.deepEqual(
      banned,
      [],
      `${path.relative(root, file)} imports ${banned.join(', ')}`,
    );
  }
});
