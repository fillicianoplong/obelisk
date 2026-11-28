import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDiagramSource } from '../../../dist/shared/diagram/sanitize-source.js';

test('sanitizeDiagramSource drops click lines and href values', () => {
  const source = [
    'flowchart TD',
    '  A[One]',
    '  click A "https://example.invalid" "open"',
    '  B["text href: \\"x\\""]',
  ].join('\n');
  const sanitized = sanitizeDiagramSource(source);
  assert.equal(sanitized.includes('click A'), false);
  assert.equal(/href\s*:/i.test(sanitized), false);
  assert.equal(sanitized.includes('A[One]'), true);
});