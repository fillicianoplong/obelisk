import { open } from 'node:fs/promises';

// yauzl does not keep the per-entry disk number. The codec reads that field
// itself so an entry stored on another disk is refused before its payload.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export async function readEntryDisks(filePath: string, fileSize: number, entryCount: number): Promise<number[]> {
  const handle = await open(filePath, 'r');
  try {
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await readExact(handle, tail, fileSize - tailLength);
    const eocd = findEocd(tail);
    if (eocd < 0) {
      throw new Error('End of central directory record signature not found');
    }
    const disk = tail.readUInt16LE(eocd + 4);
    if (disk !== 0) {
      throw new Error(`multi-disk zip files are not supported: found disk number: ${disk}`);
    }
    const listed = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (listed !== entryCount) {
      throw new Error(`end of central directory lists ${listed} entries, not ${entryCount}`);
    }
    if (centralOffset > fileSize || centralSize > fileSize - centralOffset) {
      throw new Error('central directory extends past the end of the file');
    }
    const central = Buffer.alloc(centralSize);
    await readExact(handle, central, centralOffset);
    return entryDisks(central, entryCount);
  } finally {
    await handle.close();
  }
}

function entryDisks(central: Buffer, entryCount: number): number[] {
  const disks: number[] = [];
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
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
    if (buffer.readUInt32LE(index) !== EOCD_SIGNATURE) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(index + 20);
    if (index + 22 + commentLength === buffer.length) {
      return index;
    }
  }
  return -1;
}

async function readExact(handle: Awaited<ReturnType<typeof open>>, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error('unexpected EOF');
    }
    offset += bytesRead;
  }
}
