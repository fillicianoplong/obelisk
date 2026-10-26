import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function prop(css, header, name) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, header);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const match = body.match(new RegExp(`${name}\\s*:\\s*([^;]+)`));
  assert.ok(match, `${header} ${name}`);
  return match[1].trim();
}

function themeField(source, theme, field) {
  const match = source.match(new RegExp(`${theme}:\\s*\\{([^}]+)\\}`));
  assert.ok(match, theme);
  const fieldMatch = match[1].match(new RegExp(`${field}:\\s*'([^']+)'`));
  assert.ok(fieldMatch, `${theme}.${field}`);
  return fieldMatch[1];
}

test('shell frame colors match the Slate title bar and window tokens', async () => {
  const css = stripComments(await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8'));
  const frame = await readFile(path.join(root, 'src/main/shell-theme.ts'), 'utf8');
  const entry = await readFile(path.join(root, 'src/main/index.ts'), 'utf8');

  const light = ':root,';
  const dark = ':root[data-theme="dark"]';
  const pairs = [
    ['light', 'titleBar', '--color-surface-chrome', light],
    ['light', 'symbol', '--color-text-chrome', light],
    ['light', 'window', '--color-surface-canvas', light],
    ['dark', 'titleBar', '--color-surface-chrome', dark],
    ['dark', 'symbol', '--color-text-chrome', dark],
    ['dark', 'window', '--color-surface-canvas', dark],
  ];
  for (const [theme, field, token, header] of pairs) {
    assert.equal(themeField(frame, theme, field), prop(css, header, token), `${theme} ${field}`);
  }

  const height = frame.match(/titleBarHeight:\s*(\d+)/);
  assert.ok(height);
  assert.equal(`${height[1]}px`, prop(css, ':root {', '--size-titlebar'));

  assert.match(entry, /shellFrameColors\(nativeTheme\.shouldUseDarkColors\)/);
  assert.match(entry, /backgroundColor: frame\.backgroundColor/);
  assert.match(entry, /setBackgroundColor\(frame\.backgroundColor\)/);
  assert.match(entry, /titleBarStyle: 'hidden'/);
  assert.match(entry, /titleBarOverlay:/);
  assert.match(entry, /setTitleBarOverlay\(\{/);
  assert.match(entry, /color: frame\.overlayColor/);
  assert.match(entry, /symbolColor: frame\.symbolColor/);
  assert.match(entry, /height: frame\.titleBarHeight/);
  assert.match(entry, /process\.platform === 'win32'/);
  assert.match(entry, /nativeTheme\.on\('updated'/);
  assert.equal(entry.includes('themeSource'), false);
  assert.equal(entry.includes('#E6EAF0'), false);
  assert.equal(entry.includes('#20252C'), false);
});

test('each Windows theme maps to that theme’s caption overlay and window background', async () => {
  const { shellFrameColors } = await import(pathToFileURL(path.join(root, 'src/main/shell-theme.ts')).href);
  const css = stripComments(await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8'));
  const lightChrome = prop(css, ':root,', '--color-surface-chrome');
  const lightSymbol = prop(css, ':root,', '--color-text-chrome');
  const darkChrome = prop(css, ':root[data-theme="dark"]', '--color-surface-chrome');
  const darkSymbol = prop(css, ':root[data-theme="dark"]', '--color-text-chrome');
  const light = shellFrameColors(false);
  const dark = shellFrameColors(true);
  assert.equal(light.backgroundColor, lightChrome);
  assert.equal(light.overlayColor, lightChrome);
  assert.equal(light.symbolColor, lightSymbol);
  assert.equal(dark.backgroundColor, darkChrome);
  assert.equal(dark.overlayColor, darkChrome);
  assert.equal(dark.symbolColor, darkSymbol);
  assert.equal(light.titleBarHeight, dark.titleBarHeight);
  assert.notEqual(light.overlayColor, dark.overlayColor);
  assert.notEqual(light.symbolColor, dark.symbolColor);
});
