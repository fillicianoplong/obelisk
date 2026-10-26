import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// WCAG 2.1 AA for the Slate tokens. Text needs 4.5:1. A control border, icon,
// or focus ring needs 3:1. Disabled text is exempt. The focus ring's inner
// line is under 3:1 on its own, which matches the Windows focus ring, so it
// is not a pair here. The outer line is checked on the shell surfaces.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEXT = 4.5;
const CONTROL = 3;

function text(name, fg, bg) {
  return { name, minimum: TEXT, fg, bg };
}

function control(name, fg, bg) {
  return { name, minimum: CONTROL, fg, bg };
}

function over(overlay, base) {
  return [overlay, base];
}

const PAIRS = [
  text('Body text on page', '--color-text-primary', '--color-surface-page'),
  text('Body text on the canvas', '--color-text-primary', '--color-surface-canvas'),
  text('Body text on a menu', '--color-text-primary', '--color-surface-raised'),
  text('Body text on a hovered menu item', '--color-text-primary', '--color-surface-raised-hover'),
  text('Body text in a field', '--color-text-primary', '--color-surface-input'),
  text('Body text on a subtle surface', '--color-text-primary', '--color-surface-subtle'),
  text('Body text on a table header', '--color-text-primary', '--color-surface-table-header'),
  text('Body text on a control', '--color-text-primary', '--color-control-fill'),
  text('Body text on a find match', '--color-text-primary', '--color-find-match'),
  text('Text on the current find match', '--color-text-primary', '--color-find-current'),
  text('Secondary text on page', '--color-text-secondary', '--color-surface-page'),
  text('Secondary text on the canvas', '--color-text-secondary', '--color-surface-canvas'),
  text('Secondary text on a menu', '--color-text-secondary', '--color-surface-raised'),
  text('Secondary text on a hovered menu item', '--color-text-secondary', '--color-surface-raised-hover'),
  text('Secondary text on the chrome', '--color-text-secondary', '--color-surface-chrome'),
  text('Secondary text in a field', '--color-text-secondary', '--color-surface-input'),
  text('Heading on page', '--color-text-heading', '--color-surface-page'),
  text('Heading on the canvas', '--color-text-heading', '--color-surface-canvas'),
  text('Heading on a menu', '--color-text-heading', '--color-surface-raised'),
  text('Chrome text on the chrome', '--color-text-chrome', '--color-surface-chrome'),
  text('Chrome text on chrome hover', '--color-text-chrome', '--color-surface-chrome-hover'),
  text('Chrome text on chrome pressed', '--color-text-chrome', '--color-surface-chrome-pressed'),
  text('Inactive tab text', '--color-text-tab', '--color-surface-chrome'),
  text('Inactive tab text on hover', '--color-text-tab', '--color-surface-chrome-hover'),
  text('Status bar text', '--color-text-status', '--color-surface-chrome'),
  text('Primary button text', '--color-text-on-accent', '--color-accent'),
  text('Primary button text on hover', '--color-text-on-accent', '--color-accent-hover'),
  text('Primary button text pressed', '--color-text-on-accent', '--color-accent-pressed'),
  text('Link on page', '--color-text-link', '--color-surface-page'),
  text('Link on a menu', '--color-text-link', '--color-surface-raised'),
  text('Selection text', '--color-selection-text', '--color-selection'),
  text('Saved text on the chrome', '--color-success', '--color-surface-chrome'),
  text('Saved text on the success surface', '--color-success', '--color-success-surface'),
  text('Warning icon on the chrome', '--color-warning', '--color-surface-chrome'),
  text('Warning text on the warning surface', '--color-warning', '--color-warning-surface'),
  text('Error text on page', '--color-error', '--color-surface-page'),
  text('Error text on dialogs', '--color-error', '--color-surface-raised'),
  text('Error text on the error surface', '--color-error', '--color-error-surface'),
  text('Close button text', '--color-close-hover-text', '--color-close-hover'),
  text(
    'Tab close text over the active tab',
    '--color-text-chrome',
    over('--color-tab-close-hover', '--color-surface-canvas'),
  ),
  text(
    'Tab close text over a hovered tab',
    '--color-text-chrome',
    over('--color-tab-close-hover', '--color-surface-chrome-hover'),
  ),
  text(
    'Tab close text pressed on the active tab',
    '--color-text-chrome',
    over('--color-tab-close-pressed', '--color-surface-canvas'),
  ),
  text(
    'Tab close text pressed on a hovered tab',
    '--color-text-chrome',
    over('--color-tab-close-pressed', '--color-surface-chrome-hover'),
  ),
  control('Input border on page', '--color-border-control', '--color-surface-page'),
  control('Control border on the canvas', '--color-border-control', '--color-surface-canvas'),
  control('Control border on a field', '--color-border-control', '--color-surface-input'),
  control('Control border on a menu', '--color-border-control', '--color-surface-raised'),
  control('Control border on a control', '--color-border-control', '--color-control-fill'),
  control('Control border hover on page', '--color-border-control-hover', '--color-surface-page'),
  control('Control border hover on a field', '--color-border-control-hover', '--color-surface-input'),
  control('Focus ring on the chrome', '--color-focus-outer', '--color-surface-chrome'),
  control('Focus ring on the canvas', '--color-focus-outer', '--color-surface-canvas'),
  control('Focus ring on page', '--color-focus-outer', '--color-surface-page'),
  control('Focus ring on a menu', '--color-focus-outer', '--color-surface-raised'),
  control('Scrollbar thumb on the canvas', '--color-scrollbar-thumb', '--color-surface-canvas'),
  control('Scrollbar thumb on page', '--color-scrollbar-thumb', '--color-surface-page'),
  control('Scrollbar thumb hover on the canvas', '--color-scrollbar-thumb-hover', '--color-surface-canvas'),
  control('Scrollbar thumb hover on page', '--color-scrollbar-thumb-hover', '--color-surface-page'),
  control('Accent bar on a hovered menu item', '--color-accent', '--color-surface-raised-hover'),
];

