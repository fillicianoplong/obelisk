import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FORMULA_REFERENCE_SAMPLES } from '../../../dist/shared/formula/samples.js';
import { renderFormulaLatex } from '../../../dist/shared/formula/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('each Equation reference sample renders without error', () => {
  for (const sample of FORMULA_REFERENCE_SAMPLES) {
    const result = renderFormulaLatex(sample.latex);
    assert.equal(result.ok, true, `${sample.id}: ${result.error}`);
    assert.match(result.html, /katex/, sample.id);
    assert.equal(result.hasLink, false, sample.id);
    assert.equal(result.hasImage, false, sample.id);
  }
});

test('\\frac{1} returns a KaTeX parse error', () => {
  const result = renderFormulaLatex('\\frac{1}');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /expected/i);
});

test('hostile H-22 commands fail closed with no links or images', () => {
  const latex = [
    '\\href{https://evil.example}{x}',
    '\\url{https://evil.example}',
    '\\includegraphics{secret.png}',
    '<script>alert(1)</script>',
  ].join(' ');
  const result = renderFormulaLatex(latex);
  assert.equal(result.ok, false);
  assert.equal(result.hasLink, false);
  assert.equal(result.hasImage, false);
  assert.ok(result.error && result.error.length > 0);
});

test('a \\gdef in one render does not change the next render', () => {
  const first = renderFormulaLatex('\\gdef\\carried{99}\\carried');
  assert.equal(first.ok, true);
  assert.match(first.html, /99/);
  const second = renderFormulaLatex('\\carried');
  assert.equal(second.ok, false);
  assert.match(second.error ?? '', /Undefined control sequence|not defined/i);
});

test('formula samples file matches the SRS reference count', () => {
  assert.equal(FORMULA_REFERENCE_SAMPLES.length, 6);
  assert.equal(root.endsWith('obelisk'), true);
});