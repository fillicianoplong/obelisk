import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import {
  CONVERSION_FAILED_MESSAGE,
  MIGRATION_STEPS,
  NEWER_VERSION_MESSAGE,
  OLDER_VERSION_MESSAGE,
  migrateOpened,
} from '../../../dist/main/codec/migrate/index.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';

const writer = '0.1.22.0';

function legacy(text) {
  return {
    document: { view: 'pageless', text },
    manifest: { format: 'obelisk', formatVersion: 0, writer: 'test-only', images: [] },
  };
}

function stepToCurrent(from, to, textField = 'text') {
  return {
    from,
    to,
    convert(document, manifest) {
      const text = typeof document[textField] === 'string' ? document[textField] : '';
      return {
        document: minimalDocument([paragraph(3, [textRun(text)])]),
        manifest: {
          format: 'obelisk',
          formatVersion: to,
          writer: manifest.writer,
          images: [],
        },
      };
    },
  };
}

test('the production step list is empty', () => {
  assert.equal(MIGRATION_STEPS.length, 0);
  const current = emptyManifest(writer);
  const document = minimalDocument([paragraph(3, [textRun('Hi')])]);
  const same = migrateOpened(document, current);
  assert.equal(same.ok, true);
  assert.equal(same.migrated, false);
  assert.equal(same.document, document);
  assert.equal(same.manifest, current);
});

test('an older version is refused until a test-only step converts it', async () => {
  const source = legacy('Hello');
  const refused = migrateOpened(source.document, source.manifest);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'out-of-range');
  assert.equal(refused.path, '/formatVersion');
  assert.equal(refused.message, OLDER_VERSION_MESSAGE);
  assert.equal(source.manifest.formatVersion, 0);
  assert.equal(source.document.text, 'Hello');

  const jumping = [{ from: 0, to: 2, convert: stepToCurrent(0, 1).convert }];
  const skipped = migrateOpened(source.document, source.manifest, jumping);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.message, OLDER_VERSION_MESSAGE);

  const converted = migrateOpened(source.document, source.manifest, [stepToCurrent(0, 1)]);
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.migrated, true);
  assert.equal(converted.formatVersion, 1);
  assert.equal(converted.document.view, 'pageless');
  assert.equal(converted.document.blocks[0].content[0].text, 'Hello');
  assert.equal(source.document.text, 'Hello');

  const encoded = await encodeObk(converted.document, converted.manifest);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-migrate-'));
  try {
    const file = path.join(directory, 'notes.obk');
    await writeFile(file, encoded.bytes);
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    assert.equal(decoded.document.view, 'pageless');
    assert.deepEqual(JSON.parse(JSON.stringify(decoded.document)), JSON.parse(JSON.stringify(converted.document)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('steps run one version at a time and cannot change the input', () => {
  const document = { view: 'pageless', text: 'keep' };
  const manifest = { format: 'obelisk', formatVersion: 0, writer: 'test-only' };
  const steps = [
    {
      from: 1,
      to: 2,
      convert(doc, man) {
        return {
          document: doc,
          manifest: { ...man, formatVersion: 2 },
        };
      },
    },
    {
      from: 0,
      to: 1,
      convert(doc, man) {
        doc.text = 'changed';
        man.writer = 'changed';
        return stepToCurrent(0, 1).convert(
          { view: 'pageless', text: 'keep' },
          { format: 'obelisk', formatVersion: 0, writer: 'test-only' },
        );
      },
    },
  ];
  const converted = migrateOpened(document, manifest, steps, 2);
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.migrated, true);
  assert.equal(converted.formatVersion, 2);
  assert.equal(converted.document.blocks[0].content[0].text, 'keep');
  assert.equal(document.text, 'keep');
  assert.equal(manifest.writer, 'test-only');
});

test('a step that throws or does not advance is refused', () => {
  const source = legacy('Hello');
  const thrown = migrateOpened(source.document, source.manifest, [{
    from: 0,
    to: 1,
    convert() {
      throw new Error('nope');
    },
  }]);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, 'invalid');
  assert.equal(thrown.message, CONVERSION_FAILED_MESSAGE);

  const stuck = migrateOpened(source.document, source.manifest, [{
    from: 0,
    to: 1,
    convert(document, manifest) {
      return { document, manifest };
    },
  }]);
  assert.equal(stuck.ok, false);
  assert.equal(stuck.message, CONVERSION_FAILED_MESSAGE);
});

test('a version that is not a whole number is left for the schema', () => {
  const manifest = { format: 'obelisk', formatVersion: 1.5, writer, images: [] };
  const document = minimalDocument();
  const result = migrateOpened(document, manifest);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, false);
  assert.equal(result.manifest, manifest);

  const textVersion = migrateOpened(document, { ...manifest, formatVersion: '2' });
  assert.equal(textVersion.ok, true);
  assert.equal(textVersion.migrated, false);
});

test('a newer formatVersion is the store message', () => {
  const result = migrateOpened(minimalDocument(), {
    format: 'obelisk',
    formatVersion: 2,
    writer: '9.0.0',
    images: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'out-of-range');
  assert.equal(result.path, '/formatVersion');
  assert.equal(result.message, NEWER_VERSION_MESSAGE);
});