const REQUIRED = [
  'Body text on page',
  'Secondary text on page',
  'Inactive tab text',
  'Status bar text',
  'Primary button text',
  'Error text on dialogs',
  'Text on the current find match',
  'Input border on page',
  'Control border on the canvas',
  'Focus ring on the chrome',
  'Warning icon on the chrome',
  'Scrollbar thumb on the canvas',
  'Scrollbar thumb on page',
];

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

function blockAfter(css, header) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, header);
  const open = css.indexOf('{', start);
  const close = findMatchingBrace(css, open);
  return css.slice(open + 1, close);
}

function colorTokens(block) {
  const found = new Map();
  for (const match of block.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const digits = hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: Number(rgba[4]),
    };
  }
  throw new Error(`Cannot read color ${value}`);
}

function composite(overlay, base) {
  const alpha = overlay.a;
  return {
    r: overlay.r * alpha + base.r * (1 - alpha),
    g: overlay.g * alpha + base.g * (1 - alpha),
    b: overlay.b * alpha + base.b * (1 - alpha),
    a: 1,
  };
}

function channel(value) {
  const unit = value / 255;
  if (unit <= 0.04045) {
    return unit / 12.92;
  }
  return ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveBackground(tokens, background) {
  if (typeof background === 'string') {
    return parseColor(tokens.get(background));
  }
  const overlay = parseColor(tokens.get(background[0]));
  const base = parseColor(tokens.get(background[1]));
  return composite(overlay, base);
}

test('every text and control color pair passes in Light and Dark', async () => {
  // Windows checks the token file out with CRLF. The headers below use LF.
  const css = (await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8')).replaceAll('\r\n', '\n');
  const light = colorTokens(blockAfter(css, ':root,\n:root[data-theme="light"]'));
  const dark = colorTokens(blockAfter(css, ':root[data-theme="dark"]'));
  const names = PAIRS.map((pair) => pair.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of REQUIRED) {
    assert.equal(names.includes(name), true, name);
  }

  const failures = [];
  for (const [theme, tokens] of [['Light', light], ['Dark', dark]]) {
    for (const pair of PAIRS) {
      const foreground = parseColor(tokens.get(pair.fg));
      const background = resolveBackground(tokens, pair.bg);
      const ratio = contrastRatio(foreground, background);
      if (!(ratio >= pair.minimum)) {
        failures.push(`${theme} ${pair.name} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
