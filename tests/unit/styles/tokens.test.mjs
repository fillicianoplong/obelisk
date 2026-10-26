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

function takeMedia(css, header) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, `missing ${header}`);
  const open = css.indexOf('{', start);
  const close = findMatchingBrace(css, open);
  return {
    inner: css.slice(open + 1, close),
    rest: `${css.slice(0, start)}${css.slice(close + 1)}`,
  };
}

function topLevelRules(css) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open === -1) {
      break;
    }
    const close = findMatchingBrace(css, open);
    const prelude = css.slice(cursor, open).replace(/\s+/g, ' ').trim();
    rules.push({ prelude, body: css.slice(open + 1, close) });
    cursor = close + 1;
  }
  return rules;
}

function customProperties(block) {
  const found = new Map();
  let depth = 0;
  let current = '';
  const parts = [];
  for (const char of block) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) {
    parts.push(current);
  }
  for (const part of parts) {
    const match = part.match(/^\s*(--[A-Za-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const value = match[2].replace(/\s+/g, ' ').trim();
    assert.equal(found.has(name), false, `${name} is declared twice in one block`);
    found.set(name, value);
  }
  return found;
}

function ruleBody(rules, prelude) {
  const match = rules.find((rule) => rule.prelude === prelude);
  assert.ok(match, `missing rule ${prelude}`);
  return match.body;
}

function sameNames(left, right, label) {
  assert.deepEqual([...left.keys()].sort(), [...right.keys()].sort(), `${label} token names`);
}

function sameProperties(left, right, label) {
  sameNames(left, right, label);
  for (const name of left.keys()) {
    assert.equal(left.get(name), right.get(name), `${label} ${name}`);
  }
}

const SHELL_STYLE_FILES = [
  'src/renderer/shell/shell.css',
  'src/renderer/styles.css',
  'src/renderer/editor/editor.css',
];

const RAW_VALUE = /#[0-9a-fA-F]{3,8}\b|\d+(?:\.\d+)?(?:px|ms)\b|rgba?\(|hsla?\(/;

test('every theme token is defined for light and both dark blocks, and the dark blocks match', async () => {
  const source = stripComments(await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8'));

  const darkMedia = takeMedia(source, '@media (prefers-color-scheme: dark)');
  const reducedMotion = takeMedia(darkMedia.rest, '@media (prefers-reduced-motion: reduce)');
  const contrast = takeMedia(reducedMotion.rest, '@media (forced-colors: active)');
  const rules = topLevelRules(contrast.rest);

  const shared = customProperties(ruleBody(rules, ':root'));
  const light = customProperties(ruleBody(rules, ':root, :root[data-theme="light"]'));
  const darkAttribute = customProperties(ruleBody(rules, ':root[data-theme="dark"]'));
  const darkSystemRules = topLevelRules(darkMedia.inner);
  assert.equal(darkSystemRules.length, 1);
  assert.equal(darkSystemRules[0].prelude, ':root:not([data-theme="light"])');
  const darkSystem = customProperties(darkSystemRules[0].body);
  const contrastTokens = customProperties(topLevelRules(contrast.inner)[0].body);
  const motionTokens = customProperties(topLevelRules(reducedMotion.inner)[0].body);

  assert.ok(light.size > 0, 'the light theme has no tokens');
  sameNames(light, darkSystem, 'light and system dark');
  sameProperties(darkSystem, darkAttribute, 'system dark and data-theme dark');
  sameNames(light, contrastTokens, 'light and contrast');

  assert.equal(light.get('--color-surface-chrome'), '#E6EAF0');
  assert.equal(darkSystem.get('--color-surface-chrome'), '#20252C');
  assert.equal(light.get('--color-surface-canvas'), '#EDF0F4');
  assert.equal(darkSystem.get('--color-surface-canvas'), '#16191E');
  assert.equal(light.get('--color-surface-page'), '#FFFFFF');
  assert.equal(darkSystem.get('--color-surface-page'), '#252B33');
  assert.equal(light.get('--color-text-primary'), '#1F2630');
  assert.equal(darkSystem.get('--color-text-primary'), '#E6EAF0');
  assert.equal(light.get('--color-text-status'), '#3A4350');
  assert.equal(darkSystem.get('--color-text-status'), '#C3CBD6');
  assert.equal(light.get('--color-accent'), '#3B4654');
  assert.equal(darkSystem.get('--color-accent'), '#C3CBD6');
  assert.equal(light.get('--color-focus-outer'), '#1F2630');
  assert.equal(darkSystem.get('--color-focus-outer'), '#FFFFFF');
  assert.equal(contrastTokens.get('--color-text-primary'), 'CanvasText');
  assert.equal(contrastTokens.get('--color-accent'), 'Highlight');
  assert.equal(contrastTokens.get('--shadow-page'), 'none');

  assert.equal(shared.get('--size-menubar'), '32px');
  assert.equal(shared.get('--size-tabstrip'), '40px');
  assert.equal(shared.get('--size-statusbar'), '28px');
  assert.equal(shared.get('--size-control'), '32px');
  assert.equal(shared.get('--font-size-body'), '14px');
  assert.equal(shared.get('--font-size-body-small'), '13px');
  assert.equal(shared.get('--font-size-caption'), '12px');
  assert.equal(shared.get('--radius-control'), '4px');
  assert.equal(shared.get('--radius-tab'), '6px');
  assert.equal(shared.get('--radius-overlay'), '8px');
  assert.equal(shared.get('--duration-fast'), '83ms');
  assert.equal(shared.get('--duration-normal'), '167ms');
  assert.equal(shared.get('--duration-slow'), '250ms');

  for (const name of ['--font-ui', '--font-ui-display']) {
    const families = shared.get(name).split(',').map((family) => family.trim().replace(/^"|"$/g, ''));
    assert.equal(families[1], 'Segoe UI', `${name} falls back to Segoe UI`);
  }
  assert.match(shared.get('--font-ui'), /Segoe UI Variable Text/);

  assert.equal(motionTokens.get('--duration-fast'), '0ms');
  assert.equal(motionTokens.get('--duration-normal'), '0ms');
  assert.equal(motionTokens.get('--duration-slow'), '0ms');

  for (const name of light.keys()) {
    assert.equal(shared.has(name), false, `${name} is both shared and themed`);
  }

  const frame = await readFile(path.join(root, 'src/main/shell-theme.ts'), 'utf8');
  assert.match(frame, new RegExp(`titleBar: '${light.get('--color-surface-chrome')}'`));
  assert.match(frame, new RegExp(`titleBar: '${darkSystem.get('--color-surface-chrome')}'`));
  assert.match(frame, /backgroundColor: theme\.titleBar/);
});

function declarations(block) {
  const found = new Map();
  for (const part of block.split(';')) {
    const match = part.match(/^\s*([A-Za-z-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (!match) {
      continue;
    }
    assert.equal(found.has(match[1]), false, `${match[1]} is declared twice`);
    found.set(match[1], match[2].replace(/\s+/g, ' ').trim());
  }
  return found;
}

test('the active tab is canvas and semibold, with a border only under forced colors', async () => {
  const css = stripComments(await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8'));
  const contrast = takeMedia(css, '@media (forced-colors: active)');
  const rules = topLevelRules(contrast.rest);
  const active = declarations(ruleBody(rules, ".tab[aria-selected='true']"));
  assert.equal(active.get('background'), 'var(--color-surface-canvas)');
  assert.equal(active.get('color'), 'var(--color-text-heading)');
  assert.equal(active.get('font-weight'), 'var(--font-weight-semibold)');
  assert.equal(active.has('border-top-color'), false);
  assert.equal([...active.keys()].some((name) => name.includes('accent') || name.startsWith('border')), false);
  const tab = declarations(ruleBody(rules, '.tab'));
  assert.equal(tab.get('border-radius'), 'var(--radius-tab) var(--radius-tab) 0 0');
  assert.equal(tab.get('border'), '0');
  const contrastActive = declarations(ruleBody(topLevelRules(contrast.inner), ".tab[aria-selected='true']"));
  assert.equal(contrastActive.get('border-color'), 'var(--color-accent)');
  assert.equal(contrastActive.get('border-style'), 'solid');
});

test('shell styles take every color, size, radius, shadow, and duration from tokens', async () => {
  for (const relative of SHELL_STYLE_FILES) {
    const css = await readFile(path.join(root, relative), 'utf8');
    assert.equal(RAW_VALUE.test(css), false, `${relative} has a raw color, size, or duration`);
  }
});
