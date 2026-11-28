import type { PastedImageAsset } from '../../clipboard/types.js';
import {
  manifestEntryFromAsset,
  type StoredImageAsset,
  type StoredImageType,
} from '../../../shared/images/asset.js';
import type { IpcImagePayload } from '../../../shared/ipc/types.js';
import type { ManifestImage } from '../../../shared/schema/types.js';
import { displayInches, inspectImageBytes, sha256Hex } from '../../clipboard/image-bytes.js';

export type { StoredImageAsset };

export class ImageAssetStore {
  private readonly byHash = new Map<string, StoredImageAsset>();

  get(sha256: string): StoredImageAsset | undefined {
    return this.byHash.get(sha256);
  }

  put(asset: StoredImageAsset): void {
    this.byHash.set(asset.sha256, asset);
  }

  rememberPasted(asset: PastedImageAsset): void {
    this.put({
      sha256: asset.sha256,
      type: asset.type,
      bytes: asset.bytes,
      pixelWidth: asset.pixelWidth,
      pixelHeight: asset.pixelHeight,
      frames: asset.frames,
    });
  }

  rememberAllPasted(assets: readonly PastedImageAsset[]): void {
    for (const asset of assets) {
      this.rememberPasted(asset);
    }
  }

  list(): StoredImageAsset[] {
    return [...this.byHash.values()];
  }

  manifestEntries(): ManifestImage[] {
  return this.list().map((asset) => manifestEntryFromAsset(asset));
  }
}

const stores = new Map<string, ImageAssetStore>();

export function imageStoreForTab(tabId: string): ImageAssetStore {
  let store = stores.get(tabId);
  if (!store) {
    store = new ImageAssetStore();
    stores.set(tabId, store);
  }
  return store;
}

export function dropImageStore(tabId: string): void {
  stores.delete(tabId);
}

let activeTabId = '';

export function setActiveImageTabId(tabId: string): void {
  activeTabId = tabId;
}

export function activeImageStore(): ImageAssetStore {
  return imageStoreForTab(activeTabId);
}

export async function assetFromRawBytes(bytes: Uint8Array): Promise<StoredImageAsset | null> {
  const inspected = inspectImageBytes(bytes);
  if (!inspected) {
    return null;
  }
  const sha256 = await sha256Hex(bytes);
  return {
    sha256,
    type: inspected.type,
    bytes,
    pixelWidth: inspected.width,
    pixelHeight: inspected.height,
    frames: inspected.frames,
  };
}

export function defaultImageWidth(pixelWidth: number): number {
  return displayInches(pixelWidth);
}

export function assetToIpc(asset: StoredImageAsset): IpcImagePayload {
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < asset.bytes.length; index += chunk) {
    const slice = asset.bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }
  return {
    sha256: asset.sha256,
    data: btoa(binary),
    type: asset.type,
    pixelWidth: asset.pixelWidth,
    pixelHeight: asset.pixelHeight,
    frames: asset.frames,
  };
}

export function imagesForTab(tabId: string): IpcImagePayload[] {
  return imageStoreForTab(tabId).list().map((asset) => assetToIpc(asset));
}

export function assetFromPicked(input: {
  sha256: string;
  type: StoredImageType;
  data: string;
  pixelWidth: number;
  pixelHeight: number;
  frames: number;
}): StoredImageAsset {
  const binary = atob(input.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return {
    sha256: input.sha256,
    type: input.type,
    bytes,
    pixelWidth: input.pixelWidth,
    pixelHeight: input.pixelHeight,
    frames: input.frames,
  };
}