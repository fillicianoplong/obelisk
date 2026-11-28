import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentDefaultLineSpacing,
  effectiveLineSpacing,
  isLineSpacing,
} from '../../../dist/shared/schema/line-spacing.js';

test('line spacing helpers match the schema list', () => {
  assert.equal(isLineSpacing('1.25'), true);
  assert.equal(isLineSpacing('1.3'), false);
  assert.equal(documentDefaultLineSpacing({}), 'single');
  assert.equal(documentDefaultLineSpacing({ defaultLineSpacing: 'double' }), 'double');
  assert.equal(effectiveLineSpacing(null, { defaultLineSpacing: 'double' }), 'double');
  assert.equal(effectiveLineSpacing('1.25', { defaultLineSpacing: 'double' }), '1.25');
});