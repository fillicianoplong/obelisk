import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = path.join(root, 'src/renderer');

const forbidden =
  /(?:from|import)\s*(?:\(\s*)?['"](?:node:|electron(?:\/[^'"]*)?|fs|path|child_process|os|net|crypto|http|https)['"]|require\(\s*['"](?:node:|electron(?:\/[^'"]*)?|fs|path|child_process)['"]\s*\)/;

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

test('renderer files do not import Node or Electron main APIs', async () => {
  const files = await filesUnder(rendererDir);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.equal(
      forbidden.test(source),
      false,
      `${path.relative(root, file)} imports a Node or Electron API`,
    );
  }
});
