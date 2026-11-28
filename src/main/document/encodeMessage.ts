import { encodeObk } from '../codec/encode/index.js';
import type { SourceImage } from '../codec/encode/index.js';
import { buildManifestForSave } from '../../shared/manifest/build.js';
import type { StoredImageAsset } from '../../shared/images/asset.js';
import type { Document } from '../../shared/schema/index.js';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type { DocumentMessage, IpcImagePayload } from '../../shared/ipc/types.js';

const ENCODE_FAILED_MESSAGE = 'This document is not valid, so it was not saved.';

function storedAssetsFromIpc(images: readonly IpcImagePayload[]): StoredImageAsset[] {
  const assets: StoredImageAsset[] = [];
  for (const image of images) {
    const bytes = Buffer.from(image.data, 'base64');
    assets.push({
      sha256: image.sha256,
      type: image.type,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      pixelWidth: image.pixelWidth,
      pixelHeight: image.pixelHeight,
      frames: image.frames,
    });
  }
  return assets;
}

function sourceImagesFromIpc(images: readonly IpcImagePayload[]): SourceImage[] {
  return images.map((image) => {
    const bytes = Buffer.from(image.data, 'base64');
    return {
      sha256: image.sha256,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
  });
}

export async function encodeDocumentMessage(
  document: DocumentMessage,
  images: readonly IpcImagePayload[],
  writer: string,
): Promise<{ ok: true; bytes: Buffer } | IpcErrorResult> {
  const assets = storedAssetsFromIpc(images);
  const manifest = buildManifestForSave(document as unknown as Document, writer, assets);
  const used = new Set(manifest.images.map((image) => image.sha256));
  const payload = images.filter((image) => used.has(image.sha256));
  let encoded;
  try {
    encoded = await encodeObk(document, manifest, sourceImagesFromIpc(payload));
  } catch {
    return ipcError('ENCODE_FAILED', ENCODE_FAILED_MESSAGE);
  }
  if (!encoded.ok) {
    return ipcError('ENCODE_FAILED', ENCODE_FAILED_MESSAGE);
  }
  return { ok: true, bytes: encoded.bytes };
}