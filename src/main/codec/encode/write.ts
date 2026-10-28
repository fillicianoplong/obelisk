import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { checkPair, type Manifest } from '../../../shared/schema/index.js';
import { canonicalDocumentJson, canonicalManifestJson } from './json.js';

// yazl 3.3.1, MIT, writes the archive (ADR-013). The modified time is the
// spike S-08 instant, and the DOS stamp is the only timestamp, so two encodes
// of one document in this process are the same bytes. This writes memory only.

export const FIXED_MODIFIED_TIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

const ENTRY_OPTIONS = {
  mtime: FIXED_MODIFIED_TIME,
  compressionLevel: 6,
  forceDosTimestamp: true,
  mode: 0o100644,
};

const IMAGE_EXTENSION: Record<Manifest['images'][number]['type'], string> = {
  png: 'png',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
};

export interface SourceImage {
  sha256: string;
  bytes: Uint8Array;
}

export interface EncodeFailure {
  ok: false;
  reason: string;
  path: string;
  message: string;
}

export type EncodeResult = { ok: true; bytes: Buffer } | EncodeFailure;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function failure(reason: string, path: string, message: string): EncodeFailure {
  return { ok: false, reason, path, message };
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function imageName(image: Manifest['images'][number]): string {
  return `images/${image.sha256}.${IMAGE_EXTENSION[image.type]}`;
}

function prepare(
  document: unknown,
  manifest: unknown,
  images: readonly SourceImage[],
): EncodeFailure | { ok: true; entries: ZipEntry[] } {
  const checked = checkPair(document, manifest);
  if (!checked.ok) {
    return failure(checked.reason, checked.path, checked.message);
  }

  const provided = new Map<string, Uint8Array>();
  for (const image of images) {
    if (provided.has(image.sha256)) {
      return failure('invalid', '/images', 'Image bytes are repeated.');
    }
    provided.set(image.sha256, image.bytes);
  }

  const listed = checked.value.manifest;
  const imageEntries: ZipEntry[] = [];
  for (let index = 0; index < listed.images.length; index += 1) {
    const image = listed.images[index];
    if (!image) {
      continue;
    }
    const bytes = provided.get(image.sha256);
    if (!bytes) {
      return failure('invalid', `/images/${index}/sha256`, 'Image bytes are missing.');
    }
    if (bytes.byteLength !== image.bytes) {
      return failure('invalid', `/images/${index}/bytes`, 'Image byte count does not match.');
    }
    const hash = createHash('sha256').update(toBuffer(bytes)).digest('hex');
    if (hash !== image.sha256) {
      return failure('invalid', `/images/${index}/sha256`, 'Image bytes do not match the hash.');
    }
    provided.delete(image.sha256);
    imageEntries.push({ name: imageName(image), data: toBuffer(bytes) });
  }
  if (provided.size > 0) {
    return failure('invalid', '/images', 'Image bytes are not in the manifest.');
  }

  imageEntries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  let documentJson: string;
  let manifestJson: string;
  try {
    documentJson = canonicalDocumentJson(checked.value.document);
    manifestJson = canonicalManifestJson(checked.value.manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The document could not be written.';
    return failure('invalid', '', message);
  }

  return {
    ok: true,
    entries: [
      { name: 'manifest.json', data: Buffer.from(manifestJson, 'utf8') },
      { name: 'document.json', data: Buffer.from(documentJson, 'utf8') },
      ...imageEntries,
    ],
  };
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
}

function writeArchive(entries: readonly ZipEntry[]): Promise<EncodeResult> {
  return new Promise((resolve) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (result: EncodeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    zip.outputStream.on('data', (chunk: unknown) => {
      chunks.push(asBuffer(chunk));
    });
    zip.outputStream.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : 'The archive could not be written.';
      finish(failure('zip-error', '', message));
    });
    zip.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : 'The archive could not be written.';
      finish(failure('zip-error', '', message));
    });
    zip.outputStream.on('end', () => {
      finish({ ok: true, bytes: Buffer.concat(chunks) });
    });
    try {
      for (const entry of entries) {
        zip.addBuffer(entry.data, entry.name, ENTRY_OPTIONS);
      }
      zip.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The archive could not be written.';
      finish(failure('zip-error', '', message));
    }
  });
}

export function encodeObk(
  document: unknown,
  manifest: unknown,
  images: readonly SourceImage[] = [],
): Promise<EncodeResult> {
  const prepared = prepare(document, manifest, images);
  if (!prepared.ok) {
    return Promise.resolve(prepared);
  }
  return writeArchive(prepared.entries);
}
