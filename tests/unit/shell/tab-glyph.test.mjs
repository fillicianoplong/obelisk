import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadRenderer } from '../editor/load-renderer.mjs';

const glyphUrl = new URL('../../../src/renderer/shell/tabs/TabGlyph.tsx', import.meta.url);

function iconBox(html) {
  const width = html.match(/\bwidth="([^"]+)"/);
  const height = html.match(/\bheight="([^"]+)"/);
  const stroke = html.match(/\bstroke-width="([^"]+)"/);
  const viewBox = html.match(/\bviewBox="([^"]+)"/);
  const cap = html.match(/\bstroke-linecap="([^"]+)"/);
  assert.ok(width && height && stroke && viewBox && cap, html);
  return {
    width: width[1],
    height: height[1],
    stroke: stroke[1],
    viewBox: viewBox[1],
    cap: cap[1],
  };
}

test('the close and new-tab icons share a stroke and use their own sizes', async () => {
  const { TabGlyph, devicePixelOffset } = await loadRenderer(glyphUrl);
  const close = renderToStaticMarkup(createElement(TabGlyph, { kind: 'close' }));
  const added = renderToStaticMarkup(createElement(TabGlyph, { kind: 'new' }));
  const closeBox = iconBox(close);
  const addedBox = iconBox(added);
  assert.equal(closeBox.stroke, addedBox.stroke);
  assert.equal(closeBox.cap, addedBox.cap);
  assert.deepEqual(closeBox, {
    width: '8',
    height: '8',
    stroke: '2',
    viewBox: '0 0 8 8',
    cap: 'square',
  });
  assert.deepEqual(addedBox, {
    width: '10',
    height: '10',
    stroke: '2',
    viewBox: '0 0 10 10',
    cap: 'square',
  });
  assert.match(close, /stroke="currentColor"/);
  assert.match(added, /stroke="currentColor"/);
  assert.match(added, /d="M5 1 V9 M1 5 H9"/);
  assert.match(added, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(close, /shape-rendering/);
  assert.match(close, /data-tab-glyph="close"/);
  assert.match(added, /data-tab-glyph="new"/);

  for (const [position, dpr] of [[10, 1], [10.4, 1], [10.3, 2], [8.2, 1.25], [4.2, 1.5]]) {
    const landed = (position + devicePixelOffset(position, dpr)) * dpr;
    assert.ok(Math.abs(landed - Math.round(landed)) < 1e-9, `${position} at ${dpr} landed on ${landed}`);
  }
});
