import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGRAM_ERROR_HEADLINE,
  formatDiagramRenderError,
} from '../../../src/shared/diagram/error-message.ts';

test('formatDiagramRenderError uses a friendly headline and strips source echo', () => {
  const out = formatDiagramRenderError(
    'No diagram type detected matching given configuration for text: not mermaid',
  );
  assert.equal(out.headline, DIAGRAM_ERROR_HEADLINE);
  assert.equal(out.detail, 'No diagram type detected matching given configuration');
});

test('formatDiagramRenderError omits duplicate detail when only the headline applies', () => {
  const out = formatDiagramRenderError(DIAGRAM_ERROR_HEADLINE);
  assert.equal(out.detail, null);
});