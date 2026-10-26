import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mimeTypeFor, resolveAppFile } from '../../../dist/main/security/app-path.js';
import { CONTENT_SECURITY_POLICY } from '../../../dist/main/security/csp.js';
import { loadRenderer } from './load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pageUrl = new URL('../../../src/renderer/editor/layout/page.ts', import.meta.url);

function tokenValue(css, name) {
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  assert.ok(match, `missing ${name}`);
  return match[1].replace(/\s+/g, ' ').trim();
}

test('the Letter page is 8.5 by 11 in with 1 in margins at 96 DPI', async () => {
  const page = await loadRenderer(pageUrl);
  assert.equal(page.CSS_PX_PER_INCH, 96);
  assert.equal(page.cssInches(page.PAGE_WIDTH_IN), '8.5in');
  assert.equal(page.cssInches(page.PAGE_HEIGHT_IN), '11in');
  assert.equal(page.cssInches(page.PAGE_MARGIN_IN), '1in');
  assert.equal(page.cssInches(page.PAGE_HEADER_OFFSET_IN), '0.5in');
  assert.equal(page.cssPixelsAt96Dpi(page.PAGE_WIDTH_IN), 816);
  assert.equal(page.cssPixelsAt96Dpi(page.PAGE_HEIGHT_IN), 1056);
  assert.equal(page.cssPixelsAt96Dpi(page.PAGE_MARGIN_IN), 96);
  assert.equal(page.cssPixelsAt96Dpi(page.PAGE_HEADER_OFFSET_IN), 48);
  assert.equal(page.PAGE_GAP_PX, 24);
  assert.equal(page.PAGE_FONT_FAMILY, 'Liberation Serif');
  assert.equal(page.PAGE_FONT_SIZE, '12pt');

  const frame = page.pageFrameStyle();
  assert.equal(frame.width, 'var(--page-width)');
  assert.equal(frame.height, 'var(--page-height)');
  assert.equal(frame.minWidth, 'var(--page-width)');
  assert.equal(frame.minHeight, 'var(--page-height)');
  assert.equal(frame.maxWidth, 'var(--page-width)');
  assert.equal(frame.maxHeight, 'var(--page-height)');

  const header = page.pageHeaderStyle();
  assert.equal(header.top, 'var(--page-header-offset)');
  assert.equal(header.left, 'var(--page-margin)');
  assert.equal(header.right, 'var(--page-margin)');
  assert.equal(header.height, 'calc(var(--page-margin) - var(--page-header-offset))');

  const tokens = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  assert.equal(tokenValue(tokens, page.PAGE_WIDTH_TOKEN), page.cssInches(page.PAGE_WIDTH_IN));
  assert.equal(tokenValue(tokens, page.PAGE_HEIGHT_TOKEN), page.cssInches(page.PAGE_HEIGHT_IN));
  assert.equal(tokenValue(tokens, page.PAGE_MARGIN_TOKEN), page.cssInches(page.PAGE_MARGIN_IN));
  assert.equal(tokenValue(tokens, page.PAGE_HEADER_OFFSET_TOKEN), page.cssInches(page.PAGE_HEADER_OFFSET_IN));
  assert.equal(tokenValue(tokens, page.PAGE_GAP_TOKEN), `${page.PAGE_GAP_PX}px`);
  assert.equal(tokenValue(tokens, page.PAGE_FONT_SIZE_TOKEN), page.PAGE_FONT_SIZE);
  const family = tokenValue(tokens, page.PAGE_FONT_TOKEN);
  assert.equal(family.startsWith(`"${page.PAGE_FONT_FAMILY}"`), true, family);
});

