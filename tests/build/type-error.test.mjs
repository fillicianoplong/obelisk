import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

test('the TypeScript build fails and names the file with the type error', () => {
  const result = spawnSync(
    process.execPath,
    [tsc, '-p', path.join(root, 'tests/fixtures/type-error'), '--pretty', 'false'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /bad\.ts/);
  assert.match(output, /error TS/);
});
