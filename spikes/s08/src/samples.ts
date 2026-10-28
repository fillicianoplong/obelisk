import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT_CAP, ENTRY_CAP, FILE_CAP, FORGED_DECLARED_SIZE, IMAGE_CAP, MIB, TOTAL_CAP } from './limits';
import { documentParts, encodeParts } from './save';
import { craftZip, deflatedEntry, localUncompressedSizes, storedEntry, type CraftedEntry } from './zip-craft';

export interface SampleSpec {
  id: string;
  file: string;
  expectedReason: string;
  expectedZipOpened: boolean;
  expectedEntryCount?: number;
  expectedPayloadsOpened?: number;
  expectedBytesRead?: number;
  expectedCappedEntryBytesRead?: number | null;
  expectedStoppedAtCap?: string | null;
  expectedDeclaredUncompressedSize?: number;
  /** Real uncompressed size of the bomb entry, from the generator, not the header. */
  realUncompressedSize?: number;
}

const MANIFEST = Buffer.from('{"format":"obelisk","formatVersion":1,"images":[]}');
const DOCUMENT = Buffer.from('{"view":"pageless","blocks":[]}');

export async function generateSamples(directory: string): Promise<SampleSpec[]> {
  const specs: SampleSpec[] = [];

  specs.push(await oversized(directory));
  specs.push(await counted(directory, ENTRY_CAP + 1));
  specs.push(await documentBomb(directory));
  specs.push(await imageBomb(directory));
  specs.push(await totalBomb(directory));
  specs.push(await declaredLie(directory));
  specs.push(await one(directory, 'H-03-encrypted', 'encrypted', [storedEntry('manifest.json', Buffer.from('x'), { flags: 1 })]));
  specs.push(
    await one(directory, 'H-03-method', 'unsupported-compression', [
      storedEntry('manifest.json', Buffer.from('x'), { method: 99 }),
    ]),
  );
  specs.push(
    await writeSpec(directory, 'H-03-multidisk', 'multi-disk', craftZip({
      diskNumber: 1,
      entries: [storedEntry('manifest.json', MANIFEST)],
    }), {
      expectedZipOpened: false,
      expectedEntryCount: 0,
      expectedPayloadsOpened: 0,
      expectedBytesRead: 0,
    }),
  );
  specs.push(
    await one(directory, 'H-03-entry-disk', 'multi-disk', [
      storedEntry('manifest.json', MANIFEST, { diskNumberStart: 1 }),
    ]),
  );

  const names: Array<[string, string, string]> = [
    ['H-04-dotdot', '../evil.txt', 'dot-dot'],
    ['H-04-dotdot-nested', 'images/../../out.txt', 'dot-dot'],
    ['H-04-leading-slash', '/etc/passwd', 'leading-slash'],
    ['H-04-backslash', 'images\\evil.png', 'backslash'],
    ['H-04-drive', 'C:/evil.txt', 'drive-letter'],
    ['H-04-drive-backslash', 'C:\\evil.txt', 'drive-letter'],
    ['H-04-drive-bare', 'D:evil.txt', 'drive-letter'],
    ['H-05-unc', '\\\\server\\share\\evil.txt', 'network-path'],
    ['H-05-network-slash', '//server/share/evil.txt', 'network-path'],
    ['H-05-stream', 'manifest.json:Zone.Identifier', 'stream-suffix'],
    ['H-05-stream-data', 'document.json::$DATA', 'stream-suffix'],
    ['H-05-con', 'CON', 'device-name'],
    ['H-05-con-ext', 'CON.txt', 'device-name'],
    ['H-05-con-lower', 'con', 'device-name'],
    ['H-05-con-path', 'images/CON.png', 'device-name'],
    ['H-08-nested-name', 'nested.zip', 'nested-zip'],
    ['H-04-not-allowed', 'extra.txt', 'name-not-allowed'],
  ];
  for (const [id, name, reason] of names) {
    specs.push(await one(directory, id, reason, [storedEntry(name, Buffer.from('x'))]));
  }

  specs.push(
    await one(directory, 'H-06-case', 'case-duplicate', [
      storedEntry('manifest.json', MANIFEST),
      storedEntry('Manifest.json', MANIFEST),
    ]),
  );
  specs.push(
    await one(directory, 'H-06-repeat', 'repeated-name', [
      storedEntry('document.json', DOCUMENT),
      storedEntry('document.json', DOCUMENT),
    ]),
  );
  specs.push(
    await one(directory, 'H-07-headers', 'header-mismatch', [
      storedEntry('manifest.json', Buffer.from('hello'), {
        localName: '../evil.txt',
        localCrc: 1,
      }),
    ]),
  );
  specs.push(
    await one(directory, 'H-08-directory', 'directory', [
      storedEntry('images/', Buffer.alloc(0), {
        crc: 0,
        declaredUncompressed: 0,
        externalAttributes: 0x10,
      }),
    ]),
  );
  specs.push(
    await one(directory, 'H-08-symlink', 'symlink', [
      storedEntry('manifest.json', Buffer.from('evil'), {
        versionMadeBy: (3 << 8) | 20,
        externalAttributes: (0o120777 << 16) >>> 0,
      }),
    ]),
  );
  specs.push(await nestedBytes(directory));
  specs.push(await one(directory, 'H-09-missing-manifest', 'missing-manifest', [storedEntry('document.json', DOCUMENT)]));
  specs.push(await one(directory, 'H-09-missing-document', 'missing-document', [storedEntry('manifest.json', MANIFEST)]));
  specs.push(await validOpen(directory));

  await fs.promises.writeFile(
    path.join(directory, 'samples.json'),
    JSON.stringify(specs, null, 2),
  );
  return specs;
}