test('the page sheet uses the tokens and does not shrink to the window', async () => {
  const pageCss = await readFile(path.join(root, 'src/renderer/editor/layout/page.css'), 'utf8');
  const shellCss = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const editorCss = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  assert.match(pageCss, /\.page-frame\s*\{[^}]*width:\s*var\(--page-width\)/);
  assert.match(pageCss, /\.page-frame\s*\{[^}]*height:\s*var\(--page-height\)/);
  assert.match(pageCss, /\.page-frame\s*\{[^}]*min-width:\s*var\(--page-width\)/);
  assert.match(pageCss, /\.page-frame\s*\{[^}]*min-height:\s*var\(--page-height\)/);
  assert.match(pageCss, /\.page-header\s*\{[^}]*top:\s*var\(--page-header-offset\)/);
  assert.match(pageCss, /\.page-header\s*\{[^}]*height:\s*calc\(var\(--page-margin\) - var\(--page-header-offset\)\)/);
  assert.match(pageCss, /\.page-canvas\s*\{[^}]*gap:\s*var\(--page-gap\)/);
  assert.match(pageCss, /\.page-canvas\s*\{[^}]*width:\s*max-content/);
  assert.match(pageCss, /\.page-canvas\s*\{[^}]*align-items:\s*flex-start/);
  assert.equal(/\.page-canvas\s*\{[^}]*margin-inline\s*:/.test(pageCss), false);
  assert.match(pageCss, /\.page-frame\s*\{[^}]*margin-inline:\s*auto/);
  assert.match(shellCss, /\.page-region\s*\{[^}]*overflow:\s*auto/);
  assert.match(shellCss, /\.page-region\s*\{[^}]*overflow-anchor:\s*none/);
  assert.match(shellCss, /\.page-region\s*\{[^}]*padding:\s*var\(--page-gap\)/);
  assert.match(shellCss, /\.page-region\s*\{[^}]*background:\s*var\(--color-surface-canvas\)/);
  assert.match(shellCss, /\.page-sheet\s*\{[^}]*background:\s*var\(--color-surface-page\)/);
  assert.match(shellCss, /\.page-sheet\s*\{[^}]*box-shadow:\s*var\(--shadow-page\)/);
  assert.match(shellCss, /\.page-sheet\s*\{[^}]*font-family:\s*var\(--font-page\)/);
  assert.match(shellCss, /\.page-sheet\s*\{[^}]*font-size:\s*var\(--font-size-page\)/);
  assert.match(shellCss, /\.page-sheet\s*\{[^}]*padding:\s*var\(--page-margin\)/);
  assert.equal(shellCss.includes('min(var(--page-width), 100%)'), false);
  assert.equal(editorCss.includes('min(var(--page-width), 100%)'), false);
  assert.equal(pageCss.includes('min(var(--page-width), 100%)'), false);
  assert.match(
    shellCss,
    /\.page-sheet,\s*\.menu-panel[\s\S]*border:\s*calc\(var\(--space-2xs\) \/ 2\) solid var\(--color-border-subtle\)/,
  );
});

test('typed text uses the bundled Liberation Serif, served from the app', async () => {
  const page = await loadRenderer(pageUrl);
  const pageCss = await readFile(path.join(root, 'src/renderer/editor/layout/page.css'), 'utf8');
  assert.equal(pageCss.includes('local('), false);
  for (const name of page.PAGE_FONT_FILES) {
    assert.match(pageCss, new RegExp(`url\\("/fonts/${name}"\\)`));
    const file = await readFile(path.join(root, 'assets', 'fonts', name));
    assert.equal(file.subarray(0, 4).toString('hex'), '00010000', name);
    const served = await readFile(path.join(root, 'dist', 'renderer', 'fonts', name));
    assert.equal(Buffer.compare(file, served), 0, name);
  }
  const license = await readFile(path.join(root, 'assets', 'fonts', page.PAGE_FONT_LICENSE), 'utf8');
  const servedLicense = await readFile(
    path.join(root, 'dist', 'renderer', 'fonts', page.PAGE_FONT_LICENSE),
    'utf8',
  );
  assert.equal(servedLicense, license);
  assert.match(license, /SIL Open Font License/);

  assert.match(pageCss, /font-family:\s*"Liberation Serif"/);
  assert.match(CONTENT_SECURITY_POLICY, /font-src app:/);
  assert.equal(mimeTypeFor('LiberationSerif-Regular.ttf'), 'font/ttf');
  const rendererRoot = path.join(root, 'dist', 'renderer');
  assert.equal(
    resolveAppFile(rendererRoot, 'app://obelisk/fonts/LiberationSerif-Regular.ttf'),
    path.join(rendererRoot, 'fonts', 'LiberationSerif-Regular.ttf'),
  );

  const cssFiles = [];
  for (const entry of await readdir(path.join(rendererRoot, 'assets'))) {
    if (entry.endsWith('.css')) {
      cssFiles.push(await readFile(path.join(rendererRoot, 'assets', entry), 'utf8'));
    }
  }
  assert.ok(cssFiles.length > 0, 'the renderer build has no css');
  const combined = cssFiles.join('\n');
  assert.match(combined, /font-family:\s*"?Liberation Serif"?/);
  assert.match(combined, /\/fonts\/LiberationSerif-Regular\.ttf/);
  assert.equal(combined.includes('local('), false);
  assert.equal(combined.includes('data:font'), false);
});
