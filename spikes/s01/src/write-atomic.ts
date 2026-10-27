import { createHash, randomBytes } from 'node:crypto';
import { open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

// Keep these in sync with watch-replace.ps1.
export const BODY_LEN = 65536;
export const PAYLOAD_LEN = 4 + 4 + 4 + 1 + BODY_LEN + 4;
export const MARK_HEAD = Buffer.from('OBK1');
export const MARK_TAIL = Buffer.from('END1');
export const FILL_A = 0x41;
export const FILL_B = 0x42;
export const REPLACE_COUNT = 40;
export const REPLACE_GAP_MS = 25;

const TEMP_NAME = /^\.~obk-[0-9a-f]{32}\.tmp$/;

export function tempName(): string {
  return `.~obk-${randomBytes(16).toString('hex')}.tmp`;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function markerText(label: string, token: string): Buffer {
  return Buffer.from(`Obelisk spike S-01\ncase: ${label}\ntoken: ${token}\n`, 'utf8');
}

export function buildPayload(generation: number, fill: number): Buffer {
  const buf = Buffer.alloc(PAYLOAD_LEN);
  MARK_HEAD.copy(buf, 0);
  buf.writeUInt32LE(generation >>> 0, 4);
  buf.writeUInt32LE(BODY_LEN, 8);
  buf.writeUInt8(fill, 12);
  buf.fill(fill, 13, 13 + BODY_LEN);
  MARK_TAIL.copy(buf, 13 + BODY_LEN);
  return buf;
}

export function describePayload(buf: Buffer): { ok: true; generation: number; fill: number } | { ok: false; reason: string } {
  if (buf.length !== PAYLOAD_LEN) return { ok: false, reason: `length ${buf.length}` };
  if (!buf.subarray(0, 4).equals(MARK_HEAD)) return { ok: false, reason: 'head' };
  if (!buf.subarray(buf.length - 4).equals(MARK_TAIL)) return { ok: false, reason: 'tail' };
  const generation = buf.readUInt32LE(4);
  const bodyLen = buf.readUInt32LE(8);
  const fill = buf.readUInt8(12);
  if (bodyLen !== BODY_LEN) return { ok: false, reason: 'body length field' };
  if (buf[13] !== fill || buf[13 + BODY_LEN - 1] !== fill) return { ok: false, reason: 'fill' };
  for (let offset = 0; offset < BODY_LEN; offset += 64) {
    if (buf[13 + offset] !== fill) return { ok: false, reason: 'fill' };
  }
  return { ok: true, generation, fill };
}

export interface NodeFailure {
  code: string | null;
  errno: number | null;
  syscall: string | null;
  message: string;
}

export function asNodeError(error: unknown): NodeFailure {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; errno?: unknown; syscall?: unknown; message?: unknown };
    return {
      code: typeof record.code === 'string' ? record.code : null,
      errno: typeof record.errno === 'number' ? record.errno : null,
      syscall: typeof record.syscall === 'string' ? record.syscall : null,
      message: typeof record.message === 'string' ? record.message : String(error),
    };
  }
  return { code: null, errno: null, syscall: null, message: String(error) };
}

export interface WriteResult extends NodeFailure {
  ok: boolean;
  tempPath: string;
  tempLeft: boolean;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// Exclusive temp in the same folder, flush, then one rename. Node's fs.rename on Windows is libuv's MoveFileExW.
export async function writeAtomic(target: string, bytes: Buffer): Promise<WriteResult> {
  const tempPath = path.join(path.dirname(target), tempName());
  let handle: FileHandle | null = null;
  try {
    handle = await open(tempPath, 'wx');
    const written = await handle.write(bytes);
    if (written.bytesWritten !== bytes.length) {
      const short = new Error(`Short write to the temp file (${written.bytesWritten} of ${bytes.length}).`);
      throw Object.assign(short, { code: 'EIO', syscall: 'write' });
    }
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true });
    return { ok: false, ...asNodeError(error), tempPath, tempLeft: await fileExists(tempPath) };
  }
  await handle.close();
  try {
    await rename(tempPath, target);
  } catch (error) {
    await rm(tempPath, { force: true });
    return { ok: false, ...asNodeError(error), tempPath, tempLeft: await fileExists(tempPath) };
  }
  return {
    ok: true,
    code: null,
    errno: null,
    syscall: null,
    message: '',
    tempPath,
    tempLeft: false,
  };
}

export async function selfTest(dir: string): Promise<{ pass: boolean; detail: string }> {
  const name = tempName();
  if (!TEMP_NAME.test(name)) return { pass: false, detail: `Temp name ${name} does not match the writeAtomic pattern.` };
  const payload = buildPayload(7, FILL_A);
  const described = describePayload(payload);
  if (!described.ok || described.generation !== 7 || described.fill !== FILL_A) {
    return { pass: false, detail: 'The payload round-trip failed.' };
  }
  if (describePayload(payload.subarray(0, payload.length - 1)).ok) {
    return { pass: false, detail: 'A short buffer was accepted as a complete payload.' };
  }
  const file = path.join(dir, name);
  const first = await open(file, 'wx');
  await first.close();
  try {
    await open(file, 'wx');
    return { pass: false, detail: 'The second exclusive create did not fail.' };
  } catch (error) {
    const nodeError = asNodeError(error);
    if (nodeError.code !== 'EEXIST') {
      return { pass: false, detail: `Exclusive create failed with ${nodeError.code ?? nodeError.message}, not EEXIST.` };
    }
  } finally {
    await rm(file, { force: true });
  }
  return { pass: true, detail: 'Temp name, payload, and exclusive create match the writeAtomic shape.' };
}
