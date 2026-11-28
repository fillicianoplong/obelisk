import { inspectImageBytes, sha256Hex } from '../../clipboard/image-bytes.js';

export interface StoredSignatureAsset {
  sha256: string;
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

export class SignatureAssetStore {
  private readonly byHash = new Map<string, StoredSignatureAsset>();

  get(sha256: string): StoredSignatureAsset | undefined {
    return this.byHash.get(sha256);
  }

  put(asset: StoredSignatureAsset): void {
    this.byHash.set(asset.sha256, asset);
  }
}

const stores = new Map<string, SignatureAssetStore>();

export function signatureStoreForTab(tabId: string): SignatureAssetStore {
  let store = stores.get(tabId);
  if (!store) {
    store = new SignatureAssetStore();
    stores.set(tabId, store);
  }
  return store;
}

export function dropSignatureStore(tabId: string): void {
  stores.delete(tabId);
}

let activeTabId = '';

export function setActiveSignatureTabId(tabId: string): void {
  activeTabId = tabId;
}

export function activeSignatureStore(): SignatureAssetStore {
  return signatureStoreForTab(activeTabId);
}

export async function assetFromRawBytes(bytes: Uint8Array): Promise<StoredSignatureAsset | null> {
  const inspected = inspectImageBytes(bytes);
  if (inspected === null) {
    return null;
  }
  const sha256 = await sha256Hex(bytes);
  return {
    sha256,
    bytes,
    pixelWidth: inspected.width,
    pixelHeight: inspected.height,
  };
}