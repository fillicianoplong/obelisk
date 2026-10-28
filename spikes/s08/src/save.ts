import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { FIXED_MTIME } from './limits';

const ENTRY_OPTIONS = {
  mtime: FIXED_MTIME,
  compressionLevel: 6,
  forceDosTimestamp: true,
  mode: 0o100644,
};

export interface SavedPart {
  name: string;
  data: Buffer;
}

/** Fixed key order and a fixed yazl timestamp, so one document encodes to one byte string. */
export function documentParts(images: readonly Buffer[]): SavedPart[] {
  const named = images.map((data) => {
    const sha256 = createHash('sha256').update(data).digest('hex');
    return { name: `images/${sha256}.png`, data };
  });
  named.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const manifest = Buffer.from(
    JSON.stringify({
      format: 'obelisk',
      formatVersion: 1,
      writer: 's08',
      images: named.map((image) => ({
        sha256: image.name.slice('images/'.length, -'.png'.length),
        type: 'png',
        bytes: image.data.length,
      })),
    }),
  );
  const document = Buffer.from(
    JSON.stringify({
      view: 'pageless',
      blocks: named.map((image) => ({
        type: 'image',
        sha256: image.name.slice('images/'.length, -'.png'.length),
      })),
    }),
  );
  return [
    { name: 'manifest.json', data: manifest },
    { name: 'document.json', data: document },
    ...named,
  ];
}

export function encodeObk(images: readonly Buffer[]): Promise<Buffer> {
  return encodeParts(documentParts(images));
}

export function encodeParts(parts: readonly SavedPart[]): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    zip.outputStream.on('error', reject);
    zip.on('error', reject);
    zip.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
  for (const part of parts) {
    zip.addBuffer(part.data, part.name, ENTRY_OPTIONS);
  }
  zip.end();
  return done;
}
