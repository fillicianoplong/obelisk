import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { imageMessage } from '../../../dist/main/codec/images/index.js';
import { decodeResponse } from '../../../dist/main/codec/utility-child.js';
import { imageDocument, imageManifest, minimalDocument } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import {
  SVG_MARKUP,
  animatedWebp,
  gifFrames,
  jpegHeader,
  pngHeader,
  stillWebp,
} from '../../../scripts/make-hostile-fixtures/images.mjs';
import { craftZip, storedEntry } from '../../../scripts/make-hostile-fixtures/zip.mjs';

const writer = '0.1.21.0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function extensionFor(type) {
  return type === 'jpeg' ? 'jpg' : type;
}

function imageZip(bytes, type, width, height, frames, options = {}) {
  const hash = options.hash ?? sha256(bytes);
  const extension = options.extension ?? extensionFor(type);
  const manifest = options.manifest ?? imageManifest(writer, {
    sha256: hash,
    type,
    bytes: options.byteCount ?? bytes.length,
    width,
    height,
    frames,
  });
  const document = options.document ?? imageDocument(hash);
  const entries = [
    storedEntry('manifest.json', Buffer.from(JSON.stringify(manifest))),
    storedEntry('document.json', Buffer.from(typeof document === 'string' ? document : JSON.stringify(document))),
  ];
  if (!options.omit) {
    entries.push(storedEntry(options.name ?? `images/${hash}.${extension}`, bytes));
  }
  return craftZip({ entries });
}

async function openBytes(bytes) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-image-'));
  const file = path.join(directory, 'notes.obk');
  try {
    await writeFile(file, bytes);
    const before = sha256(bytes);
    const result = await decodeObk(file);
    assert.equal(sha256(await readFile(file)), before);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertRefused(result, reason, pathSuffix) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.stage, 'image');
  assert.equal(result.reason, reason);
  assert.equal(result.message, imageMessage(reason));
  assert.match(result.message, /not opened/);
  if (pathSuffix) {
    assert.equal(result.path.endsWith(pathSuffix), true, result.path);
  }
}

function chunk(tag, data) {
  const pad = data.length & 1;
  const out = Buffer.alloc(8 + data.length + pad);
  out.write(tag, 0, 4, 'ascii');
  out.writeUInt32LE(data.length, 4);
  data.copy(out, 8);
  return out;
}

function webpFile(parts) {
  const body = Buffer.concat(parts);
  const out = Buffer.alloc(12 + body.length);
  out.write('RIFF', 0, 4, 'ascii');
  out.writeUInt32LE(body.length + 4, 4);
  out.write('WEBP', 8, 4, 'ascii');
  body.copy(out, 12);
  return out;
}

function vp8x(width, height, animation) {
  const data = Buffer.alloc(10);
  if (animation) {
    data[0] = 0x02;
  }
  const widthMinus = width - 1;
  const heightMinus = height - 1;
  data[4] = widthMinus & 0xff;
  data[5] = (widthMinus >>> 8) & 0xff;
  data[6] = (widthMinus >>> 16) & 0xff;
  data[7] = heightMinus & 0xff;
  data[8] = (heightMinus >>> 8) & 0xff;
  data[9] = (heightMinus >>> 16) & 0xff;
  return data;
}

function vp8(width, height) {
  const payload = Buffer.alloc(10);
  payload[0] = 0x10;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload[6] = width & 0xff;
  payload[7] = (width >>> 8) & 0x3f;
  payload[8] = height & 0xff;
  payload[9] = (height >>> 8) & 0x3f;
  return payload;
}

function vp8l(width, height) {
  const bits = (width - 1) | ((height - 1) << 14);
  const data = Buffer.alloc(5);
  data[0] = 0x2f;
  data.writeUInt32LE(bits >>> 0, 1);
  return data;
}

