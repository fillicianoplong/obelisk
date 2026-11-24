import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardHtmlFragment, clipboardPayload, readClipboardItems } from '../../../dist/main/clipboard/read.js';

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
