import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rendererRoot = path.join(root, 'src/renderer');

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

function customProperties(block) {
  const found = new Set();
  let depth = 0;
  let current = '';
  for (const char of block) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ';' && depth === 0) {
      const match = current.match(/^\s*(--[A-Za-z0-9-]+)\s*:/);
      if (match) {
        found.add(match[1]);
      }
      current = '';
    } else {
      current += char;
    }
  }
  const tail = current.match(/^\s*(--[A-Za-z0-9-]+)\s*:/);
  if (tail) {
    found.add(tail[1]);
  }
  return found;
}

function definedThemeTokens() {
  const source = stripComments(readFileSync(path.join(rendererRoot, 'styles/tokens.css'), 'utf8'));
  const defined = new Set();
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open === -1) {
      break;
    }
    const close = findMatchingBrace(source, open);
    for (const name of customProperties(source.slice(open + 1, close))) {
      defined.add(name);
    }
    cursor = close + 1;
  }
  return defined;
}

/** Custom properties set in script, or used only with a second fallback argument. */
const RUNTIME_TOKENS = new Set([
  '--block-handle-height',
  '--block-handle-left',
  '--block-handle-top',
  '--block-menu-left',
  '--block-menu-top',
  '--context-menu-left',
  '--context-menu-top',
  '--link-bubble-left',
  '--link-bubble-top',
  '--link-tooltip-left',
  '--link-tooltip-top',
  '--menu-flyout-left',
  '--menu-flyout-top',
  '--page-margin',
  '--page-gap',
  '--page-height',
  '--page-width',
  '--page-header-offset',
  '--page-pad-bottom',
  '--page-pad-left',
  '--page-pad-right',
  '--page-pad-top',
  '--page-scrollbar-block',
  '--page-scrollbar-inline',
  '--page-stack-height',
  '--page-zoom',
]);

/** Pre-existing drift tracked on another branch (table block). */
const KNOWN_UNDEFINED = new Map([
  ['--color-border-strong', ['src/renderer/blocks/table/table.css']],
  ['--color-focus-ring', ['src/renderer/blocks/table/table.css']],
  ['--color-text-danger', ['src/renderer/blocks/table/table.css']],
]);

function walkCssFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(full);
    }
  }
  return files;
}

function varReferences(css) {
  const refs = [];
  for (const match of css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
    refs.push(match[1]);
  }
  return refs;
}

function scanUndefinedTokens() {
  const defined = definedThemeTokens();
  const offenders = new Map();
  for (const file of walkCssFiles(rendererRoot)) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const refs = varReferences(stripComments(readFileSync(file, 'utf8')));
    for (const name of refs) {
      if (defined.has(name) || RUNTIME_TOKENS.has(name)) {
        continue;
      }
      const known = KNOWN_UNDEFINED.get(name);
      if (known !== undefined && known.includes(relative)) {
        continue;
      }
      if (!offenders.has(relative)) {
        offenders.set(relative, new Set());
      }
      offenders.get(relative).add(name);
    }
  }
  return offenders;
}

test('export dialog styles only reference defined theme tokens', () => {
  const offenders = scanUndefinedTokens();
  const exportFile = 'src/renderer/shell/export/export-dialog.css';
  const bad = offenders.get(exportFile);
  assert.deepEqual(bad ?? [], [], `${exportFile} uses undefined tokens: ${bad ? [...bad].join(', ') : ''}`);
});

test('undefined custom properties outside the known-drift list', () => {
  const offenders = scanUndefinedTokens();
  const lines = [];
  for (const [file, names] of [...offenders.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  for (const name of [...names].sort()) {
      lines.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(lines, [], `Undefined token references:\n${lines.join('\n')}`);
});