function anmf(width, height, codedWidth, codedHeight) {
  const inner = chunk('VP8 ', vp8(codedWidth, codedHeight));
  const out = Buffer.alloc(16 + inner.length);
  const widthMinus = width - 1;
  const heightMinus = height - 1;
  out[6] = widthMinus & 0xff;
  out[7] = (widthMinus >>> 8) & 0xff;
  out[8] = (widthMinus >>> 16) & 0xff;
  out[9] = heightMinus & 0xff;
  out[10] = (heightMinus >>> 8) & 0xff;
  out[11] = (heightMinus >>> 16) & 0xff;
  out[15] = 0x02;
  inner.copy(out, 16);
  return out;
}

test('each still type opens when the header, the hash, and the manifest agree', async () => {
  const samples = [
    ['png', pngHeader(2, 3), 2, 3],
    ['jpeg', jpegHeader(4, 5), 4, 5],
    ['gif', gifFrames(1, 1, [{ x: 0, y: 0, width: 1, height: 1 }]), 1, 1],
    ['webp', stillWebp(6, 7), 6, 7],
  ];
  for (const [type, bytes, width, height] of samples) {
    const result = await openBytes(imageZip(bytes, type, width, height, 1));
    assert.equal(result.ok, true, `${type}: ${JSON.stringify(result)}`);
    assert.equal(result.stage, 'document');
    assert.equal(result.manifest.images[0].width, width);
    assert.equal(result.manifest.images[0].type, type);
    assert.equal(result.payloadsRead, 3);
  }
});

test('a header of 8000 pixels opens, and 8001 is refused before any pixel decode', async () => {
  const accepted = await openBytes(imageZip(pngHeader(8000, 1), 'png', 8000, 1, 1));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const refused = await openBytes(imageZip(pngHeader(8001, 1), 'png', 1, 1, 1));
  assertRefused(refused, 'header-too-large', '.png');
  assert.equal(refused.payloadsRead, 3);
});

test('the first bytes have to match the manifest type', async () => {
  const result = await openBytes(imageZip(jpegHeader(1, 1), 'png', 1, 1, 1));
  assertRefused(result, 'type-mismatch', '.png');
});

test('an extension that disagrees with the manifest type is refused', async () => {
  const bytes = pngHeader(1, 1);
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1, { extension: 'jpg' }));
  assertRefused(result, 'type-mismatch', '.jpg');
});

test('SVG bytes under an allowed image name are refused', async () => {
  const bytes = Buffer.from(SVG_MARKUP);
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1));
  assertRefused(result, 'svg', '.png');

  const declared = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
  const xml = await openBytes(imageZip(declared, 'webp', 1, 1, 1));
  assertRefused(xml, 'svg', '.webp');
});

test('an image entry missing from the manifest is refused', async () => {
  const bytes = pngHeader(1, 1);
  const hash = sha256(bytes);
  const result = await openBytes(craftZip({
    entries: [
      storedEntry('manifest.json', Buffer.from(JSON.stringify({
        format: 'obelisk',
        formatVersion: 1,
        writer,
        images: [],
      }))),
      storedEntry('document.json', Buffer.from(JSON.stringify(minimalDocument()))),
      storedEntry(`images/${hash}.png`, bytes),
    ],
  }));
  assertRefused(result, 'not-in-manifest', `${hash}.png`);
});

test('a manifest image with no entry is refused', async () => {
  const bytes = pngHeader(1, 1);
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1, { omit: true }));
  assertRefused(result, 'missing-entry', '.png');
});

test('a hash that does not match the entry bytes is refused', async () => {
  const bytes = pngHeader(1, 1);
  const listed = sha256(Buffer.from('listed'));
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1, {
    hash: listed,
    name: `images/${listed}.png`,
  }));
  assertRefused(result, 'hash-mismatch', `${listed}.png`);
});

test('a header that disagrees with the manifest is refused', async () => {
  const result = await openBytes(imageZip(pngHeader(2, 2), 'png', 1, 1, 1));
  assertRefused(result, 'manifest-mismatch', '.png');
});

test('the byte count in the manifest has to match the entry', async () => {
  const bytes = pngHeader(1, 1);
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1, { byteCount: bytes.length + 1 }));
  assertRefused(result, 'manifest-mismatch', '.png');
});

