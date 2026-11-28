import assert from 'node:assert/strict';
import test from 'node:test';
import { exportDocument } from '../../../dist/main/export/index.js';

test('exportDocument is the architecture export(format, document, assets, target) entry point', async () => {
  const document = {
    view: 'pageless',
    page: {},
    header: {},
    footer: {},
    blocks: [],
  };
  const assets = { mathml: [], formulaPngs: [], firstFramePngs: [], images: [] };
  const result = await exportDocument('markdown', document, assets, { filePath: '/tmp/out.md' });
  assert.equal(typeof result.bytes, 'object');
  assert.equal(result.bytes.byteLength > 0, true);
  assert.equal(result.formulasAsImages, false);
});