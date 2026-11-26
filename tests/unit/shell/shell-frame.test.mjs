import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(css, prelude) {
  const source = stripComments(css);
  const pattern = new RegExp(`${prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  assert.ok(match, `missing ${prelude}`);
  return match[1];
}

test('the menu and status hairlines are the same full-width border', async () => {
  const css = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const line = 'calc(var(--space-2xs) / 2) solid var(--color-border-subtle)';
  assert.match(ruleBody(css, '.menu-bar'), new RegExp(`border-bottom:\\s*${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(ruleBody(css, '.status-bar'), new RegExp(`border-top:\\s*${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(ruleBody(css, '.menu-bar'), /margin/);
  assert.doesNotMatch(ruleBody(css, '.status-bar'), /margin/);
});

test('shell scrollers use a slim round thumb and no arrow buttons', async () => {
  const css = stripComments(await readFile(path.join(root, 'src/renderer/styles/scrollbar.css'), 'utf8'));
  for (const selector of ['.page-region', '.page-setup-dialog', '.slash-menu-panel', '.block-menu-list']) {
    const name = selector.replace('.', '\\.');
    assert.match(css, new RegExp(`${name}::-webkit-scrollbar\\s*[,{]`));
    assert.match(css, new RegExp(`${name}::-webkit-scrollbar-button\\s*[,{]`));
    assert.match(css, new RegExp(`${name}::-webkit-scrollbar-thumb\\s*[,{]`));
    assert.match(css, new RegExp(`${name}::-webkit-scrollbar-thumb:hover\\s*[,{]`));
    assert.match(css, new RegExp(`${name}::-webkit-scrollbar-track\\s*[,{]`));
  }
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--size-scrollbar\)/);
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*height:\s*var\(--size-scrollbar\)/);
  assert.match(css, /::-webkit-scrollbar-button:vertical:start:decrement/);
  assert.match(css, /::-webkit-scrollbar-button:vertical:end:increment/);
  assert.match(css, /::-webkit-scrollbar-button:horizontal:end:increment\s*\{[^}]*width:\s*0/);
  assert.match(css, /::-webkit-scrollbar-button:horizontal:end:increment\s*\{[^}]*height:\s*0/);
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*calc\(var\(--size-scrollbar\) \/ 2\)/);
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*border:\s*var\(--size-scrollbar-inset\) solid transparent/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover\s*\{[^}]*background-color:\s*var\(--color-scrollbar-thumb-hover\)/);
  assert.match(css, /::-webkit-scrollbar-corner\s*\{[^}]*background:\s*var\(--color-scrollbar-track\)/);
});
