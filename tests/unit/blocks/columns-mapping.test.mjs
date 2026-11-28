import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);

test('columns block round-trips through the editor schema', async () => {
  const mapping = await loadRenderer(mappingUrl);
  const { editorSchema } = await loadRenderer(schemaUrl);
  const block = {
    type: 'columns',
    id: 'col-1',
    columns: [
      { share: 0.5, blocks: [{ type: 'paragraph', id: 'a', content: [{ type: 'text', text: 'Left' }] }] },
      { share: 0.5, blocks: [{ type: 'paragraph', id: 'b', content: [{ type: 'text', text: 'Right' }] }] },
    ],
  };
  const node = mapping.blockNodeFromJson(block, editorSchema);
  assert.equal(node.type.name, 'structured_block');
  assert.equal(node.attrs.blockType, 'columns');
  const json = mapping.blockJsonFromNode(node, block, () => 'new');
  assert.equal(json.type, 'columns');
  assert.equal(json.columns.length, 2);
});