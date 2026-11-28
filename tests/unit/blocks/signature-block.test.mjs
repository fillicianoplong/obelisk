import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const documentUrl = new URL('../../../src/renderer/blocks/signature/document.ts', import.meta.url);
const commandsUrl = new URL('../../../src/renderer/blocks/signature/commands.ts', import.meta.url);
const { signaturePayloadFromBlock, parseSignaturePayload } = await loadRenderer(documentUrl);
const { signatureBlockJsonFromAttrs } = await loadRenderer(commandsUrl);

test('signature payload round-trip keeps schema fields', () => {
  const block = {
    type: 'signature',
    id: 'sig-1',
    sha256: 'a'.repeat(64),
    line: true,
    width: 2.5,
    labels: ['Name'],
    align: 'center',
    blank: false,
  };
  const payload = signaturePayloadFromBlock(block);
  const attrs = { blockId: 'sig-1', payload: JSON.stringify(payload) };
  const parsed = parseSignaturePayload(attrs);
  assert.deepEqual(parsed, block);
});

test('signature block json preserves width limits', () => {
  const json = signatureBlockJsonFromAttrs('sig-2', {
    blockId: 'sig-2',
    payload: JSON.stringify({
      type: 'signature',
      id: 'sig-2',
      sha256: 'b'.repeat(64),
      line: false,
      width: 3,
      labels: [],
      align: 'right',
      blank: true,
    }),
  });
  assert.equal(json.width, 3);
  assert.equal(json.blank, true);
  assert.equal(json.align, 'right');
});