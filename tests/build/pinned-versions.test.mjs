import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function assertExact(name, version) {
  assert.match(version, EXACT_VERSION, `${name} must be an exact version, not a range`);
  assert.equal(/[\^~*><]|x\b|\|\|/.test(version), false, `${name} has a floating range`);
}

test('package.json and the lockfile pin exact versions', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));

  assert.equal(lockfile.lockfileVersion, 3);
  const declared = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const names = Object.keys(declared);
  assert.ok(names.length > 0);

  for (const name of names) {
    assertExact(name, declared[name]);
    const locked = lockfile.packages?.[`node_modules/${name}`];
    assert.ok(locked, `lockfile is missing node_modules/${name}`);
    assert.equal(locked.version, declared[name], `${name} lockfile version differs from package.json`);
  }
});
