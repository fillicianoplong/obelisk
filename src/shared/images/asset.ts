import type { ManifestImage } from '../schema/types.js';

export type StoredImageType = ManifestImage['type'];

export interface StoredImageAsset {
  sha256: string;
  type: StoredImageType;
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  frames: number;
}

export interface IpcImageBytes {
  sha256: string;
  data: string;
}

export function manifestEntryFromAsset(asset: StoredImageAsset): ManifestImage {
  return {
    sha256: asset.sha256,
    type: asset.type,
    bytes: asset.bytes.byteLength,
    width: asset.pixelWidth,
    height: asset.pixelHeight,
    frames: asset.frames,
  };
}