import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  blockId,
  emptyManifest,
  imageDocument,
  imageManifest,
  imageName,
  linkRun,
  minimalDocument,
  paragraph,
  textRun,
} from './documents.mjs';
import {
  SVG_MARKUP,
  animatedWebp,
  gifFrames,
  jpegHeader,
  pngHeader,
  stillWebp,
} from './images.mjs';
import {
  ANIMATION_FRAME_MAX,
  ANIMATION_PIXEL_MAX,
  ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  BLOCK_MAX,
  DOCUMENT_JSON_MAX_BYTES,
  ENTRY_MAX_COUNT,
  FILE_MAX_BYTES,
  FIXTURE_DISK_MAX_BYTES,
  FORGED_DECLARED_SIZE,
  IMAGE_DIMENSION_MAX,
  IMAGE_MAX_BYTES,
  MIB,
  TABLE_COLUMN_MAX,
  TABLE_ROW_MAX,
  TEXT_MAX_CHARS,
} from './limits.mjs';
import { craftZip, deflatedEntry, eocdEntryCount, localUncompressedSizes, storedEntry } from './zip.mjs';

export const HOSTILE_MANIFEST = Buffer.from('{"format":"obelisk","formatVersion":1,"images":[]}');
export const HOSTILE_DOCUMENT = Buffer.from('{"view":"pageless","blocks":[]}');
const MANIFEST = HOSTILE_MANIFEST;
const DOCUMENT = HOSTILE_DOCUMENT;

const UPDATE_MESSAGE = 'Made by a newer Obelisk; update it from the Microsoft Store';

export const ENABLERS = {
  19: 'Codec: archive checks',
  20: 'Codec: JSON and schema checks',
  21: 'Codec: image entry checks',
  22: 'Codec: encode and versions',
  24: 'Open file and handles',
  41: 'Paste sanitizer',
  44: 'Text-as-markup test',
  54: 'Equation blocks',
  58: 'Word export',
  59: 'Markdown export',
  60: 'Settings tab and store',
  61: 'Restore tabs',
  68: 'Open from File Explorer',
  69: 'Recovery copies',
  77: 'Saved signatures',
  80: 'Diagram block',
};

