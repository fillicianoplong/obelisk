import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { archiveMessage, readArchive } from '../../dist/main/codec/archive/index.js';
import { decodeObk } from '../../dist/main/codec/decode.js';
import { NEWER_VERSION_MESSAGE } from '../../dist/main/codec/migrate/index.js';
import {
  ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  ANIMATION_FRAME_MAX,
  ANIMATION_PIXEL_MAX,
  BLOCK_MAX,
  DOCUMENT_JSON_MAX_BYTES,
  ENTRY_MAX_COUNT,
  FILE_MAX_BYTES,
  IMAGE_DIMENSION_MAX,
  IMAGE_MAX_BYTES,
  TABLE_COLUMN_MAX,
  TABLE_ROW_MAX,
  TEXT_MAX_CHARS,
  checkDocument,
  checkManifest,
  checkPair,
} from '../../dist/shared/schema/index.js';
import {
  HOSTILE_DOCUMENT,
  HOSTILE_MANIFEST,
  generateHostileFixtures,
  hostileRows,
  pendingText,
} from '../../scripts/make-hostile-fixtures/generate.mjs';
import {
  ANIMATION_FRAME_MAX as fixtureFrameMax,
  ANIMATION_PIXEL_MAX as fixturePixelMax,
  ARCHIVE_MAX_UNCOMPRESSED_BYTES as fixtureArchiveMax,
  BLOCK_MAX as fixtureBlockMax,
  DOCUMENT_JSON_MAX_BYTES as fixtureDocumentMax,
  ENTRY_MAX_COUNT as fixtureEntryMax,
  FILE_MAX_BYTES as fixtureFileMax,
  FIXTURE_DISK_MAX_BYTES,
  FORGED_DECLARED_SIZE,
  IMAGE_DIMENSION_MAX as fixtureDimensionMax,
  IMAGE_MAX_BYTES as fixtureImageMax,
  TABLE_COLUMN_MAX as fixtureColumnMax,
  TABLE_ROW_MAX as fixtureRowMax,
  TEXT_MAX_CHARS as fixtureTextMax,
} from '../../scripts/make-hostile-fixtures/limits.mjs';
import { eocdEntryCount, localUncompressedSizes } from '../../scripts/make-hostile-fixtures/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-hostile-'));

