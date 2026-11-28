import { FORMAT_NAME, FORMAT_VERSION } from '../schema/limits.js';
import type { Document, Manifest, ManifestImage } from '../schema/types.js';
import { manifestEntryFromAsset, type StoredImageAsset } from '../images/asset.js';

function imageHashesInBlock(block: { type: string; sha256?: string; columns?: { blocks: unknown[] }[] }): string[] {
  const hashes: string[] = [];
  if (block.type === 'image' || block.type === 'signature') {
    if (typeof block.sha256 === 'string') {
      hashes.push(block.sha256);
    }
  }
  if (block.type === 'columns' && Array.isArray(block.columns)) {
    for (const column of block.columns) {
      if (!column || !Array.isArray(column.blocks)) {
        continue;
      }
      for (const nested of column.blocks) {
        if (nested && typeof nested === 'object') {
          hashes.push(...imageHashesInBlock(nested as { type: string; sha256?: string; columns?: { blocks: unknown[] }[] }));
        }
      }
    }
  }
  return hashes;
}

export function imageHashesInDocument(document: Document): Set<string> {
  const used = new Set<string>();
  for (const block of document.blocks) {
    for (const hash of imageHashesInBlock(block)) {
      used.add(hash);
    }
  }
  return used;
}

export function buildManifestForSave(
  document: Document,
  writer: string,
  assets: readonly StoredImageAsset[],
): Manifest {
  const used = imageHashesInDocument(document);
  const byHash = new Map<string, StoredImageAsset>();
  for (const asset of assets) {
    byHash.set(asset.sha256, asset);
  }
  const images: ManifestImage[] = [];
  for (const hash of [...used].sort()) {
    const asset = byHash.get(hash);
    if (asset) {
      images.push(manifestEntryFromAsset(asset));
    }
  }
  images.sort((left, right) => (left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0));
  return {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    writer,
    images,
  };
}