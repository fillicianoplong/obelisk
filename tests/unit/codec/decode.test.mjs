import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readArchive } from '../../../dist/main/codec/archive/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { archiveResponse, decodeResponse } from '../../../dist/main/codec/utility-child.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { HOSTILE_DOCUMENT, HOSTILE_MANIFEST } from '../../../scripts/make-hostile-fixtures/generate.mjs';
import { craftZip, storedEntry } from '../../../scripts/make-hostile-fixtures/zip.mjs';

const writer = '0.1.20.0';

function archive(documentBody, manifestValue = emptyManifest(writer)) {
  const manifest = Buffer.from(JSON.stringify(manifestValue));
  const document = Buffer.isBuffer(documentBody)
    ? documentBody
    : Buffer.from(typeof documentBody === 'string' ? documentBody : JSON.stringify(documentBody));
  return craftZip({
    entries: [
      storedEntry('manifest.json', manifest),
      storedEntry('document.json', document),
    ],
  });
}

async function withFile(bytes, check) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-decode-'));
  const file = path.join(directory, 'notes.obk');
  try {
    await writeFile(file, bytes);
    const before = createHash('sha256').update(bytes).digest('hex');
    const result = await check(file);
    const after = createHash('sha256').update(await readFile(file)).digest('hex');
    assert.equal(after, before);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('archive checks still pass a file the schema would refuse', async () => {
  const result = await withFile(craftZip({
    entries: [
      storedEntry('manifest.json', HOSTILE_MANIFEST),
      storedEntry('document.json', HOSTILE_DOCUMENT),
    ],
  }), (file) => readArchive(file));
  assert.equal(result.ok, true);
  assert.equal(result.payload, undefined);
});

test('a missing document is refused at the archive stage, before JSON', async () => {
  const bytes = craftZip({ entries: [storedEntry('manifest.json', HOSTILE_MANIFEST)] });
  const result = await withFile(bytes, (file) => decodeObk(file));
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'archive');
  assert.equal(result.reason, 'missing-document');
  assert.equal(result.path, 'document.json');
  assert.equal(result.payloadsRead, 0);
});

test('a bad name is refused before a NaN in document.json', async () => {
  const bytes = craftZip({
    entries: [
      storedEntry('../evil.json', Buffer.from('x')),
      storedEntry('manifest.json', Buffer.from(JSON.stringify(emptyManifest(writer)))),
      storedEntry('document.json', Buffer.from('{"view":NaN}')),
    ],
  });
  const result = await withFile(bytes, (file) => decodeObk(file));
  assert.equal(result.stage, 'archive');
  assert.equal(result.reason, 'dot-dot');
  assert.equal(result.payloadsRead, 0);
});

test('NaN is refused by the parser after the archive checks pass', async () => {
  const result = await withFile(archive('{"view":NaN}'), (file) => decodeObk(file));
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'json');
  assert.equal(result.reason, 'not-finite');
  assert.equal(result.path, '/view');
  assert.equal(result.entry, 'document.json');
  assert.match(result.message, /not finite/);
  assert.equal(result.payloadsRead, 2);
});

test('an unknown field is refused by the schema after JSON parses', async () => {
  const document = minimalDocument();
  document.author = 'x';
  const result = await withFile(archive(document), (file) => decodeObk(file));
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'schema');
  assert.equal(result.reason, 'unknown-field');
  assert.equal(result.path, '/author');
  assert.equal(result.entry, 'document.json');
});

test('a newer formatVersion is refused with the store message', async () => {
  const document = minimalDocument();
  document.author = 'later';
  const result = await withFile(archive(document, {
    format: 'obelisk',
    formatVersion: 2,
    writer: '9.0.0',
    images: [],
  }), (file) => decodeObk(file));
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'schema');
  assert.equal(result.reason, 'out-of-range');
  assert.equal(result.path, '/formatVersion');
  assert.equal(result.entry, 'manifest.json');
  assert.equal(result.message, 'Made by a newer Obelisk; update it from the Microsoft Store');
});

test('columns inside columns are refused', async () => {
  const result = await withFile(archive(minimalDocument([{
    type: 'columns',
    id: '00000000-0000-4000-8000-000000000003',
    columns: [
      {
        share: 0.5,
        blocks: [{
          type: 'columns',
          id: '00000000-0000-4000-8000-000000000004',
          columns: [],
        }],
      },
      { share: 0.5, blocks: [] },
    ],
  }])), (file) => decodeObk(file));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'out-of-range');
  assert.equal(result.path, '/blocks/0/columns/0/blocks/0/type');
});

test('a well-formed file decodes, including a surrogate pair and a byte order mark', async () => {
  const document = minimalDocument([paragraph(3, [textRun('a\uD800\uDC00b')])]);
  const plain = await withFile(archive(document), (file) => decodeObk(file));
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.equal(plain.document.blocks[0].content[0].text, 'a\uD800\uDC00b');
  assert.equal(plain.manifest.formatVersion, 1);

  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(document)),
  ]);
  const marked = await withFile(archive(bom), (file) => decodeObk(file));
  assert.equal(marked.ok, true, JSON.stringify(marked));
  assert.equal(marked.stage, 'document');
});

test('the utility child decodes, and the archive reply stays archive-only', async () => {
  const bad = await withFile(archive('{"view":NaN}'), async (file) => {
    const response = await decodeResponse({ id: 4, filePath: file });
    assert.equal(response.id, 4);
    return response.result;
  });
  assert.equal(bad.stage, 'json');
  assert.equal(bad.reason, 'not-finite');

  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-decode-archive-'));
  try {
    const file = path.join(directory, 'notes.obk');
    await writeFile(file, craftZip({
      entries: [
        storedEntry('manifest.json', HOSTILE_MANIFEST),
        storedEntry('document.json', HOSTILE_DOCUMENT),
      ],
    }));
    const response = await archiveResponse({ id: 5, filePath: file });
    assert.equal(response.result.ok, true);
    assert.equal(response.result.reason, 'ok');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
