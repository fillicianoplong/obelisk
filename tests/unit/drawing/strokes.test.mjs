import assert from 'node:assert/strict';
import test from 'node:test';

const strokes = await import('../../../dist/shared/drawing/strokes.js');
const colors = await import('../../../dist/shared/drawing/colors.js');
const render = await import('../../../dist/shared/drawing/render.js');

test('default black ink displays light on a dark theme', () => {
  assert.equal(colors.strokeDisplayColor('#000000', true), '#E6EAF0');
  assert.equal(colors.strokeDisplayColor('#000000', false), '#000000');
  assert.equal(colors.strokeExportColor('#000000'), '#000000');
});

test('stroke eraser hits whole strokes', () => {
  const data = [
    {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      width: 4,
      color: '#000000',
    },
    {
      points: [{ x: 0, y: 20 }, { x: 10, y: 20 }],
      width: 4,
      color: '#B3261E',
    },
  ];
  assert.equal(strokes.strokeIndexAtPoint(data, 5, 1), 0);
  assert.equal(strokes.strokeIndexAtPoint(data, 5, 19), 1);
  const trimmed = strokes.removeStrokeAtIndex(data, 0);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].color, '#B3261E');
});

test('render uses document colours for export', () => {
  const stroke = {
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    width: 2,
    color: '#000000',
  };
  const display = render.strokeSvgAttributes(stroke, { darkTheme: true });
  const exported = render.strokeSvgAttributes(stroke, { forExport: true });
  assert.equal(display.stroke, '#E6EAF0');
  assert.equal(exported.stroke, '#000000');
});

test('appendPoint coalesces nearby samples', () => {
  const next = strokes.appendPoint([{ x: 0, y: 0 }], { x: 0.2, y: 0.2 }, 100, 100);
  assert.equal(next.length, 1);
  const far = strokes.appendPoint(next, { x: 5, y: 5 }, 100, 100);
  assert.equal(far.length, 2);
});