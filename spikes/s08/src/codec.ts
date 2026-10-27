import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { type Entry, type ZipFile, fromBufferPromise, openPromise } from 'yauzl';
import { DOCUMENT_CAP, ENTRY_CAP, FILE_CAP, IMAGE_CAP, TOTAL_CAP } from './limits';
import { allowedEntryName, hostileNameReason } from './names';

/**
 * yauzl rewrites "\" to "/" unless strictFileNames is set, and then its own
 * name check rejects the entry before we can name the reason. decodeStrings
 * is off so fileNameRaw is the bytes from the central directory.
 *
 * validateEntrySizes is off because that check stops at the uncompressed size
 * in the header. A bomb that claims 64 bytes would never reach the real cap.
 * The caps below count inflated bytes and destroy the stream at the cap.
 */
const OPEN_OPTIONS = {
  lazyEntries: true as const,
  autoClose: false,
  decodeStrings: false,
  validateEntrySizes: false,
  strictFileNames: true,
};

export type CapName = 'document' | 'image' | 'total';

export interface OpenResult {
  ok: boolean;
  reason: string;
  detail: string;
  zipOpened: boolean;
  entryCount: number;
  payloadsOpened: number;
  bytesRead: number;
  cappedEntryName: string | null;
  cappedEntryBytesRead: number | null;
  declaredUncompressedSize: number | null;
  stoppedAtCap: CapName | null;
}

interface CentralFacts {
  eocdDisk: number;
  entryDisks: number[];
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function openObk(filePath: string): Promise<OpenResult> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    return refusal('unreadable', messageOf(error));
  }
  if (!stat.isFile()) {
    return refusal('not-a-file', 'not a regular file');
  }
  if (stat.size > FILE_CAP) {
    return refusal('file-too-large', `file is ${stat.size} bytes`, {
      entryCount: 0,
    });
  }

  let zip: ZipFile | undefined;
  let opened = false;
  try {
    zip = await openPromise(filePath, OPEN_OPTIONS);
    opened = true;
    if (zip.entryCount > ENTRY_CAP) {
      return refusal('too-many-entries', `entry count ${zip.entryCount}`, {
        zipOpened: true,
        entryCount: zip.entryCount,
      });
    }
    const facts = await centralFactsFromFile(filePath, stat.size);
    return await decodeZip(zip, facts);
  } catch (error) {
    return refusal(classifyZipError(messageOf(error)), messageOf(error), {
      zipOpened: opened,
    });
  } finally {
    zip?.close();
  }
}

export async function openObkBuffer(buffer: Buffer): Promise<OpenResult> {
  if (buffer.length > FILE_CAP) {
    return refusal('file-too-large', `file is ${buffer.length} bytes`);
  }
  let zip: ZipFile | undefined;
  let opened = false;
  try {
    zip = await fromBufferPromise(buffer, OPEN_OPTIONS);
    opened = true;
    if (zip.entryCount > ENTRY_CAP) {
      return refusal('too-many-entries', `entry count ${zip.entryCount}`, {
        zipOpened: true,
        entryCount: zip.entryCount,
      });
    }
    return await decodeZip(zip, centralFactsFromBuffer(buffer));
  } catch (error) {
    return refusal(classifyZipError(messageOf(error)), messageOf(error), {
      zipOpened: opened,
    });
  } finally {
    zip?.close();
  }
}

