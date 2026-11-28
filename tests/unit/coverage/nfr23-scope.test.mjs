import assert from 'node:assert/strict';
import test from 'node:test';
import { NFR23_MODULE_PREFIXES, isNfr23Module } from '../../coverage/nfr23-scope.mjs';

test('NFR-23 scope lists file format, save, and table math prefixes', () => {
  assert.deepEqual(NFR23_MODULE_PREFIXES, [
    'src/main/codec/',
    'src/main/file/',
    'src/shared/schema/',
    'src/renderer/blocks/table/math/',
  ]);
});

test('isNfr23Module accepts scoped paths and rejects others', () => {
  assert.equal(isNfr23Module('src/main/codec/decode.ts'), true);
  assert.equal(isNfr23Module('src/main/file/writeAtomic.ts'), true);
  assert.equal(isNfr23Module('src/shared/schema/validate.ts'), true);
  assert.equal(isNfr23Module('src/renderer/blocks/table/math/evaluate.ts'), true);
  assert.equal(isNfr23Module('src/renderer/blocks/table/model.ts'), false);
  assert.equal(isNfr23Module('src/main/export/service.ts'), false);
  assert.equal(isNfr23Module('src/main/ipc/handlers.ts'), false);
});