import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources', 'licenses');
const target = path.join(root, 'dist', 'renderer', 'licenses');

mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (name === 'manifest.json') {
    continue;
  }
  cpSync(path.join(source, name), path.join(target, name));
}
console.log(`Copied license notices to ${path.relative(root, target)}`);