test('a GIF comment that contains a separator is not an extra frame', async () => {
  const gif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    1, 0, 1, 0, 0, 0, 0,
    0x21, 0xfe, 1, 0x2c, 0,
    0x21, 0xff, 11,
    ...Buffer.from('NETSCAPE2.0'),
    3, 1, 99, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x40, 2, 0,
    0x3b,
    0x2c,
  ]);
  const result = await openBytes(imageZip(gif, 'gif', 1, 1, 1));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.manifest.images[0].frames, 1);
});

test('GIF87a, a global palette, and a local palette each count as one frame', async () => {
  const gif87 = gifFrames(1, 1, [{ x: 0, y: 0, width: 1, height: 1 }]);
  gif87[4] = 0x37;
  const plain = await openBytes(imageZip(gif87, 'gif', 1, 1, 1));
  assert.equal(plain.ok, true, JSON.stringify(plain));

  const globalPalette = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    1, 0, 1, 0, 0x80, 0, 0,
    0, 0, 0, 255, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 0,
    0x3b,
  ]);
  const colored = await openBytes(imageZip(globalPalette, 'gif', 1, 1, 1));
  assert.equal(colored.ok, true, JSON.stringify(colored));

  const localPalette = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    1, 0, 1, 0, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80,
    0, 0, 0, 255, 0, 0,
    2, 0,
    0x3b,
  ]);
  const local = await openBytes(imageZip(localPalette, 'gif', 1, 1, 1));
  assert.equal(local.ok, true, JSON.stringify(local));
});

test('a GIF with no trailer is refused, including one whose screen is also too large', async () => {
  const gif = gifFrames(1, 1, [{ x: 0, y: 0, width: 1, height: 1 }]);
  const missing = await openBytes(imageZip(gif.subarray(0, gif.length - 1), 'gif', 1, 1, 1));
  assertRefused(missing, 'bad-image', '.gif');

  const wide = gifFrames(8001, 1, [{ x: 0, y: 0, width: 1, height: 1 }]);
  const both = await openBytes(imageZip(wide.subarray(0, wide.length - 1), 'gif', 1, 1, 1));
  assertRefused(both, 'header-too-large', '.gif');
});

test('1,000 GIF frames at the pixel budget open, and 1,001 frames are refused', async () => {
  const frames = Array.from({ length: 1000 }, () => ({ x: 0, y: 0, width: 500, height: 500 }));
  const accepted = await openBytes(imageZip(gifFrames(500, 500, frames), 'gif', 500, 500, 1000));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const tooMany = gifFrames(1, 1, Array.from({ length: 1001 }, () => ({ x: 0, y: 0, width: 1, height: 1 })));
  const refused = await openBytes(imageZip(tooMany, 'gif', 1, 1, 1));
  assertRefused(refused, 'too-many-frames', '.gif');
});

test('a GIF frame outside the screen is refused', async () => {
  const gif = gifFrames(8, 8, [{ x: 6, y: 6, width: 4, height: 4 }]);
  const result = await openBytes(imageZip(gif, 'gif', 8, 8, 1));
  assertRefused(result, 'frame-outside', '.gif');
});

test('a broken GIF or JPEG header is refused without treating it as a size', async () => {
  const truncated = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    1, 0, 1, 0, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
    2, 5, 1,
  ]);
  const gif = await openBytes(imageZip(truncated, 'gif', 1, 1, 1));
  assertRefused(gif, 'bad-image', '.gif');

  const marker = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x00]);
  const badBlock = await openBytes(imageZip(marker, 'gif', 1, 1, 1));
  assertRefused(badBlock, 'bad-image', '.gif');

  const sos = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
  const jpeg = await openBytes(imageZip(sos, 'jpeg', 1, 1, 1));
  assertRefused(jpeg, 'bad-image', '.jpg');

  const png = pngHeader(1, 1);
  png[29] ^= 0xff;
  const crc = await openBytes(imageZip(png, 'png', 1, 1, 1));
  assertRefused(crc, 'bad-image', '.png');
});

