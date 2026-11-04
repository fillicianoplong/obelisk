import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { FIXED_MODIFIED_TIME, encodeObk } from '../../../dist/main/codec/encode/index.js';
import { blockId, emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { gifFrames, pngHeader } from '../../../scripts/make-hostile-fixtures/images.mjs';

const writer = '0.1.22.0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function reverseKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => reverseKeys(item));
  }
  if (value && typeof value === 'object') {
    const reversed = {};
    for (const key of Object.keys(value).reverse()) {
      reversed[key] = reverseKeys(value[key]);
    }
    return reversed;
  }
  return value;
}

function dosStamp(date) {
  let day = 0;
  day |= date.getDate() & 0x1f;
  day |= ((date.getMonth() + 1) & 0xf) << 5;
  day |= ((date.getFullYear() - 1980) & 0x7f) << 9;
  let time = 0;
  time |= Math.floor(date.getSeconds() / 2);
  time |= (date.getMinutes() & 0x3f) << 5;
  time |= (date.getHours() & 0x1f) << 11;
  return { day, time };
}

function zipEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const time = bytes.readUInt16LE(offset + 10);
    const day = bytes.readUInt16LE(offset + 12);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    entries.push({ name, method, time, day, extraLength, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function sampleDocument() {
  const png = pngHeader(8, 8);
  const gif = gifFrames(4, 4, [
    { x: 0, y: 0, width: 4, height: 4 },
    { x: 0, y: 0, width: 2, height: 2 },
  ]);
  const pngHash = sha256(png);
  const gifHash = sha256(gif);
  const document = minimalDocument([
    paragraph(3, [
      textRun('Hello "there"\n\\'),
      { type: 'text', text: 'a\uD800\uDC00b', marks: { bold: true, font: 'Liberation Serif', size: 12 } },
    ]),
    {
      type: 'image',
      id: blockId(4),
      sha256: pngHash,
      width: 4.25,
      rotation: 90,
      flipHorizontal: true,
      flipVertical: false,
      alt: 'A chart',
    },
    {
      type: 'image',
      id: blockId(5),
      sha256: gifHash,
      width: 1,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      alt: 'A frame',
    },
    {
      type: 'list',
      id: blockId(6),
      style: 'checklist',
      items: [{ level: 0, checked: false, content: [textRun('Done')] }],
    },
  ]);
  document.view = 'pages';
  return {
    document,
    manifest: {
      format: 'obelisk',
      formatVersion: 1,
      writer,
      images: [
        { sha256: gifHash, type: 'gif', bytes: gif.length, width: 4, height: 4, frames: 2 },
        { sha256: pngHash, type: 'png', bytes: png.length, width: 8, height: 8, frames: 1 },
      ],
    },
    images: [
      { sha256: pngHash, bytes: png },
      { sha256: gifHash, bytes: gif },
    ],
  };
}

async function withFile(bytes, check) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-encode-'));
  const file = path.join(directory, 'notes.obk');
  try {
    await writeFile(file, bytes);
    return await check(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('yazl 3.3.1 is published under the MIT license', async () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/yazl/package.json'), 'utf8'));
  assert.equal(pkg.version, '3.3.1');
  assert.equal(pkg.license, 'MIT');
  const license = await readFile(path.join(root, 'node_modules/yazl/LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('the same document encodes to the same bytes, in schema key order', async () => {
  const sample = sampleDocument();
  const first = await encodeObk(sample.document, sample.manifest, sample.images);
  const second = await encodeObk(
    reverseKeys(sample.document),
    reverseKeys(sample.manifest),
    [...sample.images].reverse(),
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(Buffer.compare(first.bytes, second.bytes), 0);

  const entries = zipEntries(first.bytes);
  const imageNames = sample.manifest.images
    .map((image) => `images/${image.sha256}.${image.type === 'jpeg' ? 'jpg' : image.type}`)
    .sort();
  assert.deepEqual(entries.map((entry) => entry.name), ['manifest.json', 'document.json', ...imageNames]);
  const stamp = dosStamp(FIXED_MODIFIED_TIME);
  for (const entry of entries) {
    assert.equal(entry.method, 8, entry.name);
    assert.equal(entry.extraLength, 0, entry.name);
    assert.equal(entry.time, stamp.time, entry.name);
    assert.equal(entry.day, stamp.day, entry.name);
  }
  assert.equal(entries[1].data.toString('utf8').startsWith('{"view":"pages"'), true);
  for (const image of sample.images) {
    const entry = entries.find((item) => item.name.includes(image.sha256));
    assert.ok(entry, image.sha256);
    assert.equal(entry.data.equals(image.bytes), true);
  }
});

test('encoding and decoding keep the content and the view', async () => {
  const sample = sampleDocument();
  const encoded = await encodeObk(sample.document, sample.manifest, sample.images);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const decoded = await withFile(encoded.bytes, (file) => decodeObk(file));
  assert.equal(decoded.ok, true, JSON.stringify(decoded));
  assert.equal(decoded.document.view, 'pages');
  assert.deepEqual(plain(decoded.document), plain(sample.document));
  assert.deepEqual(plain(decoded.manifest), plain(sample.manifest));

  const pageless = minimalDocument([paragraph(3, [textRun('Only text')])]);
  const textOnly = await encodeObk(pageless, emptyManifest(writer));
  assert.equal(textOnly.ok, true, JSON.stringify(textOnly));
  const opened = await withFile(textOnly.bytes, (file) => decodeObk(file));
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(opened.document.view, 'pageless');
  assert.deepEqual(plain(opened.document), plain(pageless));
  assert.deepEqual(plain(opened.manifest), plain(emptyManifest(writer)));
});

test('a document that fails the schema is not encoded', async () => {
  const document = minimalDocument();
  document.author = 'x';
  const result = await encodeObk(document, emptyManifest(writer));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-field');
  assert.equal(result.path, '/author');
});

test('image bytes have to match the manifest', async () => {
  const sample = sampleDocument();
  const png = sample.images[0];
  const gif = sample.images[1];
  const missing = await encodeObk(sample.document, sample.manifest);
  assert.equal(missing.ok, false);
  assert.equal(missing.path, '/images/0/sha256');

  const short = await encodeObk(sample.document, sample.manifest, [
    gif,
    { sha256: png.sha256, bytes: png.bytes.subarray(0, 2) },
  ]);
  assert.equal(short.ok, false);
  assert.equal(short.path, '/images/1/bytes');

  const wrong = Buffer.from(png.bytes);
  wrong[0] ^= 0xff;
  const mismatched = await encodeObk(sample.document, sample.manifest, [
    gif,
    { sha256: png.sha256, bytes: wrong },
  ]);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.path, '/images/1/sha256');
  assert.match(mismatched.message, /hash/);

  const extra = await encodeObk(minimalDocument(), emptyManifest(writer), [png]);
  assert.equal(extra.ok, false);
  assert.equal(extra.path, '/images');

  const repeated = await encodeObk(sample.document, sample.manifest, [png, png]);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.path, '/images');
});