async function oversized(directory: string): Promise<SampleSpec> {
  const file = path.join(directory, 'H-01-file-size.obk');
  const handle = await fs.promises.open(file, 'w');
  try {
    await handle.truncate(FILE_CAP + 1);
  } finally {
    await handle.close();
  }
  return spec('H-01-file-size', file, 'file-too-large', {
    expectedZipOpened: false,
    expectedEntryCount: 0,
    expectedPayloadsOpened: 0,
    expectedBytesRead: 0,
  });
}

async function counted(directory: string, count: number): Promise<SampleSpec> {
  const entries: CraftedEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(storedEntry(`n${index}`, Buffer.from('x')));
  }
  return writeSpec(directory, 'H-01-entry-count', 'too-many-entries', craftZip({ entries }), {
    expectedZipOpened: true,
    expectedEntryCount: count,
    expectedPayloadsOpened: 0,
    expectedBytesRead: 0,
  });
}

async function documentBomb(directory: string): Promise<SampleSpec> {
  const real = Buffer.alloc(DOCUMENT_CAP + MIB);
  const zip = craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      deflatedEntry('document.json', real, FORGED_DECLARED_SIZE),
    ],
  });
  assertForged(zip, 1);
  return writeSpec(directory, 'H-02-document-cap', 'document-cap', zip, {
    expectedZipOpened: true,
    expectedEntryCount: 2,
    expectedPayloadsOpened: 2,
    expectedBytesRead: MANIFEST.length + DOCUMENT_CAP,
    expectedCappedEntryBytesRead: DOCUMENT_CAP,
    expectedStoppedAtCap: 'document',
    expectedDeclaredUncompressedSize: FORGED_DECLARED_SIZE,
    realUncompressedSize: real.length,
  });
}

async function imageBomb(directory: string): Promise<SampleSpec> {
  const real = Buffer.alloc(IMAGE_CAP + MIB);
  const zip = craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      storedEntry('document.json', DOCUMENT),
      deflatedEntry(imageName(1), real, FORGED_DECLARED_SIZE),
    ],
  });
  assertForged(zip, 2);
  return writeSpec(directory, 'H-02-image-cap', 'image-cap', zip, {
    expectedZipOpened: true,
    expectedEntryCount: 3,
    expectedPayloadsOpened: 3,
    expectedBytesRead: MANIFEST.length + DOCUMENT.length + IMAGE_CAP,
    expectedCappedEntryBytesRead: IMAGE_CAP,
    expectedStoppedAtCap: 'image',
    expectedDeclaredUncompressedSize: FORGED_DECLARED_SIZE,
    realUncompressedSize: real.length,
  });
}