let cases;
try {
  cases = (await generateHostileFixtures(directory, root)).cases;
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function runCheck(check, bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (check === 'document') {
    return checkDocument(value);
  }
  if (check === 'manifest') {
    return checkManifest(value);
  }
  if (check === 'pair') {
    return checkPair(value.document, value.manifest);
  }
  throw new Error(`No checker for ${check}.`);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function assertArchive(item, result) {
  assert.equal(result.message, archiveMessage(item.expectReason), item.key);
  assert.equal(result.message.length > 0, true, item.key);
  if (item.key === 'H-09-missing-document') {
    assert.match(result.message, /document\.json/);
  }
  if (item.key === 'H-01-file-size') {
    assert.equal(result.opened, false, item.key);
  }
  if (item.id === 'H-01') {
    assert.equal(result.entriesRead, 0, item.key);
    assert.equal(result.payloadsRead, 0, item.key);
    assert.equal(result.bytesRead, 0, item.key);
    return;
  }
  if (item.key === 'H-02-document-cap') {
    assert.equal(result.payloadsRead, 2, item.key);
    assert.equal(result.cappedEntryBytesRead, DOCUMENT_JSON_MAX_BYTES, item.key);
    assert.equal(result.bytesRead, HOSTILE_MANIFEST.length + DOCUMENT_JSON_MAX_BYTES, item.key);
    return;
  }
  if (item.key === 'H-02-image-cap') {
    assert.equal(result.payloadsRead, 3, item.key);
    assert.equal(result.cappedEntryBytesRead, IMAGE_MAX_BYTES, item.key);
    assert.equal(
      result.bytesRead,
      HOSTILE_MANIFEST.length + HOSTILE_DOCUMENT.length + IMAGE_MAX_BYTES,
      item.key,
    );
    return;
  }
  if (item.key === 'H-02-total-cap') {
    assert.equal(result.bytesRead, ARCHIVE_MAX_UNCOMPRESSED_BYTES, item.key);
    assert.equal(typeof result.cappedEntryBytesRead, 'number', item.key);
    assert.ok(result.cappedEntryBytesRead < IMAGE_MAX_BYTES, item.key);
    assert.ok(result.payloadsRead > 2, item.key);
    return;
  }
  if (item.key === 'H-02-declared-lie') {
    assert.equal(result.payloadsRead, 2, item.key);
    assert.equal(result.bytesRead, HOSTILE_MANIFEST.length + 1000, item.key);
    assert.equal(result.cappedEntryBytesRead, null, item.key);
    return;
  }
  if (item.key === 'H-08-nested-bytes') {
    assert.equal(result.payloadsRead, 1, item.key);
    assert.ok(result.bytesRead >= 4, item.key);
    assert.ok(result.bytesRead < IMAGE_MAX_BYTES, item.key);
    return;
  }
  assert.equal(result.payloadsRead, 0, item.key);
  assert.equal(result.bytesRead, 0, item.key);
}

async function assertAttempt(item) {
  const beforeStat = await stat(item.filePath);
  const before = await sha256File(item.filePath);
  const result = item.check === 'archive'
    ? await readArchive(item.filePath)
    : item.check === 'decode'
      ? await decodeObk(item.filePath)
      : runCheck(item.check, await readFile(item.filePath));
  if (item.outcome === 'refused') {
    assert.equal(result.ok, false, `${item.key}: ${JSON.stringify(result)}`);
    assert.equal(result.reason, item.expectReason, item.key);
    assert.equal(result.path, item.expectPath, item.key);
  } else if (item.outcome === 'accepted') {
    assert.equal(result.ok, true, `${item.key}: ${JSON.stringify(result)}`);
    if (item.expectText !== null) {
      assert.equal(result.value.blocks[0].content[0].text, item.expectText);
    }
  } else {
    throw new Error(`${item.key} is ${item.outcome} and has no active checker.`);
  }
  if (item.check === 'archive') {
    assertArchive(item, result);
  }
  if (item.key === 'H-15-message') {
    assert.equal(NEWER_VERSION_MESSAGE, 'Made by a newer Obelisk; update it from the Microsoft Store');
    assert.equal(result.message, NEWER_VERSION_MESSAGE, item.key);
  }
  const afterStat = await stat(item.filePath);
  assert.equal(afterStat.size, beforeStat.size, item.key);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, item.key);
  assert.equal(await sha256File(item.filePath), before, item.key);
}

test('hostile caps match the format 1 schema', () => {
  assert.equal(fixtureFileMax, FILE_MAX_BYTES);
  assert.equal(fixtureEntryMax, ENTRY_MAX_COUNT);
  assert.equal(fixtureDocumentMax, DOCUMENT_JSON_MAX_BYTES);
  assert.equal(fixtureImageMax, IMAGE_MAX_BYTES);
  assert.equal(fixtureArchiveMax, ARCHIVE_MAX_UNCOMPRESSED_BYTES);
  assert.equal(fixtureDimensionMax, IMAGE_DIMENSION_MAX);
  assert.equal(fixtureFrameMax, ANIMATION_FRAME_MAX);
  assert.equal(fixturePixelMax, ANIMATION_PIXEL_MAX);
  assert.equal(fixtureBlockMax, BLOCK_MAX);
  assert.equal(fixtureTextMax, TEXT_MAX_CHARS);
  assert.equal(fixtureRowMax, TABLE_ROW_MAX);
  assert.equal(fixtureColumnMax, TABLE_COLUMN_MAX);
});

test('the generator writes one fixture for every H-01 to H-32 sample', async () => {
  const rows = hostileRows(await readFile(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8'));
  const ids = Array.from({ length: 32 }, (_, index) => `H-${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(rows.map((row) => row.id), ids);
  for (const row of rows) {
    const group = cases.filter((item) => item.id === row.id);
    assert.ok(group.length > 0, row.id);
    for (const item of group) {
      assert.equal(item.sample, row.sample, item.key);
      assert.equal(item.expected, row.expected, item.key);
      assert.equal(item.expected.length > 0, true, item.key);
      if (item.pending.length > 0) {
        assert.equal(item.check, null, item.key);
        assert.match(pendingText(item.pending), /^pending #\d+ /, item.key);
      } else {
        assert.ok(item.check, item.key);
        if (item.outcome === 'refused') {
          assert.equal(typeof item.expectReason, 'string', item.key);
          assert.equal(typeof item.expectPath, 'string', item.key);
        }
      }
    }
  }

  const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.cases.map((item) => item.key), cases.map((item) => item.key));

  const oversize = cases.find((item) => item.key === 'H-01-file-size');
  assert.equal((await stat(oversize.filePath)).size, FILE_MAX_BYTES + 1);
  const counted = await readFile(cases.find((item) => item.key === 'H-01-entry-count').filePath);
  assert.equal(eocdEntryCount(counted), ENTRY_MAX_COUNT + 1);
  const bomb = await readFile(cases.find((item) => item.key === 'H-02-document-cap').filePath);
  assert.equal(localUncompressedSizes(bomb)[1], FORGED_DECLARED_SIZE);
  assert.ok(bomb.length < FIXTURE_DISK_MAX_BYTES);

  const duplicate = await readFile(cases.find((item) => item.key === 'H-11-duplicate').filePath, 'utf8');
  assert.equal(duplicate.split('"view"').length - 1, 2);
  const nan = await readFile(cases.find((item) => item.key === 'H-11-nan').filePath, 'utf8');
  assert.equal(nan.includes('NaN'), true);
  assert.equal(nan.includes('"pageless"'), false);
  const infinity = await readFile(cases.find((item) => item.key === 'H-11-infinity').filePath, 'utf8');
  assert.equal(infinity.includes('Infinity'), true);

  const exported = JSON.parse(await readFile(cases.find((item) => item.key === 'H-26-export').filePath, 'utf8'));
  for (const field of ['text', 'alt', 'linkText']) {
    assert.equal(exported[field].includes('<'), true, field);
    assert.equal(exported[field].includes('&'), true, field);
    assert.equal(exported[field].includes(']]>'), true, field);
    assert.equal(exported[field].includes('\u0000'), true, field);
    assert.equal(exported[field].includes('\uD800x\uDC00'), true, field);
  }
  const argv = JSON.parse(await readFile(cases.find((item) => item.key === 'H-25-argv').filePath, 'utf8'));
  assert.equal(argv.args.filter((arg) => arg.endsWith('.obk')).length, 21);
  assert.equal(argv.args.includes('--inspect'), true);
  assert.equal(argv.args.includes('C:\\Notes'), true);

  const gifArchive = await readFile(cases.find((item) => item.key === 'H-27-gif').filePath);
  const gifStart = gifArchive.indexOf('GIF89a');
  assert.ok(gifStart >= 0);
  let frames = 0;
  for (let index = gifStart; index < gifArchive.length; index += 1) {
    if (gifArchive[index] === 0x3b) {
      break;
    }
    if (gifArchive[index] === 0x2c) {
      frames += 1;
    }
  }
  assert.equal(frames, ANIMATION_FRAME_MAX + 1);

  const seen = new Set();
  for (const item of cases) {
    const info = await stat(item.filePath);
    assert.ok(info.size > 0, item.key);
    if (item.key !== 'H-01-file-size') {
      assert.ok(info.size <= FIXTURE_DISK_MAX_BYTES, `${item.key} is ${info.size} bytes`);
    }
    seen.add(item.filePath);
  }
  assert.ok(seen.size >= 32);
});

for (const item of cases) {
  if (item.pending.length > 0) {
    test(`${item.id} ${item.title} — ${pendingText(item.pending)}`, { todo: true });
  } else {
    const options = item.check === 'archive' || item.check === 'decode' ? { timeout: 120_000 } : {};
    test(`${item.id} ${item.title} is ${item.outcome} and the file is unchanged`, options, async () => {
      await assertAttempt(item);
    });
  }
}
