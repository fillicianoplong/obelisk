import { deflateRawSync, crc32 } from 'node:zlib';

export interface CraftedEntry {
  name: string;
  localName?: string;
  method?: number;
  flags?: number;
  localFlags?: number;
  crc?: number;
  localCrc?: number;
  compressed: Buffer;
  declaredUncompressed: number;
  localDeclaredUncompressed?: number;
  declaredCompressed?: number;
  localDeclaredCompressed?: number;
  localMethod?: number;
  versionMadeBy?: number;
  externalAttributes?: number;
  diskNumberStart?: number;
}

export interface CraftedZip {
  entries: CraftedEntry[];
  /** EOCD "number of this disk". Non-zero is a multi-disk archive. */
  diskNumber?: number;
}

export function storedEntry(name: string, data: Buffer, extra: Partial<CraftedEntry> = {}): CraftedEntry {
  return {
    name,
    method: 0,
    flags: 0,
    crc: crc32(data) >>> 0,
    compressed: data,
    declaredUncompressed: data.length,
    ...extra,
  };
}

/**
 * Deflate `uncompressed` and record `declaredUncompressed` in both headers.
 * The compressed size stays honest so the inflater can reach the real bytes.
 */
export function deflatedEntry(
  name: string,
  uncompressed: Buffer,
  declaredUncompressed: number,
): CraftedEntry {
  const compressed = deflateRawSync(uncompressed, { level: 1 });
  return {
    name,
    method: 8,
    flags: 0,
    crc: crc32(uncompressed) >>> 0,
    compressed,
    declaredUncompressed,
    declaredCompressed: compressed.length,
  };
}

export function craftZip(spec: CraftedZip): Buffer {
  if (spec.entries.length > 0xffff) {
    throw new Error(`craftZip entry count ${spec.entries.length} does not fit in an EOCD.`);
  }
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of spec.entries) {
    const centralName = Buffer.from(entry.name, 'utf8');
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0;
    const crc = entry.crc ?? 0;
    const compressedSize = entry.declaredCompressed ?? entry.compressed.length;
    const local = localHeader({
      name: localName,
      method: entry.localMethod ?? method,
      flags: entry.localFlags ?? flags,
      crc: entry.localCrc ?? crc,
      compressedSize: entry.localDeclaredCompressed ?? compressedSize,
      uncompressedSize: entry.localDeclaredUncompressed ?? entry.declaredUncompressed,
    });
    localParts.push(local, entry.compressed);
    centralParts.push(
      centralHeader({
        name: centralName,
        method,
        flags,
        crc,
        compressedSize,
        uncompressedSize: entry.declaredUncompressed,
        localOffset: offset,
        versionMadeBy: entry.versionMadeBy ?? 20,
        externalAttributes: entry.externalAttributes ?? 0,
        diskNumberStart: entry.diskNumberStart ?? 0,
      }),
    );
    offset += local.length + entry.compressed.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    eocd({
      diskNumber: spec.diskNumber ?? 0,
      entryCount: spec.entries.length,
      centralSize: central.length,
      centralOffset: offset,
    }),
  ]);
}

/** Uncompressed-size fields of each local header, in order. Stops at the central directory. */
export function localUncompressedSizes(zip: Buffer): number[] {
  const sizes: number[] = [];
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    sizes.push(zip.readUInt32LE(offset + 22));
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const compressedSize = zip.readUInt32LE(offset + 18);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return sizes;
}

function localHeader(fields: {
  name: Buffer;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
}): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(fields.flags, 6);
  header.writeUInt16LE(fields.method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(fields.crc >>> 0, 14);
  header.writeUInt32LE(fields.compressedSize, 18);
  header.writeUInt32LE(fields.uncompressedSize, 22);
  header.writeUInt16LE(fields.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, fields.name]);
}

function centralHeader(fields: {
  name: Buffer;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  versionMadeBy: number;
  externalAttributes: number;
  diskNumberStart: number;
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(fields.versionMadeBy, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(fields.flags, 8);
  header.writeUInt16LE(fields.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(fields.crc >>> 0, 16);
  header.writeUInt32LE(fields.compressedSize, 20);
  header.writeUInt32LE(fields.uncompressedSize, 24);
  header.writeUInt16LE(fields.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(fields.diskNumberStart, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(fields.externalAttributes >>> 0, 38);
  header.writeUInt32LE(fields.localOffset, 42);
  return Buffer.concat([header, fields.name]);
}

function eocd(fields: {
  diskNumber: number;
  entryCount: number;
  centralSize: number;
  centralOffset: number;
}): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(fields.diskNumber, 4);
  header.writeUInt16LE(fields.diskNumber, 6);
  header.writeUInt16LE(fields.entryCount, 8);
  header.writeUInt16LE(fields.entryCount, 10);
  header.writeUInt32LE(fields.centralSize, 12);
  header.writeUInt32LE(fields.centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}
