import { randomBytes } from 'node:crypto';
import { open, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformPath } from 'node:path';
import { APP_DATA_DIR_NAME, isInsideDirectory } from '../security/app-data.js';
import { ipcError, ipcTimeout, type IpcErrorResult, type IpcTimeoutResult } from '../../shared/ipc/errors.js';
import type { FileStat } from '../../shared/ipc/types.js';

// Section 6.1. A save is one temp file in the same folder, then one rename.
// The unsaved mark can clear only after this returns ok (NFR-12).

export const SAVE_TIMEOUT_MS = 5000;
export const RENAME_ATTEMPTS = 3;
export const RENAME_RETRY_MS = 100;
export const TEMP_MAX_AGE_MS = 10 * 60 * 1000;

// 128-bit hex, lowercase. Nothing else is one of our temp files (NFR-14).
export const TEMP_FILE_PATTERN = /^\.~obk-[0-9a-f]{32}\.tmp$/;

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WRITE_BITS = 0o222;
const TEMP_CREATE_ATTEMPTS = 5;

const TIMEOUT_MESSAGE = 'The save did not finish within 5 seconds, so it was not saved.';
const DISK_FULL_MESSAGE = 'The disk is full, so it was not saved.';
const READ_ONLY_MESSAGE = 'This file is read-only, so it was not saved.';
const IN_USE_MESSAGE = 'Another program has this file open, so it was not saved.';
const MISSING_FOLDER_MESSAGE = 'The folder is missing, so it was not saved.';
const DENIED_MESSAGE = 'The save was denied, so it was not saved.';
const FAILED_MESSAGE = 'The save failed, so it was not saved.';
const APP_DATA_MESSAGE = "A document is not saved under the app's private AppData.";

export type WriteKind = 'document' | 'record';

export interface AtomicStat {
  size: number;
  mtimeMs: number;
  mode: number;
  isFile(): boolean;
}

export interface AtomicFileHandle {
  write(data: Uint8Array): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicFs {
  open(file: string, flags: string): Promise<AtomicFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
  stat(file: string): Promise<AtomicStat>;
  readdir(directory: string): Promise<readonly string[]>;
}

export interface WriteAtomicOptions {
  /** A document is refused under private AppData. App records opt in with record. */
  kind?: WriteKind;
  /** Extra roots, such as a custom user-data directory, treated as private AppData. */
  privateAppData?: readonly string[];
  pathApi?: PlatformPath;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fs?: AtomicFs;
  randomBytes?: (size: number) => Uint8Array;
}

export interface DocumentDirectoryInput {
  documents: string;
  privateRoots: readonly string[];
  pathApi?: PlatformPath;
}

export type DocumentDirectoryResult =
  | { ok: true; directory: string }
  | { ok: false; message: string };

export type WriteAtomicResult =
  | { status: 'ok'; stat: FileStat }
  | IpcTimeoutResult
  | IpcErrorResult;

interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

interface CodedError extends Error {
  code?: string;
}

class SaveTimeout extends Error {
  constructor() {
    super('timeout');
    this.name = 'SaveTimeout';
  }
}

const nodeFs: AtomicFs = {
  open(file, flags) {
    return open(file, flags);
  },
  rename(from, to) {
    return rename(from, to);
  },
  unlink(file) {
    return unlink(file);
  },
  async stat(file) {
    const info = await stat(file);
    return {
      size: info.size,
      mtimeMs: info.mtimeMs,
      mode: info.mode,
      isFile: () => info.isFile(),
    };
  },
  readdir(directory) {
    return readdir(directory);
  },
};

function nodeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as CodedError).code;
  return typeof code === 'string' ? code : null;
}

function ioError(code: string, message: string): Error {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function abortError(): Error {
  const error = new Error('The wait was aborted.');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pathParts(filePath: string): string[] {
  return filePath
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function hasAppDataFolder(filePath: string): boolean {
  const parts = pathParts(filePath);
  const folder = APP_DATA_DIR_NAME.toLowerCase();
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] !== 'appdata') {
      continue;
    }
    const scope = parts[index + 1];
    if ((scope === 'roaming' || scope === 'local') && parts[index + 2] === folder) {
      return true;
    }
  }
  return false;
}

function hasPackageLocalCache(filePath: string): boolean {
  const parts = pathParts(filePath);
  const packages = parts.indexOf('packages');
  if (packages === -1) {
    return false;
  }
  return parts.indexOf('localcache', packages + 1) !== -1;
}