async function decodeZip(zip: ZipFile, facts: CentralFacts): Promise<OpenResult> {
  if (facts.eocdDisk !== 0) {
    return refusal('multi-disk', `end of central directory disk ${facts.eocdDisk}`, {
      zipOpened: true,
      entryCount: zip.entryCount,
    });
  }

  const entries: Entry[] = [];
  for await (const entry of zip.eachEntry()) {
    entries.push(entry);
  }
  if (entries.length !== zip.entryCount) {
    return refusal('zip-error', `listed ${entries.length} entries, directory says ${zip.entryCount}`, {
      zipOpened: true,
      entryCount: zip.entryCount,
    });
  }
  if (facts.entryDisks.length !== entries.length) {
    return refusal(
      'zip-error',
      `disk list has ${facts.entryDisks.length} entries, directory says ${entries.length}`,
      { zipOpened: true, entryCount: entries.length },
    );
  }

  const names = entries.map((entry) => entry.fileNameRaw.toString('latin1'));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    const structural = structuralReason(entry, name, facts.entryDisks[index] ?? 0);
    if (structural) {
      return refusal(structural.reason, structural.detail, {
        zipOpened: true,
        entryCount: entries.length,
      });
    }
  }

  const duplicate = duplicateReason(names);
  if (duplicate) {
    return refusal(duplicate.reason, duplicate.detail, {
      zipOpened: true,
      entryCount: entries.length,
    });
  }

  for (let index = 0; index < entries.length; index += 1) {
    const name = names[index] ?? '';
    if (!allowedEntryName(name)) {
      return refusal('name-not-allowed', name, {
        zipOpened: true,
        entryCount: entries.length,
      });
    }
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    const mismatch = await headerMismatch(zip, entry, name);
    if (mismatch) {
      return refusal('header-mismatch', mismatch, {
        zipOpened: true,
        entryCount: entries.length,
      });
    }
  }

  if (!names.includes('manifest.json')) {
    return refusal('missing-manifest', 'manifest.json is absent', {
      zipOpened: true,
      entryCount: entries.length,
    });
  }
  if (!names.includes('document.json')) {
    return refusal('missing-document', 'document.json is absent', {
      zipOpened: true,
      entryCount: entries.length,
    });
  }

  let bytesRead = 0;
  let payloadsOpened = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index] ?? '';
    const room = TOTAL_CAP - bytesRead;
    if (room <= 0) {
      return refusal('total-cap', `stopped at ${bytesRead} bytes`, {
        zipOpened: true,
        entryCount: entries.length,
        payloadsOpened,
        bytesRead,
        stoppedAtCap: 'total',
      });
    }
    const entryCap = capFor(name);
    const maxBytes = entryCap === null ? room : Math.min(entryCap, room);
    const stream = await zip.openReadStreamPromise(entry);
    payloadsOpened += 1;
    const read = await readCapped(stream, maxBytes);
    bytesRead += read.bytesRead;
    if (read.zipMagic) {
      return refusal('nested-zip', `${name} starts with a zip signature`, {
        zipOpened: true,
        entryCount: entries.length,
        payloadsOpened,
        bytesRead,
        cappedEntryName: name,
        cappedEntryBytesRead: read.bytesRead,
        declaredUncompressedSize: entry.uncompressedSize,
      });
    }
    if (read.hitCap) {
      const stoppedAtCap: CapName =
        entryCap !== null && room >= entryCap ? (name === 'document.json' ? 'document' : 'image') : 'total';
      return refusal(`${stoppedAtCap}-cap`, `${name} stopped at ${read.bytesRead} of ${maxBytes}`, {
        zipOpened: true,
        entryCount: entries.length,
        payloadsOpened,
        bytesRead,
        cappedEntryName: name,
        cappedEntryBytesRead: read.bytesRead,
        declaredUncompressedSize: entry.uncompressedSize,
        stoppedAtCap,
      });
    }
    if (read.bytesRead !== entry.uncompressedSize) {
      return refusal(
        'declared-size-mismatch',
        `${name} header says ${entry.uncompressedSize}, read ${read.bytesRead}`,
        {
          zipOpened: true,
          entryCount: entries.length,
          payloadsOpened,
          bytesRead,
          cappedEntryName: name,
          cappedEntryBytesRead: read.bytesRead,
          declaredUncompressedSize: entry.uncompressedSize,
        },
      );
    }
    if ((read.crc >>> 0) !== (entry.crc32 >>> 0)) {
      return refusal('crc-mismatch', `${name} crc does not match the bytes`, {
        zipOpened: true,
        entryCount: entries.length,
        payloadsOpened,
        bytesRead,
        declaredUncompressedSize: entry.uncompressedSize,
      });
    }
  }

  return {
    ok: true,
    reason: 'ok',
    detail: `${entries.length} entries, ${bytesRead} bytes`,
    zipOpened: true,
    entryCount: entries.length,
    payloadsOpened,
    bytesRead,
    cappedEntryName: null,
    cappedEntryBytesRead: null,
    declaredUncompressedSize: null,
    stoppedAtCap: null,
  };
}

function capFor(name: string): number | null {
  if (name === 'document.json') {
    return DOCUMENT_CAP;
  }
  if (name.startsWith('images/')) {
    return IMAGE_CAP;
  }
  return null;
}

function structuralReason(entry: Entry, name: string, disk: number): { reason: string; detail: string } | null {
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x1) !== 0) {
    return { reason: 'encrypted', detail: name };
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return { reason: 'unsupported-compression', detail: `${name} method ${entry.compressionMethod}` };
  }
  if (disk !== 0) {
    return { reason: 'multi-disk', detail: `${name} starts on disk ${disk}` };
  }
  if (isDirectory(entry, name)) {
    return { reason: 'directory', detail: name };
  }
  if (isSymlink(entry)) {
    return { reason: 'symlink', detail: name };
  }
  const hostile = hostileNameReason(name);
  if (hostile) {
    return { reason: hostile, detail: name };
  }
  return null;
}