export function pendingText(issues) {
  const labels = issues.map((issue) => {
    const title = ENABLERS[issue];
    if (!title) {
      throw new Error(`Issue #${issue} has no title in the hostile harness.`);
    }
    return `#${issue} ${title}`;
  });
  if (labels.length === 1) {
    return `pending ${labels[0]}`;
  }
  if (labels.length === 2) {
    return `pending ${labels[0]} and ${labels[1]}`;
  }
  return `pending ${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

export function hostileRows(markdown) {
  const start = markdown.indexOf('### 6.10 Hostile sample set');
  const end = markdown.indexOf('\n## 7. Architecture decisions');
  if (start < 0 || end < start) {
    throw new Error('Architecture section 6.10 was not found.');
  }
  const rows = [];
  for (const line of markdown.slice(start, end).split('\n')) {
    if (!line.startsWith('| H-')) {
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3 || !/^H-\d{2}$/.test(cells[0])) {
      throw new Error(`Bad hostile row: ${line}`);
    }
    rows.push({ id: cells[0], sample: cells[1], expected: cells[2] });
  }
  if (rows.length !== 32) {
    throw new Error(`Expected H-01 to H-32, found ${rows.length} rows.`);
  }
  return rows;
}

function spec(fields) {
  return {
    pending: [],
    check: null,
    outcome: 'refused',
    expectReason: null,
    expectPath: null,
    expectText: null,
    shared: false,
    ...fields,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function single(name, data, extra) {
  return craftZip({ entries: [storedEntry(name, data, extra)] });
}

function archive(key, title, bytes, issue = 19, expected = null) {
  const active = issue === 19;
  if (active && (!expected || typeof expected.reason !== 'string' || typeof expected.path !== 'string')) {
    throw new Error(`${key} needs an archive reason and path.`);
  }
  return spec({
    id: key.slice(0, 4),
    key,
    fileName: `${key}.obk`,
    title,
    pending: active ? [] : [issue],
    check: active ? 'archive' : null,
    expectReason: expected ? expected.reason : null,
    expectPath: expected ? expected.path : null,
    bytes,
  });
}

function totalImageCount() {
  const imageSize = IMAGE_MAX_BYTES - 1;
  const overhead = MANIFEST.length + DOCUMENT.length;
  let count = 1;
  while (overhead + count * imageSize <= ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
    count += 1;
  }
  return count;
}

function requireHeader(zip, index, declared, label) {
  const sizes = localUncompressedSizes(zip);
  if (sizes[index] !== declared) {
    throw new Error(`${label} header ${index} says ${sizes[index] ?? 'missing'}, not ${declared}.`);
  }
  return zip;
}

function documentBomb() {
  const real = Buffer.alloc(DOCUMENT_JSON_MAX_BYTES + MIB);
  return requireHeader(craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      deflatedEntry('document.json', real, FORGED_DECLARED_SIZE),
    ],
  }), 1, FORGED_DECLARED_SIZE, 'H-02 document bomb');
}

function imageBomb() {
  const real = Buffer.alloc(IMAGE_MAX_BYTES + MIB);
  return requireHeader(craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      storedEntry('document.json', DOCUMENT),
      deflatedEntry(imageName(1), real, FORGED_DECLARED_SIZE),
    ],
  }), 2, FORGED_DECLARED_SIZE, 'H-02 image bomb');
}

function totalBomb() {
  const imageSize = IMAGE_MAX_BYTES - 1;
  const overhead = MANIFEST.length + DOCUMENT.length;
  const count = totalImageCount();
  const entries = [
    storedEntry('manifest.json', MANIFEST),
    storedEntry('document.json', DOCUMENT),
  ];
  for (let index = 0; index < count; index += 1) {
    const data = Buffer.alloc(imageSize);
    data.writeUInt32LE(index + 1, data.length - 4);
    entries.push(deflatedEntry(imageName(index), data, data.length));
  }
  const beforeLast = overhead + (count - 1) * imageSize;
  const room = ARCHIVE_MAX_UNCOMPRESSED_BYTES - beforeLast;
  if (room < 0 || room >= imageSize) {
    throw new Error('H-02 total bomb does not cross 250 MB on its last image.');
  }
  return craftZip({ entries });
}

function declaredLie() {
  const real = Buffer.alloc(1000);
  return requireHeader(craftZip({
    entries: [
      storedEntry('manifest.json', MANIFEST),
      deflatedEntry('document.json', real, 32),
    ],
  }), 1, 32, 'H-02 declared-size lie');
}

function entryCountZip() {
  const entries = [];
  for (let index = 0; index < ENTRY_MAX_COUNT + 1; index += 1) {
    entries.push(storedEntry(`n${index}`, Buffer.from('x')));
  }
  const zip = craftZip({ entries });
  if (eocdEntryCount(zip) !== ENTRY_MAX_COUNT + 1) {
    throw new Error('H-01 did not write 2,001 entries into the central directory.');
  }
  return zip;
}

function imageArchive(writer, bytes, extension, type, width, height, frames) {
  const hash = sha256(bytes);
  const manifest = imageManifest(writer, {
    sha256: hash,
    type,
    bytes: bytes.length,
    width,
    height,
    frames,
  });
  return craftZip({
    entries: [
      storedEntry('manifest.json', Buffer.from(JSON.stringify(manifest))),
      storedEntry('document.json', Buffer.from(JSON.stringify(imageDocument(hash)))),
      storedEntry(`images/${hash}.${extension}`, bytes),
    ],
  });
}

function imageSpec(writer, key, title, imageBytes, extension, type, width, height, frames, reason) {
  const hash = sha256(imageBytes);
  return spec({
    id: key.slice(0, 4),
    key,
    fileName: `${key}.obk`,
    title,
    check: 'decode',
    expectReason: reason,
    expectPath: `images/${hash}.${extension}`,
    bytes: imageArchive(writer, imageBytes, extension, type, width, height, frames),
  });
}

function buildSpecs(writer) {
  const specs = [
    spec({
      id: 'H-01',
      key: 'H-01-file-size',
      fileName: 'H-01-file-size.obk',
      title: 'File over 200 MB',
      check: 'archive',
      expectReason: 'file-too-large',
      expectPath: '',
      sparseBytes: FILE_MAX_BYTES + 1,
    }),
    archive('H-01-entry-count', 'Archive with 2,001 entries', entryCountZip(), 19, {
      reason: 'too-many-entries',
      path: '',
    }),
    archive('H-02-document-cap', 'document.json inflates past 25 MB from a 64-byte header', documentBomb(), 19, {
      reason: 'document-cap',
      path: 'document.json',
    }),
    archive('H-02-image-cap', 'An image inflates past 20 MB from a 64-byte header', imageBomb(), 19, {
      reason: 'image-cap',
      path: imageName(1),
    }),
    archive('H-02-total-cap', 'Entries inflate past 250 MB together', totalBomb(), 19, {
      reason: 'total-cap',
      path: imageName(totalImageCount() - 1),
    }),
    archive('H-02-declared-lie', 'Declared size 32, real size 1,000, under the caps', declaredLie(), 19, {
      reason: 'declared-size-mismatch',
      path: 'document.json',
    }),
    archive('H-03-encrypted', 'Encrypted entry', single('manifest.json', Buffer.from('x'), { flags: 1 }), 19, {
      reason: 'encrypted',
      path: 'manifest.json',
    }),
    archive('H-03-method', 'Unknown compression method', single('manifest.json', Buffer.from('x'), { method: 99 }), 19, {
      reason: 'unsupported-compression',
      path: 'manifest.json',
    }),
    archive('H-03-multidisk', 'Multi-disk archive', craftZip({
      diskNumber: 1,
      entries: [storedEntry('manifest.json', MANIFEST)],
    }), 19, {
      reason: 'multi-disk',
      path: '',
    }),
    archive('H-03-entry-disk', 'Entry stored on another disk', single('manifest.json', MANIFEST, { diskNumberStart: 1 }), 19, {
      reason: 'multi-disk',
      path: 'manifest.json',
    }),
  ];

  const names = [
    ['H-04-dotdot', '../evil.txt', 'Entry name ../', 'dot-dot'],
    ['H-04-dotdot-nested', 'images/../../out.txt', 'Entry name with nested ../', 'dot-dot'],
    ['H-04-leading-slash', '/etc/passwd', 'Entry name with a leading slash', 'leading-slash'],
    ['H-04-backslash', 'images\\evil.png', 'Entry name with a backslash', 'backslash'],
    ['H-04-drive', 'C:/evil.txt', 'Entry name with a drive letter', 'drive-letter'],
    ['H-04-drive-backslash', 'C:\\evil.txt', 'Entry name C:\\evil.txt', 'drive-letter'],
    ['H-04-drive-bare', 'D:evil.txt', 'Entry name D:evil.txt', 'drive-letter'],
    ['H-04-extra', 'extra.txt', 'Entry name outside the allowlist', 'name-not-allowed'],
    ['H-05-unc', '\\\\server\\share\\evil.txt', 'Network path', 'network-path'],
    ['H-05-network-slash', '//server/share/evil.txt', 'Network path with slashes', 'network-path'],
    ['H-05-stream', 'manifest.json:Zone.Identifier', 'Stream suffix', 'stream-suffix'],
    ['H-05-stream-data', 'document.json::$DATA', '::$DATA stream suffix', 'stream-suffix'],
    ['H-05-con', 'CON', 'Device name CON', 'device-name'],
    ['H-05-con-ext', 'CON.txt', 'Device name CON.txt', 'device-name'],
    ['H-05-con-lower', 'con', 'Device name con', 'device-name'],
    ['H-05-con-path', 'images/CON.png', 'Device name inside images/', 'device-name'],
  ];
  for (const [key, name, title, reason] of names) {
    specs.push(archive(key, title, single(name, Buffer.from('x')), 19, { reason, path: name }));
  }

  specs.push(
    archive('H-06-case', 'manifest.json and Manifest.json', craftZip({
      entries: [
        storedEntry('manifest.json', MANIFEST),
        storedEntry('Manifest.json', MANIFEST),
      ],
    }), 19, { reason: 'case-duplicate', path: 'Manifest.json' }),
    archive('H-06-repeat', 'document.json twice', craftZip({
      entries: [
        storedEntry('document.json', DOCUMENT),
        storedEntry('document.json', DOCUMENT),
      ],
    }), 19, { reason: 'repeated-name', path: 'document.json' }),
    archive('H-07-headers', 'Local name and CRC differ from the central header', single(
      'manifest.json',
      Buffer.from('hello'),
      { localName: '../evil.txt', localCrc: 1 },
    ), 19, { reason: 'header-mismatch', path: 'manifest.json' }),
    archive('H-08-directory', 'Folder entry', single('images/', Buffer.alloc(0), {
      crc: 0,
      declaredUncompressed: 0,
      externalAttributes: 0x10,
    }), 19, { reason: 'directory', path: 'images/' }),
    archive('H-08-symlink', 'Link entry', single('manifest.json', Buffer.from('evil'), {
      versionMadeBy: (3 << 8) | 20,
      externalAttributes: (0o120777 << 16) >>> 0,
    }), 19, { reason: 'symlink', path: 'manifest.json' }),
    archive('H-08-nested-name', 'Entry named nested.zip', single('nested.zip', Buffer.from('x')), 19, {
      reason: 'nested-zip',
      path: 'nested.zip',
    }),
    archive('H-08-nested-bytes', 'Image bytes that are a zip', craftZip({
      entries: [
        storedEntry(imageName(9), craftZip({ entries: [storedEntry('evil.txt', Buffer.from('nested'))] })),
        storedEntry('manifest.json', MANIFEST),
        storedEntry('document.json', DOCUMENT),
      ],
    }), 19, { reason: 'nested-zip', path: imageName(9) }),
    archive('H-09-missing-manifest', 'Missing manifest.json', single('document.json', DOCUMENT), 19, {
      reason: 'missing-manifest',
      path: 'manifest.json',
    }),
    archive('H-09-missing-document', 'Missing document.json', single('manifest.json', MANIFEST), 19, {
      reason: 'missing-document',
      path: 'document.json',
    }),
  );

  function documentArchive(documentBody, manifestValue = emptyManifest(writer)) {
    const manifest = Buffer.from(JSON.stringify(manifestValue));
    const document = Buffer.isBuffer(documentBody)
      ? documentBody
      : Buffer.from(typeof documentBody === 'string' ? documentBody : JSON.stringify(documentBody));
    return craftZip({
      entries: [
        storedEntry('manifest.json', manifest),
        storedEntry('document.json', document),
      ],
    });
  }

  const unknown = minimalDocument();
  unknown.author = 'x';
  const wrongType = minimalDocument();
  wrongType.view = 1;
  const outOfRange = minimalDocument();
  outOfRange.view = 'Pages';
  specs.push(
    spec({
      id: 'H-10',
      key: 'H-10-unknown',
      fileName: 'H-10-unknown.obk',
      title: 'Unknown field',
      check: 'decode',
      expectReason: 'unknown-field',
      expectPath: '/author',
      bytes: documentArchive(unknown),
    }),
    spec({
      id: 'H-10',
      key: 'H-10-type',
      fileName: 'H-10-type.obk',
      title: 'Wrong type',
      check: 'decode',
      expectReason: 'wrong-type',
      expectPath: '/view',
      bytes: documentArchive(wrongType),
    }),
    spec({
      id: 'H-10',
      key: 'H-10-range',
      fileName: 'H-10-range.obk',
      title: 'Value out of range',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/view',
      bytes: documentArchive(outOfRange),
    }),
    spec({
      id: 'H-11',
      key: 'H-11-duplicate',
      fileName: 'H-11-duplicate.obk',
      title: 'Duplicate JSON keys',
      check: 'decode',
      expectReason: 'duplicate-key',
      expectPath: '/view',
      bytes: documentArchive(JSON.stringify(minimalDocument()).replace('{', '{"view":"pages",')),
    }),
    spec({
      id: 'H-11',
      key: 'H-11-surrogate',
      fileName: 'H-11-surrogate.obk',
      title: 'Unpaired surrogate',
      check: 'decode',
      expectReason: 'unpaired-surrogate',
      expectPath: '/blocks/0/content/0/text',
      bytes: documentArchive(minimalDocument([paragraph(3, [textRun('a\uD800b')])])),
    }),
    spec({
      id: 'H-11',
      key: 'H-11-nan',
      fileName: 'H-11-nan.obk',
      title: 'NaN',
      check: 'decode',
      expectReason: 'not-finite',
      expectPath: '/view',
      bytes: documentArchive(JSON.stringify(minimalDocument()).replace('"pageless"', 'NaN')),
    }),
    spec({
      id: 'H-11',
      key: 'H-11-infinity',
      fileName: 'H-11-infinity.obk',
      title: 'Infinity',
      check: 'decode',
      expectReason: 'not-finite',
      expectPath: '/page/margins/top',
      bytes: documentArchive(JSON.stringify(minimalDocument()).replace('"top":1', '"top":Infinity')),
    }),
    spec({
      id: 'H-12',
      key: 'H-12-id',
      fileName: 'H-12-id.obk',
      title: 'Repeated block ID',
      check: 'decode',
      expectReason: 'invalid',
      expectPath: '/blocks/1/id',
      bytes: documentArchive(minimalDocument([
        { type: 'divider', id: blockId(3) },
        { type: 'divider', id: blockId(3) },
      ])),
    }),
    spec({
      id: 'H-13',
      key: 'H-13-blocks',
      fileName: 'H-13-blocks.obk',
      title: 'Over 20,000 blocks',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks',
      bytes: documentArchive(minimalDocument(Array.from({ length: BLOCK_MAX + 1 }, (_, index) => ({
        type: 'divider',
        id: blockId(index + 3),
      })))),
    }),
    spec({
      id: 'H-13',
      key: 'H-13-rows',
      fileName: 'H-13-rows.obk',
      title: 'Table over 200 rows',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks/0/rows',
      bytes: documentArchive(minimalDocument([{
        type: 'table',
        id: blockId(3),
        headerRow: false,
        columnWidths: [1],
        rows: Array.from({ length: TABLE_ROW_MAX + 1 }, () => ({
          cells: [{ kind: 'text', content: [] }],
        })),
      }])),
    }),
    spec({
      id: 'H-13',
      key: 'H-13-columns',
      fileName: 'H-13-columns.obk',
      title: 'Table over 26 columns',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks/0/columnWidths',
      bytes: documentArchive(minimalDocument([{
        type: 'table',
        id: blockId(3),
        headerRow: false,
        columnWidths: Array.from({ length: TABLE_COLUMN_MAX + 1 }, () => 1),
        rows: [{ cells: [{ kind: 'text', content: [] }] }],
      }])),
    }),
    spec({
      id: 'H-13',
      key: 'H-13-text',
      fileName: 'H-13-text.obk',
      title: 'Text over its cap',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks/0/content/0/text',
      bytes: documentArchive(minimalDocument([paragraph(3, [textRun('x'.repeat(TEXT_MAX_CHARS + 1))])])),
    }),
    spec({
      id: 'H-14',
      key: 'H-14-nested',
      fileName: 'H-14-nested.obk',
      title: 'Columns inside columns',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks/0/columns/0/blocks/0/type',
      bytes: documentArchive(minimalDocument([{
        type: 'columns',
        id: blockId(3),
        columns: [
          { share: 0.5, blocks: [{ type: 'columns', id: blockId(4), columns: [] }] },
          { share: 0.5, blocks: [] },
        ],
      }])),
    }),
    spec({
      id: 'H-14',
      key: 'H-14-break',
      fileName: 'H-14-break.obk',
      title: 'Page break inside a column row',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/blocks/0/columns/0/blocks/0/type',
      bytes: documentArchive(minimalDocument([{
        type: 'columns',
        id: blockId(3),
        columns: [
          { share: 0.5, blocks: [{ type: 'pageBreak', id: blockId(4) }] },
          { share: 0.5, blocks: [] },
        ],
      }])),
    }),
    spec({
      id: 'H-15',
      key: 'H-15-version',
      fileName: 'H-15-version.obk',
      title: 'formatVersion newer than this schema',
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/formatVersion',
      bytes: documentArchive(minimalDocument(), {
        format: 'obelisk',
        formatVersion: 2,
        writer: '9.0.0',
        images: [],
      }),
    }),
    spec({
      id: 'H-15',
      key: 'H-15-message',
      fileName: 'H-15-version.obk',
      title: `Refused with "${UPDATE_MESSAGE}"`,
      check: 'decode',
      expectReason: 'out-of-range',
      expectPath: '/formatVersion',
      shared: true,
    }),
  );

  const mismatches = [
    ['H-16-png', 'png', 'png', jpegHeader(1, 1), 'PNG name, JPEG bytes'],
    ['H-16-jpg', 'jpg', 'jpeg', pngHeader(1, 1), 'JPEG name, PNG bytes'],
    ['H-16-gif', 'gif', 'gif', stillWebp(1, 1), 'GIF name, WebP bytes'],
    ['H-16-webp', 'webp', 'webp', gifFrames(1, 1, [{ x: 0, y: 0, width: 1, height: 1 }]), 'WebP name, GIF bytes'],
  ];
  for (const [key, extension, type, bytes, title] of mismatches) {
    specs.push(imageSpec(writer, key, title, bytes, extension, type, 1, 1, 1, 'type-mismatch'));
  }

  const wide = IMAGE_DIMENSION_MAX + 1;
  const headers = [
    ['H-17-png', pngHeader(wide, wide), 'png', 'png', 'PNG header over 8000 by 8000'],
    ['H-17-gif', gifFrames(wide, 1, [{ x: 0, y: 0, width: 1, height: 1 }]), 'gif', 'gif', 'GIF screen over 8000'],
    ['H-17-jpeg', jpegHeader(wide, 1), 'jpg', 'jpeg', 'JPEG header over 8000'],
    ['H-17-webp', stillWebp(wide, 1), 'webp', 'webp', 'WebP canvas over 8000'],
  ];
  for (const [key, bytes, extension, type, title] of headers) {
    specs.push(imageSpec(writer, key, title, bytes, extension, type, 1, 1, 1, 'header-too-large'));
  }

  specs.push(
    spec({
      id: 'H-18',
      key: 'H-18-entry',
      fileName: 'H-18-entry.obk',
      title: 'SVG entry',
      check: 'decode',
      expectReason: 'name-not-allowed',
      expectPath: 'image.svg',
      bytes: craftZip({
        entries: [
          storedEntry('manifest.json', MANIFEST),
          storedEntry('document.json', DOCUMENT),
          storedEntry('image.svg', Buffer.from(SVG_MARKUP)),
        ],
      }),
    }),
    spec({
      id: 'H-18',
      key: 'H-18-paste',
      fileName: 'H-18-paste.svg',
      title: 'SVG pasted',
      pending: [41],
      text: SVG_MARKUP,
    }),
  );

  const listed = sha256(Buffer.from('listed'));
  const actual = pngHeader(1, 1);
  const actualHash = sha256(actual);
  specs.push(
    spec({
      id: 'H-19',
      key: 'H-19-missing',
      fileName: 'H-19-missing.json',
      title: 'Block hash is not in the manifest',
      check: 'pair',
      expectReason: 'invalid',
      expectPath: '/blocks/0/sha256',
      json: {
        document: imageDocument('a'.repeat(64)),
        manifest: emptyManifest(writer),
      },
    }),
    spec({
      id: 'H-19',
      key: 'H-19-unlisted',
      fileName: 'H-19-unlisted.obk',
      title: 'Image entry is not in the manifest',
      check: 'decode',
      expectReason: 'not-in-manifest',
      expectPath: imageName(1),
      bytes: craftZip({
        entries: [
          storedEntry('manifest.json', Buffer.from(JSON.stringify(emptyManifest(writer)))),
          storedEntry('document.json', Buffer.from(JSON.stringify(minimalDocument()))),
          storedEntry(imageName(1), actual),
        ],
      }),
    }),
    spec({
      id: 'H-19',
      key: 'H-19-hash',
      fileName: 'H-19-hash.obk',
      title: 'Manifest hash does not match the entry bytes',
      check: 'decode',
      expectReason: 'hash-mismatch',
      expectPath: `images/${listed}.png`,
      bytes: craftZip({
        entries: [
          storedEntry('manifest.json', Buffer.from(JSON.stringify(imageManifest(writer, {
            sha256: listed,
            type: 'png',
            bytes: actual.length,
            width: 1,
            height: 1,
            frames: 1,
          })))),
          storedEntry('document.json', Buffer.from(JSON.stringify(imageDocument(listed)))),
          storedEntry(`images/${listed}.png`, actual),
        ],
      }),
    }),
  );
  if (listed === actualHash) {
    throw new Error('H-19 hash fixture accidentally matches.');
  }

  for (const [key, address, title] of [
    ['H-20-javascript', 'javascript:alert(1)', 'javascript: link'],
    ['H-20-file', 'file:///C:/Windows', 'file: link'],
    ['H-20-data', 'data:text/html,hi', 'data: link'],
    ['H-20-custom', 'obelisk:open', 'Custom-scheme link'],
  ]) {
    specs.push(spec({
      id: 'H-20',
      key,
      fileName: `${key}.json`,
      title,
      check: 'document',
      expectReason: 'invalid',
      expectPath: '/blocks/0/content/0/address',
      json: minimalDocument([paragraph(3, [linkRun(address)])]),
    }));
  }
  specs.push(spec({
    id: 'H-20',
    key: 'H-20-paste',
    fileName: 'H-20-paste.html',
    title: 'Pasted links dropped',
    pending: [41],
    text: [
      '<a href="javascript:alert(1)">j</a>',
      '<a href="file:///C:/Windows">f</a>',
      '<a href="data:text/html,hi">d</a>',
      '<a href="obelisk:open">c</a>',
    ].join(''),
  }));

  specs.push(
    spec({
      id: 'H-21',
      key: 'H-21-html',
      fileName: 'H-21-html.html',
      title: 'Pasted HTML',
      pending: [41],
      outcome: 'safe',
      text: [
        '<!doctype html><html><body>',
        '<script>alert(1)</script>',
        '<img src="https://evil.example/pixel.png" onerror="alert(1)">',
        '<div onclick="alert(1)">x</div>',
        '<iframe src="https://evil.example/"></iframe>',
        '</body></html>',
      ].join(''),
    }),
    spec({
      id: 'H-22',
      key: 'H-22-formula',
      fileName: 'H-22-formula.json',
      title: 'Formula commands',
      pending: [54],
      outcome: 'safe',
      json: minimalDocument([{
        type: 'formula',
        id: blockId(3),
        latex: [
          '\\href{https://evil.example}{x}',
          '\\url{https://evil.example}',
          '\\includegraphics{secret.png}',
          '<script>alert(1)</script>',
        ].join(' '),
      }]),
    }),
    spec({
      id: 'H-23',
      key: 'H-23-formula',
      fileName: 'H-23-formula.json',
      title: 'Huge formula, deep macro, and a carried gdef',
      pending: [54],
      outcome: 'safe',
      json: minimalDocument([
        {
          type: 'formula',
          id: blockId(3),
          latex: '\\gdef\\carried{99}\\fontsize{999999}{999999}\\selectfont\\def\\a{\\a}\\a',
        },
        { type: 'formula', id: blockId(4), latex: 'x' },
      ]),
    }),
    spec({
      id: 'H-24',
      key: 'H-24-diagram',
      fileName: 'H-24-diagram.json',
      title: 'Diagram HTML, click, and init',
      pending: [80],
      outcome: 'safe',
      json: minimalDocument([{
        type: 'diagram',
        id: blockId(3),
        source: [
          'flowchart LR',
          '  A["<img src=x onerror=alert(1)>"]',
          '  click A "javascript:alert(1)"',
          '%%{init: {"securityLevel":"loose"}}%%',
        ].join('\n'),
      }]),
    }),
    spec({
      id: 'H-25',
      key: 'H-25-argv',
      fileName: 'H-25-argv.json',
      title: 'Flags, a folder, and 21 files',
      pending: [68],
      outcome: 'safe',
      json: {
        args: [
          '--inspect',
          '--no-sandbox',
          'C:\\Notes',
          ...Array.from({ length: 21 }, (_, index) => `paper-${String(index + 1).padStart(2, '0')}.obk`),
        ],
      },
    }),
  );

  const controls = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f]
    .map((code) => String.fromCharCode(code))
    .join('');
  const exportText = `a<b>&c]]>d${controls}\uD800x\uDC00`;
  specs.push(spec({
    id: 'H-26',
    key: 'H-26-export',
    fileName: 'H-26-export.json',
    title: 'Export text, alt text, and link text',
    pending: [58, 59],
    outcome: 'safe',
    json: {
      text: exportText,
      alt: exportText,
      linkText: exportText,
      linkAddress: 'https://example.invalid/obelisk-h26',
    },
  }));

  const gif1001 = gifFrames(
    1,
    1,
    Array.from({ length: ANIMATION_FRAME_MAX + 1 }, () => ({ x: 0, y: 0, width: 1, height: 1 })),
  );
  const webpPixels = 4 * 8000 * 8000;
  if (webpPixels <= ANIMATION_PIXEL_MAX) {
    throw new Error('H-28 does not pass 250 million pixels.');
  }
  const webpOver = animatedWebp(4, 8000, 8000);
  const gifOutside = gifFrames(10, 10, [{ x: 8, y: 8, width: 4, height: 4 }]);
  specs.push(
    imageSpec(writer, 'H-27-gif', 'Animated GIF with 1,001 frames', gif1001, 'gif', 'gif', 1, 1, 1, 'too-many-frames'),
    imageSpec(writer, 'H-28-webp', 'Animated WebP over 250 million pixels', webpOver, 'webp', 'webp', 1, 1, 1, 'pixel-budget'),
    imageSpec(writer, 'H-29-gif', 'GIF frame outside the image', gifOutside, 'gif', 'gif', 10, 10, 1, 'frame-outside'),
  );

  specs.push(
    spec({
      id: 'H-30',
      key: 'H-30-handle',
      fileName: 'H-30-handle.json',
      title: 'Unknown handle',
      check: 'handle',
      expectReason: 'PATH_NOT_ALLOWED',
      expectPath: '',
      json: { channel: 'file:save', handle: 'not-issued-by-main' },
    }),
    spec({
      id: 'H-30',
      key: 'H-30-recovery',
      fileName: 'H-30-recovery.json',
      title: 'Recovery ID that names another file',
      pending: [69],
      json: {
        channel: 'recovery:restore',
        id: '11111111-1111-4111-8111-111111111111',
        namesFile: 'other.obk',
      },
    }),
  );

  const markup = '<script>alert(1)</script><img src="https://evil.example/pixel.png">';
  specs.push(
    spec({
      id: 'H-31',
      key: 'H-31-text',
      fileName: 'H-31-text.json',
      title: 'Paragraph text holds script and image tags',
      check: 'document',
      outcome: 'accepted',
      expectText: markup,
      json: minimalDocument([paragraph(3, [textRun(markup)])]),
    }),
    spec({
      id: 'H-31',
      key: 'H-31-display',
      fileName: 'H-31-text.json',
      title: 'Shown as text and no request is sent',
      pending: [44],
      outcome: 'safe',
      shared: true,
    }),
    spec({
      id: 'H-32',
      key: 'H-32-preferences',
      fileName: 'H-32-preferences.json',
      title: 'Damaged preferences.json',
      pending: [60],
      outcome: 'safe',
      text: '{"version":1,"theme":',
    }),
    spec({
      id: 'H-32',
      key: 'H-32-session',
      fileName: 'H-32-session.json',
      title: 'Damaged session.json',
      pending: [61],
      outcome: 'safe',
      text: '{',
    }),
    spec({
      id: 'H-32',
      key: 'H-32-recovery',
      fileName: 'H-32-recovery.obk',
      title: 'Damaged recovery copy',
      pending: [69],
      outcome: 'safe',
      text: 'this is not an obk',
    }),
    spec({
      id: 'H-32',
      key: 'H-32-signatures',
      fileName: 'H-32-signatures.json',
      title: 'Damaged signature index',
      pending: [77],
      outcome: 'safe',
      text: '[',
    }),
  );

  return specs;
}

async function writeSpec(filePath, item) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (item.sparseBytes != null) {
    const handle = await open(filePath, 'w');
    try {
      await handle.truncate(item.sparseBytes);
    } finally {
      await handle.close();
    }
    return;
  }
  if (item.json !== undefined) {
    await writeFile(filePath, JSON.stringify(item.json));
    return;
  }
  if (item.text !== undefined) {
    await writeFile(filePath, item.text);
    return;
  }
  if (item.bytes) {
    await writeFile(filePath, item.bytes);
    return;
  }
  throw new Error(`${item.key} has nothing to write.`);
}

export async function generateHostileFixtures(directory, root) {
  await mkdir(directory, { recursive: true });
  const markdown = await readFile(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8');
  const rows = hostileRows(markdown);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const specs = buildSpecs(pkg.version);
  const cases = [];
  for (const item of specs) {
    const row = byId.get(item.id);
    if (!row) {
      throw new Error(`No architecture row for ${item.id}.`);
    }
    const filePath = path.join(directory, item.fileName);
    if (!item.shared) {
      await writeSpec(filePath, item);
      const info = await stat(filePath);
      if (item.sparseBytes == null && info.size > FIXTURE_DISK_MAX_BYTES) {
        throw new Error(`${item.key} is ${info.size} bytes. Generate bombs compressed.`);
      }
      if (item.sparseBytes != null && info.size !== item.sparseBytes) {
        throw new Error(`${item.key} size is ${info.size}, not ${item.sparseBytes}.`);
      }
    }
    cases.push({
      id: item.id,
      key: item.key,
      fileName: item.fileName,
      filePath,
      title: item.title,
      sample: row.sample,
      expected: row.expected,
      pending: item.pending,
      check: item.check,
      outcome: item.outcome,
      expectReason: item.expectReason,
      expectPath: item.expectPath,
      expectText: item.expectText,
    });
  }
  for (const row of rows) {
    if (!cases.some((item) => item.id === row.id)) {
      throw new Error(`No fixture for ${row.id}.`);
    }
  }
  await writeFile(path.join(directory, 'catalog.json'), `${JSON.stringify({
    cases: cases.map((item) => ({
      id: item.id,
      key: item.key,
      file: item.fileName,
      title: item.title,
      sample: item.sample,
      expected: item.expected,
      pending: item.pending,
      outcome: item.outcome,
    })),
  }, null, 2)}\n`);
  return { directory, cases };
}
