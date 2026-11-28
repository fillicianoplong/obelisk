import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDocument, documentDefaultLineSpacing } from '../../../dist/shared/schema/index.js';

function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

test('document default line spacing encodes in document.json', async () => {
  const document = {
    view: 'pages',
    defaultLineSpacing: 'double',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: {
      id: blockId(1),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    footer: {
      id: blockId(2),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    blocks: [{
      type: 'paragraph',
      id: blockId(3),
      align: 'left',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [{ type: 'text', text: 'Body' }],
    }],
  };
  const checked = checkDocument(document);
  assert.equal(checked.ok, true, checked.ok ? '' : JSON.stringify(checked));
  assert.equal(documentDefaultLineSpacing(checked.value), 'double');

  assert.equal(JSON.stringify(checked.value).includes('"defaultLineSpacing":"double"'), true);
});