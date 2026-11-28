import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import {
  collectMovedStyleRules,
  sanitizeDiagramSheet,
} from '../../../dist/shared/diagram/svg-postprocess.js';

test('diagram stylesheet keeps drawing properties and scopes selectors', () => {
  const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  globalThis.DOMParser = document.defaultView.DOMParser;
  const svgText = `<svg id="diag" style="max-width:200px"><style>.x{fill:#333;position:fixed}</style><rect class="x" style="fill:#111"/></svg>`;
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = parsed.querySelector('svg');
  assert.ok(svg);
  const moved = collectMovedStyleRules(svg, 'key');
  const sheet = sanitizeDiagramSheet(moved.cssParts.join('\n'), 'diag');
  assert.match(sheet, /#diag/);
  assert.match(sheet, /fill:#333|fill:#111/);
  assert.equal(/position\s*:/i.test(sheet), false);
  assert.equal(svg.querySelectorAll('[style]').length, 0);
});