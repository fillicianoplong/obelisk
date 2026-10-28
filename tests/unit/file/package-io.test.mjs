import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import {
  readPackageIoRequest,
  runPackagedIoCheck,
} from '../../../dist/main/file/packageIo.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';

function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function fields(n) {
  return {
    id: blockId(n),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
  };
}

async function writeFixture(file, text) {
  const encoded = await encodeObk({
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: { ...fields(1), content: [] },
    footer: { ...fields(2), content: [] },
    blocks: [{
      type: 'paragraph',
      ...fields(3),
      content: [{ type: 'text', text }],
    }],
  }, {
    format: 'obelisk',
    formatVersion: 1,
    writer: 'obelisk',
    images: [],
  });
  assert.equal(encoded.ok, true);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, encoded.bytes);
}

test('the package check opens a valid file, saves, and reopens the same text', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-package-io-'));
  try {
    const openPath = path.join(directory, 'opened.obk');
    const savePath = path.join(directory, 'saved.obk');
    await writeFixture(openPath, 'Lab notes');
    const request = readPackageIoRequest({
      OBELISK_PACKAGE_IO_OPEN: openPath,
      OBELISK_PACKAGE_IO_SAVE: savePath,
      OBELISK_PACKAGE_IO_OPEN_TEXT: 'Lab notes',
      OBELISK_PACKAGE_IO_SAVE_TEXT: 'test',
    });
    assert.equal(request.ok, true);
    await runPackagedIoCheck(request.request, decodeObk);
    const saved = await decodeObk(savePath);
    assert.equal(saved.ok, true);
    assert.equal(saved.document.blocks[0].content[0].text, 'test');
    const refused = readPackageIoRequest({
      OBELISK_PACKAGE_IO_OPEN: 'notes.obk',
      OBELISK_PACKAGE_IO_SAVE: savePath,
      OBELISK_PACKAGE_IO_OPEN_TEXT: 'Lab notes',
      OBELISK_PACKAGE_IO_SAVE_TEXT: 'test',
    });
    assert.equal(refused.ok, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
