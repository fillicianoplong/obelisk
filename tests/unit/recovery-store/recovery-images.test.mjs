import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { createRecoveryService } from '../../../dist/main/recoveryStore/service.js';
import { pngHeader } from '../../../scripts/make-hostile-fixtures/images.mjs';
import { blockId, minimalDocument } from '../../../scripts/make-hostile-fixtures/documents.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('recovery put and restore keep packed images', async () => {
  const bytes = pngHeader(12, 12);
  const hash = sha256(bytes);
  const block = {
    type: 'image',
    id: blockId(5),
    sha256: hash,
    width: 1.5,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    alt: 'clip',
  };
  const document = minimalDocument([block]);
  const images = [{
    sha256: hash,
    data: Buffer.from(bytes).toString('base64'),
    type: 'png',
    pixelWidth: 12,
    pixelHeight: 12,
    frames: 1,
  }];
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-recovery-'));
  try {
    const recovery = createRecoveryService({
      userData: () => userDataDir,
      writer: '0.1.56.0',
      readObk: (filePath) => decodeObk(filePath),
      privateAppData: [userDataDir],
    });
    const put = await recovery.put({
      recoveryId: null,
      document: {
        view: document.view,
        page: document.page,
        header: document.header,
        footer: document.footer,
        blocks: document.blocks,
      },
      firstLine: 'Photo',
      images,
    });
    assert.equal(put.status, 'ok', JSON.stringify(put));
    const restored = await recovery.restore({ recoveryId: put.recoveryId });
    assert.equal(restored.status, 'ok');
    assert.equal(restored.images.length, 1);
    assert.equal(restored.images[0].sha256, hash);
    assert.equal(restored.images[0].pixelWidth, 12);
    const imageBlock = restored.document.blocks.find((entry) => entry.type === 'image');
    assert.ok(imageBlock);
    assert.equal(imageBlock.sha256, hash);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});