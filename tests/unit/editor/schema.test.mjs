import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from './load-renderer.mjs';

const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);

test('the editor schema is paragraphs of text and nothing else', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  assert.deepEqual(Object.keys(editorSchema.nodes).sort(), ['doc', 'paragraph', 'text']);
  assert.deepEqual(Object.keys(editorSchema.marks), []);
  assert.equal(editorSchema.nodes.paragraph.spec.marks, '');
  assert.equal(editorSchema.nodes.doc.spec.content, 'paragraph+');
  assert.equal(editorSchema.nodes.paragraph.spec.content, 'text*');
  assert.deepEqual(editorSchema.nodes.paragraph.spec.toDOM(), ['p', 0]);
});

test('a document can hold many paragraphs', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const doc = editorSchema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
    ],
  });
  doc.check();
  assert.equal(doc.childCount, 3);
  assert.equal(doc.child(0).textContent, 'One');
  assert.equal(doc.child(1).textContent, '');
  assert.equal(doc.child(2).textContent, 'Three');
});

test('the schema rejects other blocks and marks', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const rejected = [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'bullet_list', content: [{ type: 'list_item' }] },
    { type: 'blockquote', content: [{ type: 'paragraph' }] },
    { type: 'code_block', content: [{ type: 'text', text: 'x' }] },
    { type: 'horizontal_rule' },
    {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hi', marks: [{ type: 'strong' }] }],
      }],
    },
    {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hi', marks: [{ type: 'em' }] }],
      }],
    },
    { type: 'doc', content: [{ type: 'text', text: 'Loose' }] },
    { type: 'doc', content: [] },
  ];
  for (const json of rejected) {
    assert.throws(() => {
      editorSchema.nodeFromJSON(json).check();
    }, RangeError, JSON.stringify(json));
  }
});
