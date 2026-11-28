import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gifFrames, jpegHeader, pngHeader, stillWebp } from '../../../scripts/make-hostile-fixtures/images.mjs';
import { blockId, minimalDocument } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { buildManifestForSave } from '../../../dist/shared/manifest/build.js';
import { inspectFileImageBytes } from '../../../dist/main/images/inspect.js';
import {
  IMAGE_INSERT_DIMENSIONS,
  IMAGE_INSERT_TOO_LARGE,
} from '../../../dist/shared/images/messages.js';
import { IMAGE_MAX_BYTES } from '../../../dist/shared/schema/index.js';

const commandsUrl = new URL('../../../src/renderer/blocks/image/commands.ts', import.meta.url);
const assetsUrl = new URL('../../../src/renderer/blocks/image/assets.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-commands.ts', import.meta.url);
const { insertImageAssetCommand, applyPickedImage } = await loadRenderer(commandsUrl);
const assets = await loadRenderer(assetsUrl);
const mapping = await loadRenderer(mappingUrl);
const slash = await loadRenderer(slashUrl);
const { createTabEditorState } = await loadRenderer(new URL('../../../src/renderer/editor/state.ts', import.meta.url));
const { newBlockId } = await loadRenderer(new URL('../../../src/renderer/editor/block-id.ts', import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sampleAsset(bytes, type) {
  const hash = sha256(bytes);
  return {
    sha256: hash,
    type,
    bytes,
    pixelWidth: type === 'png' ? 8 : 4,
    pixelHeight: type === 'png' ? 8 : 4,
    frames: type === 'gif' ? 2 : 1,
  };
}

test('each supported image type inserts a structured image block', () => {
  const types = [
    ['png', pngHeader(8, 8)],
    ['jpeg', jpegHeader(8, 8)],
    ['gif', gifFrames(4, 4, [{ x: 0, y: 0, width: 4, height: 4 }])],
    ['webp', stillWebp(8, 8)],
  ];
  for (const [type, bytes] of types) {
    assets.setActiveImageTabId(`tab-${type}`);
    const asset = sampleAsset(bytes, type);
    assets.imageStoreForTab(`tab-${type}`).put(asset);
    let state = createTabEditorState();
    let applied = false;
    insertImageAssetCommand(asset)(state, (tr) => {
      state = state.apply(tr);
      applied = true;
    });
    assert.equal(applied, true);
    const block = state.doc.child(1);
    assert.equal(block.type.name, 'structured_block');
    assert.equal(block.attrs.blockType, 'image');
  }
});

test('inspect refuses a 20 MB + 1 byte image and an 8001 pixel header', () => {
  const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
  big.set(pngHeader(4, 4));
  assert.equal(inspectFileImageBytes(big).status, 'refused');
  assert.equal(inspectFileImageBytes(big).message, IMAGE_INSERT_TOO_LARGE);
  const wide = pngHeader(8001, 1);
  const refused = inspectFileImageBytes(wide);
  assert.equal(refused.status, 'refused');
  assert.equal(refused.message, IMAGE_INSERT_DIMENSIONS);
});

test('animated GIF bytes round-trip through encode and decode', async () => {
  const bytes = gifFrames(6, 6, [
    { x: 0, y: 0, width: 6, height: 6 },
    { x: 0, y: 0, width: 6, height: 6 },
  ]);
  const hash = sha256(bytes);
  const document = minimalDocument([{
    type: 'image',
    id: blockId(20),
    sha256: hash,
    width: 2,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    alt: 'spin',
  }]);
  const manifest = buildManifestForSave(document, '0.1.56.0', [{
    sha256: hash,
    type: 'gif',
    bytes,
    pixelWidth: 6,
    pixelHeight: 6,
    frames: 2,
  }]);
  const encoded = await encodeObk(document, manifest, [{ sha256: hash, bytes }]);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-image-'));
  const file = path.join(dir, 'spin.obk');
  try {
    await writeFile(file, encoded.bytes);
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    assert.equal(decoded.packedImages.length, 1);
    assert.equal(decoded.packedImages[0].sha256, hash);
    assert.equal(decoded.manifest.images[0].frames, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('slash image removes the typed filter', () => {
  const item = { id: 'image', label: 'Image', block: { kind: 'image' } };
  const base = createTabEditorState();
  const state = base.apply(base.tr.insertText('/image'));
  const tr = slash.applySlashMenuItem(state, 1, item, undefined);
  assert.ok(tr);
  assert.equal(tr.doc.textContent, '');
});

test('picked bytes enter the tab store and mapping emits an image block', () => {
  const bytes = pngHeader(16, 16);
  const hash = sha256(bytes);
  assets.setActiveImageTabId('pick-tab');
  const payload = {
    sha256: hash,
    type: 'png',
    data: Buffer.from(bytes).toString('base64'),
    pixelWidth: 16,
    pixelHeight: 16,
    frames: 1,
  };
  let state = createTabEditorState();
  applyPickedImage(payload)(state, (tr) => { state = state.apply(tr); });
  const built = mapping.documentFromEditorDoc(
    {
      view: 'pages',
      page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
      header: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
      footer: { id: newBlockId(), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
      blocks: [],
    },
    state.doc,
    newBlockId,
  );
  const image = built.document.blocks.find((block) => block.type === 'image');
  assert.ok(image);
  assert.equal(image.sha256, hash);
  assert.match(IMAGE_INSERT_TOO_LARGE, /not inserted/);
});