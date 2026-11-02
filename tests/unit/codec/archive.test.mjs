import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readArchive } from '../../../dist/main/codec/archive/index.js';
import { archiveResponse } from '../../../dist/main/codec/utility-child.js';
import { HOSTILE_DOCUMENT, HOSTILE_MANIFEST } from '../../../scripts/make-hostile-fixtures/generate.mjs';
import { craftZip, storedEntry } from '../../../scripts/make-hostile-fixtures/zip.mjs';

test('a manifest and a document pass the archive checks', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-archive-'));
  try {
    const file = path.join(directory, 'notes.obk');
    const bytes = craftZip({
      entries: [
        storedEntry('manifest.json', HOSTILE_MANIFEST),
        storedEntry('document.json', HOSTILE_DOCUMENT),
      ],
    });
    await writeFile(file, bytes);
    const result = await readArchive(file);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reason, 'ok');
    assert.equal(result.entriesRead, 2);
    assert.equal(result.payloadsRead, 2);
    assert.equal(result.bytesRead, HOSTILE_MANIFEST.length + HOSTILE_DOCUMENT.length);
    const throughChild = await archiveResponse({ id: 7, filePath: file });
    assert.equal(throughChild.id, 7);
    assert.equal(throughChild.result.ok, true);
    assert.equal(throughChild.result.bytesRead, result.bytesRead);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
