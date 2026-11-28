import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagramPaletteStrokeColor,
  DOCUMENT_DIAGRAM_STROKE,
  SCREEN_DARK_DIAGRAM_STROKE,
} from '../../../src/shared/diagram/mermaid-palette.ts';
import { isDarkDocumentTheme, screenDiagramRenderTarget } from '../../../src/shared/diagram/render-target.ts';

test('diagram palettes use light strokes on screen-dark and document strokes for export', () => {
  assert.equal(diagramPaletteStrokeColor('screen-dark'), SCREEN_DARK_DIAGRAM_STROKE);
  assert.equal(diagramPaletteStrokeColor('screen-light'), DOCUMENT_DIAGRAM_STROKE);
  assert.equal(diagramPaletteStrokeColor('export'), DOCUMENT_DIAGRAM_STROKE);
});

test('screenDiagramRenderTarget follows the root theme attribute', () => {
  assert.equal(screenDiagramRenderTarget({ dataset: { theme: 'dark' } }), 'screen-dark');
  assert.equal(screenDiagramRenderTarget({ dataset: { theme: 'light' } }), 'screen-light');
  assert.equal(isDarkDocumentTheme({ dataset: { theme: 'dark' } }), true);
  assert.equal(isDarkDocumentTheme({ dataset: { theme: 'light' } }), false);
});