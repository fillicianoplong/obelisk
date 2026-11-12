import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from './load-renderer.mjs';

const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);

test('the editor schema includes every text block node', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  assert.deepEqual(
    Object.keys(editorSchema.nodes).sort(),
    [
      'blockquote',
      'bullet_list',
      'checklist',
      'checklist_item',
      'code_block',
      'doc',
      'foreign_block',
      'heading',
      'horizontal_rule',
      'list_item',
      'ordered_list',
      'page_break',
      'paragraph',
      'text',
    ].sort(),
  );
  assert.deepEqual(Object.keys(editorSchema.marks), []);
  assert.match(editorSchema.nodes.doc.spec.content.toString(), /paragraph/);
  assert.match(editorSchema.nodes.doc.spec.content.toString(), /page_break/);
});

test('a document can hold one of each text block', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const doc = editorSchema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: '00000000-0000-4000-8000-000000000001' }, content: [{ type: 'text', text: 'Body' }] },
      { type: 'heading', attrs: { blockId: '00000000-0000-4000-8000-000000000002', level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'bullet_list',
        attrs: { blockId: '00000000-0000-4000-8000-000000000003' },
        content: [{ type: 'list_item', attrs: { level: 0 }, content: [{ type: 'text', text: 'Item' }] }],
      },
      {
        type: 'ordered_list',
        attrs: { blockId: '00000000-0000-4000-8000-000000000004' },
        content: [{ type: 'list_item', attrs: { level: 0 }, content: [{ type: 'text', text: 'Step' }] }],
      },
      {
        type: 'checklist',
        attrs: { blockId: '00000000-0000-4000-8000-000000000005' },
        content: [{ type: 'checklist_item', attrs: { level: 0, checked: true }, content: [{ type: 'text', text: 'Done' }] }],
      },
      { type: 'blockquote', attrs: { blockId: '00000000-0000-4000-8000-000000000006' }, content: [{ type: 'text', text: 'Quote' }] },
      { type: 'code_block', attrs: { blockId: '00000000-0000-4000-8000-000000000007' }, content: [{ type: 'text', text: 'x = 1' }] },
      { type: 'horizontal_rule', attrs: { blockId: '00000000-0000-4000-8000-000000000008' } },
      { type: 'page_break', attrs: { blockId: '00000000-0000-4000-8000-000000000009' } },
    ],
  });
  doc.check();
  assert.equal(doc.childCount, 9);
});

test('the schema still rejects character marks', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  assert.throws(() => {
    editorSchema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { blockId: '00000000-0000-4000-8000-000000000001' },
        content: [{ type: 'text', text: 'Hi', marks: [{ type: 'strong' }] }],
      }],
    }).check();
  }, RangeError);
});