export function isPrivateDocumentPath(
  filePath: string,
  privateRoots: readonly string[] = [],
  pathApi: PlatformPath = path,
): boolean {
  if (hasAppDataFolder(filePath) || hasPackageLocalCache(filePath)) {
    return true;
  }
  for (const root of privateRoots) {
    if (root.trim() === '') {
      continue;
    }
    if (isInsideDirectory(root, filePath, pathApi)) {
      return true;
    }
  }
  return false;
}

// Documents default to the Documents folder. They do not fall back to AppData
// when that folder is the package's private cache (spike S-01).
export function defaultDocumentDirectory(input: DocumentDirectoryInput): DocumentDirectoryResult {
  const pathApi = input.pathApi ?? path;
  const documents = pathApi.resolve(input.documents);
  if (isPrivateDocumentPath(documents, input.privateRoots, pathApi)) {
    return { ok: false, message: APP_DATA_MESSAGE };
  }
  return { ok: true, directory: documents };
}

export function tempFileName(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  const name = `.~obk-${hex}.tmp`;
  if (!TEMP_FILE_PATTERN.test(name)) {
    throw new Error('A temp save name must be 16 random bytes.');
  }
  return name;
}

// The unsaved mark clears only for a finished replace, and only when the tab
// was not edited again while the save was in flight (NFR-12).
export function saveClearedUnsavedMark(result: WriteAtomicResult, revisionUnchanged: boolean): boolean {
  return result.status === 'ok' && revisionUnchanged;
}

export interface CleanupOptions {
  now?: () => number;
  fs?: AtomicFs;
  pathApi?: PlatformPath;
}

export async function removeStaleTempFiles(directory: string, options: CleanupOptions = {}): Promise<void> {
  const fs = options.fs ?? nodeFs;
  const pathApi = options.pathApi ?? path;
  const now = options.now?.() ?? Date.now();
  let names: readonly string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (!TEMP_FILE_PATTERN.test(name)) {
      continue;
    }
    const full = pathApi.join(directory, name);
    let info: AtomicStat;
    try {
      info = await fs.stat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) {
      continue;
    }
    if (now - info.mtimeMs <= TEMP_MAX_AGE_MS) {
      continue;
    }
    try {
      await fs.unlink(full);
    } catch {
      // The next save to this folder tries again.
    }
  }
}

function withDeadline<T>(work: Promise<T>, deadline: number, clock: Clock): Promise<T> {
  const remaining = deadline - clock.now();
  if (remaining <= 0) {
    return Promise.reject(new SaveTimeout());
  }
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      controller.abort();
      settle();
    };
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    clock.sleep(remaining, controller.signal).then(
      () => finish(() => reject(new SaveTimeout())),
      () => {
        // The work finished first, and the wait was cancelled.
      },
    );
  });
}

function timeoutResult(): IpcTimeoutResult {
  return ipcTimeout(TIMEOUT_MESSAGE);
}

function fromIo(error: unknown): IpcErrorResult | IpcTimeoutResult {
  if (error instanceof SaveTimeout) {
    return timeoutResult();
  }
  const code = nodeCode(error);
  if (code === 'ENOSPC') {
    return ipcError('ENOSPC', DISK_FULL_MESSAGE);
  }
  if (code === 'ENOENT') {
    return ipcError('ENOENT', MISSING_FOLDER_MESSAGE);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return ipcError('EACCES', DENIED_MESSAGE);
  }
  return ipcError('EACCES', FAILED_MESSAGE);
}

async function discardTemp(fs: AtomicFs, tempPath: string): Promise<void> {
  try {
    await fs.unlink(tempPath);
  } catch {
    // A young leftover is removed on a later save once it is 10 minutes old.
  }
}

async function targetIsReadOnly(fs: AtomicFs, target: string): Promise<boolean> {
  try {
    const info = await fs.stat(target);
    if (!info.isFile()) {
      return false;
    }
    // Node reports the Windows read-only attribute as a mode with no write bits.
    return (info.mode & WRITE_BITS) === 0;
  } catch {
    return false;
  }
}

