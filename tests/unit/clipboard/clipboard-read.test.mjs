import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipboardHtmlFragment,
  clipboardImageFromNativePng,
  clipboardPayload,
  readClipboardItems,
} from '../../../dist/main/clipboard/read.js';
import { pngHeader } from '../../../scripts/make-hostile-fixtures/images.mjs';
import { IMAGE_INSERT_TOO_LARGE } from '../../../dist/shared/images/messages.js';
import { IMAGE_MAX_BYTES } from '../../../dist/shared/schema/index.js';
import { inspectFileImageBytes } from '../../../dist/main/images/inspect.js';

test('clipboard HTML keeps the fragment and drops the Windows header', () => {
  const wrapped = [
    'Version:0.9',
    'StartHTML:0000000100',
    'EndHTML:0000000200',
    'StartFragment:0000000120',
    'EndFragment:0000000180',
    '<html><body><!--StartFragment--><p>Notes</p><!--EndFragment--></body></html>',
  ].join('\r\n');
  assert.equal(clipboardHtmlFragment(wrapped), '<p>Notes</p>');
  assert.equal(clipboardHtmlFragment('<p>Plain</p>'), '<p>Plain</p>');
});

test('readClipboard returns text and HTML and caps a huge payload', async () => {
  const read = await readClipboardItems([
    {
      types: ['text/html', 'text/plain'],
      getType: async (type) => (type === 'text/html'
        ? `<!--StartFragment-->${'b'.repeat(20)}<!--EndFragment-->`
        : 'from-item'),
    },
  ], 'alpha');
  assert.equal(read.text, 'alpha');
  assert.equal(read.html, 'b'.repeat(20));
  const huge = clipboardPayload('x'.repeat(1_000_010), 'y'.repeat(2_000_010));
  assert.equal(huge.text.length, 1_000_000);
  assert.equal(huge.html.length, 2_000_000);
});

test('clipboard read shares the insert image limits for bitmap payloads', () => {
  const bytes = pngHeader(8, 8);
  const encoded = clipboardImageFromNativePng(bytes);
  assert.ok(encoded && encoded.length > 0);
  const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
  big.set(pngHeader(4, 4));
  assert.equal(inspectFileImageBytes(big).message, IMAGE_INSERT_TOO_LARGE);
  assert.equal(clipboardImageFromNativePng(big), null);
});
