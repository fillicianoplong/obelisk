import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { type Entry, type ZipFile, openPromise } from 'yauzl';
import {
  ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  DOCUMENT_JSON_MAX_BYTES,
  ENTRY_MAX_COUNT,
  FILE_MAX_BYTES,
  IMAGE_MAX_BYTES,
} from '../../../shared/schema/limits.js';
import { readEntryDisks } from './central.js';
import { allowedEntryName, hostileNameReason } from './names.js';
import { isArchiveReason, refused, type ArchiveReason, type ArchiveResult } from './result.js';

// yauzl 3.4.0, opened the way ADR-013 and spike S-08 require.
// decodeStrings stays off so yauzl does not rewrite "\" to "/" before we classify the name.
// validateEntrySizes stays off so a header that claims 64 bytes cannot hide a bomb from the caps.
// strictFileNames has nothing to rewrite while decodeStrings is off; it stays on so a later change cannot silently enable yauzl's own renames.
const OPEN_OPTIONS = {
  lazyEntries: true as const,
  autoClose: false,
  decodeStrings: false,
  validateEntrySizes: false,
  strictFileNames: true,
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface ReadStop {
  bytesRead: number;
  hitCap: boolean;
  zipMagic: boolean;
  crc: number;
  body: Buffer | null;
}

interface ArchivePayload {
  manifest: Buffer;
  document: Buffer;
}

type InspectedArchive = ArchiveResult & { payload?: ArchivePayload };

export async function readArchive(filePath: string): Promise<ArchiveResult> {
  return inspectArchive(filePath, false);
}

// Same checks as readArchive. On success the two JSON entries are kept so the
// decode path can parse the bytes that already passed the caps and the CRC.
export async function readArchivePayload(
  filePath: string,
): Promise<
  | { ok: true; manifest: Buffer; document: Buffer; result: ArchiveResult }
  | { ok: false; result: ArchiveResult }
> {
  const inspected = await inspectArchive(filePath, true);
  if (!inspected.ok) {
    return { ok: false, result: inspected };
  }
  if (!inspected.payload) {
    return {
      ok: false,
      result: refused('zip-error', '', {
        opened: true,
        entriesRead: inspected.entriesRead,
        payloadsRead: inspected.payloadsRead,
        bytesRead: inspected.bytesRead,
      }),
    };
  }
  return {
    ok: true,
    manifest: inspected.payload.manifest,
    document: inspected.payload.document,
    result: inspected,
  };
}

async function inspectArchive(filePath: string, retainJson: boolean): Promise<InspectedArchive> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return refused('unreadable', '');
  }
  if (!fileStat.isFile()) {
    return refused('not-a-file', '');
  }
  // Size is taken from stat. The zip is not opened, so a file over 200 MB is refused before any entry is read.
  if (fileStat.size > FILE_MAX_BYTES) {
    return refused('file-too-large', '');
  }

  let zip: ZipFile | undefined;
  let opened = false;
  try {
    zip = await openPromise(filePath, OPEN_OPTIONS);
    opened = true;
    // entryCount is the end-of-central-directory field. Returning here does not call readEntry.
    if (zip.entryCount > ENTRY_MAX_COUNT) {
      return refused('too-many-entries', '', { opened: true });
    }
    const disks = await readEntryDisks(filePath, fileStat.size, zip.entryCount);
    return await decodeZip(zip, disks, retainJson);
  } catch (error) {
    return refused(classifyZipError(error), '', { opened });
  } finally {
    zip?.close();
  }
}

