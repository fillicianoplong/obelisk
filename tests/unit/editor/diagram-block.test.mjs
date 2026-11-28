import assert from 'node:assert/strict';
import test from 'node:test';
import { documentFromEditorDoc, editorDocFromDocument } from '../../../dist/renderer/editor/schema/mapping.js';
import { editorSchema } from '../../../dist/renderer/editor/schema/index.js';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

test('diagram blocks round-trip through the editor document mapping', () => {
  const doc = {
    view: 'pages',
    page: { orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), content: [] },
    footer: { id: id(2), content: [] },
    blocks: [{
      type: 'diagram',
      id: id(3),
      source: 'flowchart LR\n  A-->B',
    }],
  };
  const pm = editorDocFromDocument(doc, editorSchema);
  const out = documentFromEditorDoc(doc, pm, () => id(9));
  assert.equal(out.document.blocks.length, 1);
  assert.equal(out.document.blocks[0].type, 'diagram');
  assert.equal(out.document.blocks[0].source, 'flowchart LR\n  A-->B');
  assert.equal(out.document.blocks[0].id, id(3));
});