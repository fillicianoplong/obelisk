import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(css, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error('A CSS block is missing its closing brace.');
}

test('contrast keeps the page edge, active tab, unsaved mark, and focus ring visible', async () => {
  const css = stripComments(await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8'));
  const focus = stripComments(await readFile(path.join(root, 'src/renderer/styles/focus.css'), 'utf8'));
  const tokens = stripComments(await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8'));
  const motionStart = tokens.indexOf('@media (prefers-reduced-motion: reduce)');
  const contrastStart = tokens.indexOf('@media (forced-colors: active)');
  assert.ok(motionStart !== -1 && contrastStart !== -1);
  assert.match(tokens.slice(motionStart, contrastStart), /--duration-fast:\s*0ms/);
  assert.match(tokens.slice(motionStart, contrastStart), /--duration-normal:\s*0ms/);
  assert.match(tokens.slice(motionStart, contrastStart), /--duration-slow:\s*0ms/);

  const open = css.indexOf('@media (forced-colors: active)');
  const body = css.slice(css.indexOf('{', open) + 1, findMatchingBrace(css, css.indexOf('{', open)));
  assert.match(body, /\.title-bar[\s\S]*background:\s*ButtonFace/);
  assert.match(body, /\.title-bar[\s\S]*color:\s*ButtonText/);
  assert.match(body, /\.tab\[aria-selected='true'\][\s\S]*border-color:\s*var\(--color-accent\)/);
  assert.match(body, /\.tab-unsaved[\s\S]*background:\s*var\(--color-text-tab\)/);
  assert.match(body, /\.tab-unsaved[\s\S]*border-color:\s*var\(--color-text-tab\)/);
  assert.match(body, /\.page-sheet,\s*\.menu-panel[\s\S]*border:\s*calc\(var\(--space-2xs\) \/ 2\) solid var\(--color-border-subtle\)/);
  assert.match(focus, /\.tab:focus-visible[\s\S]*outline:\s*var\(--size-focus-ring\) solid var\(--color-focus-outer\)/);
  const sharedFocus = focus.match(/\.menu-button:focus-visible[\s\S]*?\{/);
  assert.ok(sharedFocus);
  assert.equal(sharedFocus[0].includes('.page-sheet'), false);
  assert.match(
    focus,
    /\.page-sheet\[data-focus-source='keyboard'\]:focus\s*\{[^}]*outline:\s*var\(--size-focus-ring\) solid var\(--color-focus-outer\)/,
  );
  assert.match(focus, /outline-color:\s*Highlight/);
  assert.match(css, /\.tab\[data-unsaved='true'\] \.tab-unsaved/);

  const activeOutside = css.slice(0, open);
  const activeRule = activeOutside.match(/\.tab\[aria-selected='true'\] \{[^}]*\}/);
  assert.ok(activeRule);
  assert.equal(activeRule[0].includes('border'), false);
  assert.match(activeRule[0], /font-weight:\s*var\(--font-weight-semibold\)/);
  assert.match(activeRule[0], /background:\s*var\(--color-surface-canvas\)/);
});
