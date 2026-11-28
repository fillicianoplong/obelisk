import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const ALLOWED_TRANSITION_DURATION =
  /^var\(--duration-(?:instant|fast|normal|slow)\)$/;

test('data-reduced-motion zeroes motion tokens alongside the media query', async () => {
  const tokens = stripComments(await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8'));
  const attrStart = tokens.indexOf(':root[data-reduced-motion]');
  assert.ok(attrStart !== -1, 'missing :root[data-reduced-motion]');
  const block = tokens.slice(attrStart, tokens.indexOf('}', attrStart));
  assert.match(block, /--duration-fast:\s*0ms/);
  assert.match(block, /--duration-normal:\s*0ms/);
  assert.match(block, /--duration-slow:\s*0ms/);
  assert.match(block, /--scroll-behavior:\s*auto/);
});

test('transition-duration in renderer CSS uses motion duration tokens', async () => {
  const pattern = /transition-duration\s*:\s*([^;}\n]+)/g;
  const files = globSync('src/renderer/**/*.css', { cwd: root }).sort();
  for (const relative of files) {
    if (relative.endsWith('tokens.css')) {
      continue;
    }
    const css = stripComments(await readFile(path.join(root, relative), 'utf8'));
    for (const match of css.matchAll(pattern)) {
      const value = match[1].trim();
      assert.ok(
        ALLOWED_TRANSITION_DURATION.test(value),
        `${relative} sets transition-duration to ${value}; use var(--duration-*)`,
      );
    }
  }
});

test('scroll containers use the scroll-behavior token', async () => {
  const shell = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  assert.match(shell, /\.page-region\s*\{[^}]*scroll-behavior:\s*var\(--scroll-behavior\)/s);
  assert.match(shell, /\.tab-list\s*\{[^}]*scroll-behavior:\s*var\(--scroll-behavior\)/s);
  const global = await readFile(path.join(root, 'src/renderer/styles.css'), 'utf8');
  assert.match(global, /html\s*\{[^}]*scroll-behavior:\s*var\(--scroll-behavior\)/s);
});