function duplicateReason(names: readonly string[]): { reason: string; detail: string } | null {
  const seen = new Set<string>();
  const folded = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      return { reason: 'repeated-name', detail: name };
    }
    const fold = name.toLowerCase();
    if (folded.has(fold)) {
      return { reason: 'case-duplicate', detail: name };
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

async function headerMismatch(zip: ZipFile, entry: Entry, name: string): Promise<string | null> {
  const local = await zip.readLocalFileHeaderPromise(entry);
  const problems: string[] = [];
  if (!local.fileName.equals(entry.fileNameRaw)) {
    problems.push('name');
  }
  if (local.compressionMethod !== entry.compressionMethod) {
    problems.push('method');
  }
  if ((local.crc32 >>> 0) !== (entry.crc32 >>> 0)) {
    problems.push('crc');
  }
  if (local.compressedSize !== entry.compressedSize) {
    problems.push('compressed-size');
  }
  if (local.uncompressedSize !== entry.uncompressedSize) {
    problems.push('uncompressed-size');
  }
  if (local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) {
    problems.push('flags');
  }
  if (problems.length === 0) {
    return null;
  }
  return `${name}: ${problems.join(', ')}`;
}

interface ReadStop {
  bytesRead: number;
  hitCap: boolean;
  zipMagic: boolean;
  crc: number;
}

function readCapped(stream: Readable, maxBytes: number): Promise<ReadStop> {
  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    let crc = 0;
    let crcStarted = false;
    const prefix: Buffer[] = [];
    let prefixLength = 0;
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
      if (prefixLength >= ZIP_MAGIC.length && Buffer.concat(prefix).subarray(0, 4).equals(ZIP_MAGIC)) {
        stopping = true;
        stream.destroy();
        finish(false, true);
      }
    });

    function accept(slice: Buffer): void {
      bytesRead += slice.length;
      crc = crcStarted ? crc32(slice, crc) : crc32(slice);
      crcStarted = true;
      if (prefixLength < ZIP_MAGIC.length) {
        const piece = slice.subarray(0, ZIP_MAGIC.length - prefixLength);
        prefix.push(piece);
        prefixLength += piece.length;
      }
    }
  });
}

function refusal(reason: string, detail: string, extra: Partial<OpenResult> = {}): OpenResult {
  return {
    ok: false,
    reason,
    detail: detail.slice(0, 500),
    zipOpened: false,
    entryCount: 0,
    payloadsOpened: 0,
    bytesRead: 0,
    cappedEntryName: null,
    cappedEntryBytesRead: null,
    declaredUncompressedSize: null,
    stoppedAtCap: null,
    ...extra,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function classifyZipError(message: string): string {
  if (message.includes('multi-disk')) {
    return 'multi-disk';
  }
  if (message.includes('strong encryption')) {
    return 'encrypted';
  }
  if (
    message.includes('End of central directory') ||
    message.includes('invalid comment length') ||
    message.includes('not a zip')
  ) {
    return 'not-a-zip';
  }
  return 'zip-error';
}

async function centralFactsFromFile(filePath: string, fileSize: number): Promise<CentralFacts> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await readExact(handle, tail, fileSize - tailLength);
    const eocd = findEocd(tail);
    if (eocd < 0) {
      throw new Error('End of central directory record signature not found');
    }
    const disk = tail.readUInt16LE(eocd + 4);
    const entryCount = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0) {
      return { eocdDisk: disk, entryDisks: [] };
    }
    const central = Buffer.alloc(centralSize);
    await readExact(handle, central, centralOffset);
    return { eocdDisk: 0, entryDisks: entryDisks(central, entryCount) };
  } finally {
    await handle.close();
  }
}

function centralFactsFromBuffer(buffer: Buffer): CentralFacts {
  const eocd = findEocd(buffer);
  if (eocd < 0) {
    throw new Error('End of central directory record signature not found');
  }
  const disk = buffer.readUInt16LE(eocd + 4);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0) {
    return { eocdDisk: disk, entryDisks: [] };
  }
  return {
    eocdDisk: 0,
    entryDisks: entryDisks(buffer.subarray(centralOffset, centralOffset + centralSize), entryCount),
  };
}

function entryDisks(central: Buffer, entryCount: number): number[] {
  const disks: number[] = [];
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('invalid central directory file header signature');
    }
    disks.push(central.readUInt16LE(cursor + 34));
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return disks;
}

function findEocd(buffer: Buffer): number {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) !== 0x06054b50) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(index + 20);
    if (index + 22 + commentLength === buffer.length) {
      return index;
    }
  }
  return -1;
}

async function readExact(handle: fs.promises.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error('unexpected EOF');
    }
    offset += bytesRead;
  }
}
