import { createHash } from 'node:crypto';
import type { Manifest, ManifestImage } from '../../../shared/schema/index.js';
import { assessGeometry } from './limits.js';
import { measureImage } from './measure.js';
import { imageFailure, type ImageResult } from './result.js';
import { sniffImage } from './sniff.js';

// Runs after the schema, on entry bytes whose CRC already matched. The
// manifest hash, the type, and the header sizes have to agree. Pixels stay
// unread: GIF blocks and WebP chunks are walked, and PNG and JPEG stop at
// the size field.

const IMAGE_NAME = /^images\/([0-9a-f]{64})\.(png|jpg|gif|webp)$/;

const TYPE_FOR_EXTENSION = {
  png: 'png',
  jpg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
} as const;

type ImageType = ManifestImage['type'];

export interface ImageEntryBytes {
  name: string;
  bytes: Uint8Array;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extensionFor(type: ImageType): string {
  return type === 'jpeg' ? 'jpg' : type;
}

export function imageEntryName(image: ManifestImage): string {
  return `images/${image.sha256}.${extensionFor(image.type)}`;
}

export function checkImageEntries(manifest: Manifest, entries: readonly ImageEntryBytes[]): ImageResult {
  const listed = new Map<string, ManifestImage>();
  for (const image of manifest.images) {
    listed.set(image.sha256, image);
  }
  const seen = new Set<string>();

  for (const entry of entries) {
    const match = IMAGE_NAME.exec(entry.name);
    if (!match) {
      return imageFailure('bad-image', entry.name);
    }
    const hash = match[1] ?? '';
    const extension = match[2] ?? '';
    const image = listed.get(hash);
    if (!image) {
      return imageFailure('not-in-manifest', entry.name);
    }
    if (seen.has(hash)) {
      return imageFailure('bad-image', entry.name);
    }
    seen.add(hash);
    if (sha256(entry.bytes) !== hash) {
      return imageFailure('hash-mismatch', entry.name);
    }
    const sniffed = sniffImage(entry.bytes);
    if (sniffed === 'svg') {
      return imageFailure('svg', entry.name);
    }
    const declared = TYPE_FOR_EXTENSION[extension as keyof typeof TYPE_FOR_EXTENSION];
    if (sniffed !== 'png' && sniffed !== 'jpeg' && sniffed !== 'gif' && sniffed !== 'webp') {
      return imageFailure('type-mismatch', entry.name);
    }
    if (declared !== image.type || sniffed !== image.type) {
      return imageFailure('type-mismatch', entry.name);
    }
    const geometry = assessGeometry(measureImage(sniffed, entry.bytes));
    if (!geometry.ok) {
      return imageFailure(geometry.reason, entry.name);
    }
    if (
      image.bytes !== entry.bytes.length ||
      image.width !== geometry.width ||
      image.height !== geometry.height ||
      image.frames !== geometry.frames
    ) {
      return imageFailure('manifest-mismatch', entry.name);
    }
  }

  for (const image of manifest.images) {
    if (!seen.has(image.sha256)) {
      return imageFailure('missing-entry', imageEntryName(image));
    }
  }
  return { ok: true };
}