async function openTemp(
  directory: string,
  fs: AtomicFs,
  random: (size: number) => Uint8Array,
  pathApi: PlatformPath,
  deadline: number,
  clock: Clock,
): Promise<{ tempPath: string; handle: AtomicFileHandle }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TEMP_CREATE_ATTEMPTS; attempt += 1) {
    const tempPath = pathApi.join(directory, tempFileName(random(16)));
    try {
      const handle = await withDeadline(fs.open(tempPath, 'wx'), deadline, clock);
      return { tempPath, handle };
    } catch (error) {
      if (error instanceof SaveTimeout || nodeCode(error) !== 'EEXIST') {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : ioError('EEXIST', 'The temp file could not be created.');
}

async function writeAll(
  handle: AtomicFileHandle,
  bytes: Uint8Array,
  deadline: number,
  clock: Clock,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const chunk = bytes.subarray(offset);
    const result = await withDeadline(handle.write(chunk), deadline, clock);
    if (result.bytesWritten <= 0) {
      throw ioError('ENOSPC', DISK_FULL_MESSAGE);
    }
    if (result.bytesWritten > chunk.byteLength) {
      throw ioError('EIO', FAILED_MESSAGE);
    }
    offset += result.bytesWritten;
    if (clock.now() >= deadline) {
      throw new SaveTimeout();
    }
  }
}

async function finishReplace(
  fs: AtomicFs,
  clock: Clock,
  tempPath: string,
  target: string,
  bytes: Uint8Array,
): Promise<WriteAtomicResult> {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(tempPath, target);
      return await replacedStat(fs, clock, target, bytes);
    } catch (error) {
      const code = nodeCode(error);
      if (code === null || !RETRY_CODES.has(code)) {
        await discardTemp(fs, tempPath);
        return fromIo(error);
      }
      // A read-only file and a file held open both come back as EPERM (S-01).
      // The read-only attribute will not clear on a retry.
      if (await targetIsReadOnly(fs, target)) {
        await discardTemp(fs, tempPath);
        return ipcError('EACCES', READ_ONLY_MESSAGE);
      }
      if (attempt === RENAME_ATTEMPTS) {
        await discardTemp(fs, tempPath);
        return ipcError('EBUSY_EXHAUSTED', IN_USE_MESSAGE);
      }
      await clock.sleep(RENAME_RETRY_MS);
    }
  }
  await discardTemp(fs, tempPath);
  return ipcError('EBUSY_EXHAUSTED', IN_USE_MESSAGE);
}

async function replacedStat(
  fs: AtomicFs,
  clock: Clock,
  target: string,
  bytes: Uint8Array,
): Promise<WriteAtomicResult> {
  try {
    const info = await fs.stat(target);
    if (!info.isFile() || info.size !== bytes.byteLength) {
      return ipcError('ENOSPC', DISK_FULL_MESSAGE);
    }
    return { status: 'ok', stat: { size: info.size, modifiedMs: info.mtimeMs } };
  } catch {
    // The rename already replaced the target. Report that, not a failed save.
    return { status: 'ok', stat: { size: bytes.byteLength, modifiedMs: clock.now() } };
  }
}

export async function writeAtomic(
  target: string,
  bytes: Uint8Array,
  options: WriteAtomicOptions = {},
): Promise<WriteAtomicResult> {
  const fs = options.fs ?? nodeFs;
  const pathApi = options.pathApi ?? path;
  const clock: Clock = {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? sleep,
  };
  const timeoutMs = options.timeoutMs ?? SAVE_TIMEOUT_MS;
  const kind = options.kind ?? 'document';
  if (kind !== 'record' && isPrivateDocumentPath(target, options.privateAppData ?? [], pathApi)) {
    return ipcError('PATH_NOT_ALLOWED', APP_DATA_MESSAGE);
  }

  const directory = pathApi.dirname(target);
  const deadline = clock.now() + timeoutMs;
  const cleanup = () => removeStaleTempFiles(directory, { fs, now: () => clock.now(), pathApi });

  let tempPath = '';
  let handle: AtomicFileHandle | null = null;
  try {
    await withDeadline(cleanup(), deadline, clock);
    const opened = await openTemp(
      directory,
      fs,
      options.randomBytes ?? randomBytes,
      pathApi,
      deadline,
      clock,
    );
    tempPath = opened.tempPath;
    handle = opened.handle;
    await writeAll(handle, bytes, deadline, clock);
    await withDeadline(handle.sync(), deadline, clock);
    await withDeadline(handle.close(), deadline, clock);
    handle = null;
    // Checked once, just before the rename. A rename that has started is not cancelled.
    if (clock.now() >= deadline) {
      throw new SaveTimeout();
    }
    return await finishReplace(fs, clock, tempPath, target, bytes);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (tempPath !== '') {
      await discardTemp(fs, tempPath);
    }
    return fromIo(error);
  } finally {
    await cleanup().catch(() => undefined);
  }
}