test('a JPEG size after an APP marker is the header size', async () => {
  const sof = jpegHeader(2, 3);
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const jpeg = Buffer.concat([sof.subarray(0, 2), app, sof.subarray(2)]);
  const result = await openBytes(imageZip(jpeg, 'jpeg', 2, 3, 1));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('WebP uses the RIFF size, the coded header, and the animation flag', async () => {
  const lossless = webpFile([
    chunk('VP8X', vp8x(2, 3, false)),
    chunk('VP8L', vp8l(2, 3)),
  ]);
  const still = await openBytes(imageZip(lossless, 'webp', 2, 3, 1));
  assert.equal(still.ok, true, JSON.stringify(still));

  const padded = webpFile([
    chunk('VP8X', vp8x(1, 1, false)),
    chunk('EXIF', Buffer.from('ANMF!')),
    chunk('VP8 ', vp8(1, 1)),
  ]);
  const exif = await openBytes(imageZip(padded, 'webp', 1, 1, 1));
  assert.equal(exif.ok, true, JSON.stringify(exif));

  const base = stillWebp(1, 1);
  const extra = chunk('ANMF', anmf(1, 1, 1, 1));
  const past = await openBytes(imageZip(Buffer.concat([base, extra]), 'webp', 1, 1, 1));
  assert.equal(past.ok, true, JSON.stringify(past));

  const mismatch = webpFile([
    chunk('VP8X', vp8x(8, 8, true)),
    chunk('ANIM', Buffer.from([255, 255, 255, 255, 0, 0])),
    chunk('ANMF', anmf(4, 4, 2, 2)),
  ]);
  const lied = await openBytes(imageZip(mismatch, 'webp', 8, 8, 1));
  assertRefused(lied, 'bad-image', '.webp');

  const clear = webpFile([
    chunk('VP8X', vp8x(1, 1, false)),
    chunk('ANMF', anmf(1, 1, 1, 1)),
  ]);
  const flag = await openBytes(imageZip(clear, 'webp', 1, 1, 1));
  assertRefused(flag, 'bad-image', '.webp');

  const huge = Buffer.alloc(10);
  huge[4] = 0xff;
  huge[5] = 0xff;
  huge[6] = 0xff;
  const canvas = webpFile([
    chunk('VP8X', huge),
    chunk('VP8 ', vp8(1, 1)),
  ]);
  const over = await openBytes(imageZip(canvas, 'webp', 1, 1, 1));
  assertRefused(over, 'header-too-large', '.webp');

  const budget = await openBytes(imageZip(animatedWebp(4, 8000, 8000), 'webp', 1, 1, 1));
  assertRefused(budget, 'pixel-budget', '.webp');
});

test('a coded WebP size over 8000 is refused even when the frame box is small', async () => {
  const wide = webpFile([
    chunk('VP8X', vp8x(1, 1, true)),
    chunk('ANIM', Buffer.from([255, 255, 255, 255, 0, 0])),
    chunk('ANMF', anmf(1, 1, 8001, 1)),
  ]);
  const result = await openBytes(imageZip(wide, 'webp', 1, 1, 1));
  assertRefused(result, 'header-too-large', '.webp');
});

test('the schema still runs before the image checks', async () => {
  const bytes = pngHeader(8001, 1);
  const hash = sha256(bytes);
  const document = imageDocument(hash);
  document.author = 'x';
  const result = await openBytes(imageZip(bytes, 'png', 1, 1, 1, { document }));
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'schema');
  assert.equal(result.reason, 'unknown-field');
});

test('the utility child reports an image refusal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-image-child-'));
  try {
    const file = path.join(directory, 'notes.obk');
    await writeFile(file, imageZip(pngHeader(8001, 8001), 'png', 1, 1, 1));
    const response = await decodeResponse({ id: 9, filePath: file });
    assert.equal(response.id, 9);
    assert.equal(response.result.stage, 'image');
    assert.equal(response.result.reason, 'header-too-large');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
