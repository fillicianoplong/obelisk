import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const menuTreeUrl = new URL('../../../src/renderer/shell/menus/MenuTree.tsx', import.meta.url);

test('context submenus render in a fixed flyout layer, not inside the root panel', async () => {
  const css = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  assert.match(css, /\.context-menu-host \.menu-panel--root[^}]*overflow:\s*visible/);
  assert.match(css, /\.context-menu-host \.menu-item-slot > \.menu-panel[^}]*display:\s*none/);
  assert.match(css, /\.menu-flyout[^}]*position:\s*fixed/);
  assert.match(css, /--menu-flyout-left/);
  const tsx = await readFile(path.join(root, 'src/renderer/shell/menus/MenuTree.tsx'), 'utf8');
  assert.match(tsx, /createPortal/);
  assert.match(tsx, /menu-flyout/);
});

test('flyout positioning places the panel beside the anchor with a gap', async () => {
  const { computeMenuFlyoutPosition } = await loadRenderer(menuTreeUrl);
  const anchor = { left: 100, right: 180, top: 40 };
  const right = computeMenuFlyoutPosition(anchor, 160, 200, 800, 600, 4, 8);
  assert.equal(right.left, 184);
  assert.equal(right.top, 40);
  const flipped = computeMenuFlyoutPosition({ left: 700, right: 780, top: 40 }, 160, 200, 800, 600, 4, 8);
  assert.equal(flipped.left, 536);
});