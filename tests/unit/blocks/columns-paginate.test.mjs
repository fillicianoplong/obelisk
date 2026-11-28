import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const paginateUrl = new URL('../../../src/renderer/editor/layout/paginate.ts', import.meta.url);

test('column row taller than a page splits into segments', async () => {
  const { columnRowSegmentHeights, paginateFlow, textAreaHeight } = await loadRenderer(paginateUrl);
  const limit = 864;
  assert.deepEqual(columnRowSegmentHeights(400, limit), [400]);
  assert.deepEqual(columnRowSegmentHeights(900, limit), [864, 36]);
  const box = {
    pageWidth: 816,
    pageHeight: 1056,
    marginTop: 96,
    marginRight: 96,
    marginBottom: 96,
    marginLeft: 96,
    gap: 24,
  };
  assert.equal(textAreaHeight(box), limit);
  const units = [
    { pos: 1, blockPos: 0, height: 800, kind: 'line', startsBlock: true },
    { pos: 1, blockPos: 0, height: 200, kind: 'line', startsBlock: false },
  ];
  const layout = paginateFlow(units, box);
  assert.equal(layout.pageCount, 2);
});