async function decodeZip(zip: ZipFile, disks: readonly number[], retainJson: boolean): Promise<InspectedArchive> {
  const entries: Entry[] = [];
  for await (const entry of zip.eachEntry()) {
    entries.push(entry);
  }
  if (entries.length !== zip.entryCount || disks.length !== entries.length) {
    return refused('zip-error', '', {
      opened: true,
      entriesRead: entries.length,
    });
  }

  const names = entries.map((entry) => entry.fileNameRaw.toString('latin1'));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    const structural = structuralReason(entry, name, disks[index] ?? 0);
    if (structural) {
      return refused(structural, name, { opened: true, entriesRead: entries.length });
    }
  }

  const duplicate = duplicateReason(names);
  if (duplicate) {
    return refused(duplicate.reason, duplicate.path, { opened: true, entriesRead: entries.length });
  }

  for (let index = 0; index < entries.length; index += 1) {
    const name = names[index] ?? '';
    if (!allowedEntryName(name)) {
      return refused('name-not-allowed', name, { opened: true, entriesRead: entries.length });
    }
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    if (entry && (await headerMismatch(zip, entry))) {
      return refused('header-mismatch', name, { opened: true, entriesRead: entries.length });
    }
  }

  if (!names.includes('manifest.json')) {
    return refused('missing-manifest', 'manifest.json', { opened: true, entriesRead: entries.length });
  }
  if (!names.includes('document.json')) {
    return refused('missing-document', 'document.json', { opened: true, entriesRead: entries.length });
  }

  let bytesRead = 0;
  let payloadsRead = 0;
  let manifest: Buffer | null = null;
  let document: Buffer | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    if (!entry) {
      return refused('zip-error', name, { opened: true, entriesRead: entries.length, payloadsRead, bytesRead });
    }
    const room = ARCHIVE_MAX_UNCOMPRESSED_BYTES - bytesRead;
    if (room <= 0) {
      return refused('total-cap', name, {
        opened: true,
        entriesRead: entries.length,
        payloadsRead,
        bytesRead,
        cappedEntryBytesRead: 0,
      });
    }
    const entryCap = capFor(name);
    const maxBytes = entryCap === null ? room : Math.min(entryCap, room);
    const retain = retainJson && (name === 'manifest.json' || name === 'document.json');
    const stream = await zip.openReadStreamPromise(entry);
    payloadsRead += 1;
    const read = await readCapped(stream, maxBytes, retain);
    bytesRead += read.bytesRead;
    if (retain && read.body && !read.hitCap && !read.zipMagic) {
      if (name === 'manifest.json') {
        manifest = read.body;
      } else {
        document = read.body;
      }
    }
    if (read.zipMagic) {
      return refused('nested-zip', name, {
        opened: true,
        entriesRead: entries.length,
        payloadsRead,
        bytesRead,
      });
    }
    if (read.hitCap) {
      const reason: ArchiveReason =
        entryCap !== null && room >= entryCap ? (name === 'document.json' ? 'document-cap' : 'image-cap') : 'total-cap';
      return refused(reason, name, {
        opened: true,
        entriesRead: entries.length,
        payloadsRead,
        bytesRead,
        cappedEntryBytesRead: read.bytesRead,
      });
    }
    if (read.bytesRead !== entry.uncompressedSize) {
      return refused('declared-size-mismatch', name, {
        opened: true,
        entriesRead: entries.length,
        payloadsRead,
        bytesRead,
      });
    }
    if ((read.crc >>> 0) !== (entry.crc32 >>> 0)) {
      return refused('crc-mismatch', name, {
        opened: true,
        entriesRead: entries.length,
        payloadsRead,
        bytesRead,
      });
    }
  }

  const success: InspectedArchive = {
    ok: true,
    reason: 'ok',
    path: '',
    message: '',
    opened: true,
    entriesRead: entries.length,
    payloadsRead,
    bytesRead,
    cappedEntryBytesRead: null,
  };
  if (!retainJson) {
    return success;
  }
  if (!manifest || !document) {
    return refused('zip-error', '', {
      opened: true,
      entriesRead: entries.length,
      payloadsRead,
      bytesRead,
    });
  }
  success.payload = { manifest, document };
  return success;
}

function capFor(name: string): number | null {
  if (name === 'document.json') {
    return DOCUMENT_JSON_MAX_BYTES;
  }
  if (name.startsWith('images/')) {
    return IMAGE_MAX_BYTES;
  }
  return null;
}

function structuralReason(entry: Entry, name: string, disk: number): ArchiveReason | null {
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x1) !== 0) {
    return 'encrypted';
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return 'unsupported-compression';
  }
  if (disk !== 0) {
    return 'multi-disk';
  }
  if (isDirectory(entry, name)) {
    return 'directory';
  }
  if (isSymlink(entry)) {
    return 'symlink';
  }
  return namedReason(hostileNameReason(name));
}