async function totalBomb(directory: string): Promise<SampleSpec> {
  const imageSize = IMAGE_CAP - 1;
  const overhead = MANIFEST.length + DOCUMENT.length;
  let count = 1;
  while (overhead + count * imageSize <= TOTAL_CAP) {
    count += 1;
  }
  const entries: CraftedEntry[] = [
    storedEntry('manifest.json', MANIFEST),
    storedEntry('document.json', DOCUMENT),
  ];
  for (let index = 0; index < count; index += 1) {
    const data = Buffer.alloc(imageSize);
    data.writeUInt32LE(index + 1, data.length - 4);
    entries.push(deflatedEntry(imageName(index), data, data.length));
  }
  const beforeLast = overhead + (count - 1) * imageSize;
  const room = TOTAL_CAP - beforeLast;
  if (room < 0 || room >= imageSize) {
    throw new Error('The total-cap sample does not cross 250 MB on its last image.');
  }
  return writeSpec(directory, 'H-02-total-cap', 'total-cap', craftZip({ entries }), {
    expectedZipOpened: true,
    expectedEntryCount: entries.length,
    expectedPayloadsOpened: room === 0 ? entries.length - 1 : entries.length,
    expectedBytesRead: TOTAL_CAP,
    expectedCappedEntryBytesRead: room === 0 ? null : room,
    expectedStoppedAtCap: 'total',
    ...(room === 0 ? {} : { expectedDeclaredUncompressedSize: imageSize }),
  });
}

async function declaredLie(directory: string): Promise<SampleSpec> {
  const real = Buffer.alloc(1000);
  const zip = craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      deflatedEntry('document.json', real, 32),
    ],
  });
  const sizes = localUncompressedSizes(zip);
  if (sizes[1] !== 32) {
    throw new Error('The under-cap lie did not forge its uncompressed size.');
  }
  return writeSpec(directory, 'H-02-declared-lie', 'declared-size-mismatch', zip, {
    expectedZipOpened: true,
    expectedEntryCount: 2,
    expectedPayloadsOpened: 2,
    expectedBytesRead: MANIFEST.length + real.length,
    expectedCappedEntryBytesRead: real.length,
    expectedStoppedAtCap: null,
    expectedDeclaredUncompressedSize: 32,
    realUncompressedSize: real.length,
  });
}

async function nestedBytes(directory: string): Promise<SampleSpec> {
  const inner = craftZip({ entries: [storedEntry('evil.txt', Buffer.from('nested'))] });
  const zip = craftZip({
    entries: [
      storedEntry(imageName(9), inner),
      storedEntry('manifest.json', MANIFEST),
      storedEntry('document.json', DOCUMENT),
    ],
  });
  return writeSpec(directory, 'H-08-nested-bytes', 'nested-zip', zip, {
    expectedZipOpened: true,
    expectedEntryCount: 3,
    expectedPayloadsOpened: 1,
  });
}

async function validOpen(directory: string): Promise<SampleSpec> {
  const parts = documentParts([Buffer.from('obelisk-s08-valid-image')]);
  const zip = await encodeParts(parts);
  const bytesRead = parts.reduce((sum, part) => sum + part.data.length, 0);
  return writeSpec(directory, 'valid-open', 'ok', zip, {
    expectedZipOpened: true,
    expectedEntryCount: parts.length,
    expectedPayloadsOpened: parts.length,
    expectedBytesRead: bytesRead,
    expectedStoppedAtCap: null,
  });
}

async function one(
  directory: string,
  id: string,
  reason: string,
  entries: CraftedEntry[],
): Promise<SampleSpec> {
  return writeSpec(directory, id, reason, craftZip({ entries }), {
    expectedZipOpened: true,
    expectedEntryCount: entries.length,
    expectedPayloadsOpened: 0,
    expectedBytesRead: 0,
  });
}

async function writeSpec(
  directory: string,
  id: string,
  reason: string,
  bytes: Buffer,
  fields: Omit<SampleSpec, 'id' | 'file' | 'expectedReason' | 'expectedZipOpened'> & {
    expectedZipOpened: boolean;
  },
): Promise<SampleSpec> {
  const file = path.join(directory, `${id}.obk`);
  await fs.promises.writeFile(file, bytes);
  return spec(id, file, reason, fields);
}

function spec(
  id: string,
  file: string,
  expectedReason: string,
  fields: Omit<SampleSpec, 'id' | 'file' | 'expectedReason'>,
): SampleSpec {
  return { id, file, expectedReason, ...fields };
}

function imageName(index: number): string {
  return `images/${index.toString(16).padStart(64, '0')}.png`;
}

function assertForged(zip: Buffer, index: number): void {
  const sizes = localUncompressedSizes(zip);
  if (sizes[index] !== FORGED_DECLARED_SIZE) {
    throw new Error(`Bomb header ${index} says ${sizes[index] ?? 'missing'}, not ${FORGED_DECLARED_SIZE}.`);
  }
}
