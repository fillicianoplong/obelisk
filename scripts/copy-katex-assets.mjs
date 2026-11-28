import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'node_modules', 'katex', 'dist');
const target = path.join(root, 'assets', 'katex');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(path.join(dist, 'katex.min.css'), path.join(target, 'katex.min.css'));
cpSync(path.join(dist, 'fonts'), path.join(target, 'fonts'), { recursive: true });
console.log(`Copied KaTeX assets to ${path.relative(root, target)}`);