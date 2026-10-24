import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const probe = path.join(root, 'src/main/type-error-probe.ts');

test('a type error in src fails the build and names the file', async () => {
  await writeFile(probe, 'export const value: number = "no";\n');
  try {
    const result = spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.build.json', '--pretty', 'false'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.match(output, /type-error-probe\.ts/);
    assert.match(output, /error TS/);
  } finally {
    await rm(probe, { force: true });
  }
});