function namedReason(reason: string | null): ArchiveReason | null {
  if (reason === null) {
    return null;
  }
  if (!isArchiveReason(reason)) {
    throw new Error(`Unknown archive reason ${reason}.`);
  }
  return reason;
}

function duplicateReason(names: readonly string[]): { reason: ArchiveReason; path: string } | null {
  const seen = new Set<string>();
  const folded = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      return { reason: 'repeated-name', path: name };
    }
    const fold = name.toLowerCase();
    if (folded.has(fold)) {
      return { reason: 'case-duplicate', path: name };
    }
    seen.add(name);
    folded.add(fold);
  }
  return null;
}

function isDirectory(entry: Entry, name: string): boolean {
  if (name.endsWith('/')) {
    return true;
  }
  if ((entry.externalFileAttributes & 0x10) !== 0) {
    return true;
  }
  return isUnix(entry) && (unixMode(entry) & 0o170000) === 0o040000;
}

function isSymlink(entry: Entry): boolean {
  return isUnix(entry) && (unixMode(entry) & 0o170000) === 0o120000;
}

function isUnix(entry: Entry): boolean {
  return (entry.versionMadeBy >> 8) === 3;
}

function unixMode(entry: Entry): number {
  return entry.externalFileAttributes >>> 16;
}

async function headerMismatch(zip: ZipFile, entry: Entry): Promise<boolean> {
  const local = await zip.readLocalFileHeaderPromise(entry);
  if (!local.fileName.equals(entry.fileNameRaw)) {
    return true;
  }
  if (local.compressionMethod !== entry.compressionMethod) {
    return true;
  }
  if ((local.crc32 >>> 0) !== (entry.crc32 >>> 0)) {
    return true;
  }
  if (local.compressedSize !== entry.compressedSize) {
    return true;
  }
  if (local.uncompressedSize !== entry.uncompressedSize) {
    return true;
  }
  return local.generalPurposeBitFlag !== entry.generalPurposeBitFlag;
}

function readCapped(stream: Readable, maxBytes: number, retain: boolean): Promise<ReadStop> {
  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    let crc = 0;
    let crcStarted = false;
    const prefix: Buffer[] = [];
    let prefixLength = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    let stopping = false;

    function finish(hitCap: boolean, zipMagic: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      stopping = true;
      resolve({
        bytesRead,
        hitCap,
        zipMagic,
        crc: crc >>> 0,
        body: retain ? Buffer.concat(chunks) : null,
      });
    }

    stream.on('error', (error: Error) => {
      if (settled || stopping) {
        return;
      }
      settled = true;
      reject(error);
    });
    stream.on('end', () => {
      finish(false, false);
    });
    stream.on('data', (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const room = maxBytes - bytesRead;
      if (room <= 0 || buf.length > room) {
        const take = Math.max(0, room);
        if (take > 0) {
          accept(buf.subarray(0, take));
        }
        stopping = true;
        stream.destroy();
        finish(true, false);
        return;
      }
      accept(buf);
      if (prefixLength >= ZIP_MAGIC.length && Buffer.concat(prefix).subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
        stopping = true;
        stream.destroy();
        finish(false, true);
      }
    });

    function accept(slice: Buffer): void {
      bytesRead += slice.length;
      crc = crcStarted ? crc32(slice, crc) : crc32(slice);
      crcStarted = true;
      if (retain) {
        chunks.push(Buffer.from(slice));
      }
      if (prefixLength < ZIP_MAGIC.length) {
        const piece = slice.subarray(0, ZIP_MAGIC.length - prefixLength);
        prefix.push(piece);
        prefixLength += piece.length;
      }
    }
  });
}

function classifyZipError(error: unknown): ArchiveReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('multi-disk')) {
    return 'multi-disk';
  }
  if (message.includes('strong encryption') || message.includes('encrypted')) {
    return 'encrypted';
  }
  if (
    message.includes('End of central directory') ||
    message.includes('Invalid comment length') ||
    message.includes('not a zip')
  ) {
    return 'not-a-zip';
  }
  return 'zip-error';
}
