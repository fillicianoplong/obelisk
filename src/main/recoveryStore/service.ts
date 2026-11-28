import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DecodeResult } from '../codec/decode.js';
import { encodeDocumentMessage } from '../document/encodeMessage.js';
import { ipcImagesFromDecoded, toDocumentMessage } from '../document/ipcImages.js';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type {
  FileStat,
  RecoveryDropRequest,
  RecoveryDropResult,
  RecoveryListResult,
  RecoveryPutRequest,
  RecoveryPutResult,
  RecoveryRestoreRequest,
  RecoveryRestoreResult,
  RecoverySummary,
} from '../../shared/ipc/types.js';
import { writeAtomic } from '../file/writeAtomic.js';

const RECOVERY_DIR = 'recovery';
const METADATA_SUFFIX = '.json';
const PACKAGE_SUFFIX = '.obk';
const UNTITLED = 'Untitled';

interface RecoveryMetadata {
  firstLine: string;
  time: string;
}

export interface RecoveryServiceDeps {
  userData: () => string;
  writer: string;
  readObk: (filePath: string) => Promise<DecodeResult>;
  privateAppData: readonly string[];
}

export interface RecoveryService {
  put(request: RecoveryPutRequest): Promise<RecoveryPutResult>;
  list(): Promise<RecoveryListResult>;
  restore(request: RecoveryRestoreRequest): Promise<RecoveryRestoreResult>;
  drop(request: RecoveryDropRequest): Promise<RecoveryDropResult>;
}

function recoveryRoot(userData: string): string {
  return path.join(userData, RECOVERY_DIR);
}

function obkPath(root: string, id: string): string {
  return path.join(root, `${id}${PACKAGE_SUFFIX}`);
}

function metaPath(root: string, id: string): string {
  return path.join(root, `${id}${METADATA_SUFFIX}`);
}

function newRecoveryId(): string {
  return randomBytes(16).toString('hex');
}

function parseMetadata(text: string): RecoveryMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.firstLine !== 'string' || typeof record.time !== 'string') {
    return null;
  }
  return { firstLine: record.firstLine, time: record.time };
}

async function fileStat(filePath: string): Promise<FileStat | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return null;
    }
    const modifiedMs = Math.trunc(info.mtimeMs);
    if (!Number.isSafeInteger(info.size) || info.size < 0 || !Number.isSafeInteger(modifiedMs) || modifiedMs < 0) {
      return null;
    }
    return { size: info.size, modifiedMs };
  } catch {
    return null;
  }
}

export function createRecoveryService(deps: RecoveryServiceDeps): RecoveryService {
  async function put(request: RecoveryPutRequest): Promise<RecoveryPutResult> {
    const root = recoveryRoot(deps.userData());
    const id = request.recoveryId ?? newRecoveryId();
    if (request.recoveryId !== null) {
      const meta = await readFile(metaPath(root, id), 'utf8').catch(() => null);
      if (meta === null || parseMetadata(meta) === null) {
        return ipcError('ENOENT', 'That recovery copy was not found.');
      }
    }
    await mkdir(root, { recursive: true });
    const encoded = await encodeDocumentMessage(request.document, request.images, deps.writer);
    if (!('bytes' in encoded)) {
      return encoded;
    }
    const obk = obkPath(root, id);
    const written = await writeAtomic(obk, encoded.bytes, {
      kind: 'record',
      privateAppData: deps.privateAppData,
    });
    if (written.status !== 'ok') {
      return written as IpcErrorResult;
    }
    const metadata: RecoveryMetadata = {
      firstLine: request.firstLine,
      time: new Date().toISOString(),
    };
    const metaWritten = await writeAtomic(
      metaPath(root, id),
      Buffer.from(JSON.stringify(metadata), 'utf8'),
      { kind: 'record', privateAppData: deps.privateAppData },
    );
    if (metaWritten.status !== 'ok') {
      await rm(obk, { force: true });
      return metaWritten as IpcErrorResult;
    }
    return { status: 'ok', recoveryId: id };
  }

  async function list(): Promise<RecoveryListResult> {
    const root = recoveryRoot(deps.userData());
    let names: string[];
    try {
      names = await readdir(root);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        return { status: 'ok', entries: [] };
      }
      return ipcError('EACCES', 'Recovery copies could not be listed.');
    }
    const entries: RecoverySummary[] = [];
    for (const name of names) {
      if (!name.endsWith(METADATA_SUFFIX)) {
        continue;
      }
      const id = name.slice(0, -METADATA_SUFFIX.length);
      const obk = obkPath(root, id);
      const metaText = await readFile(metaPath(root, id), 'utf8').catch(() => null);
      if (metaText === null) {
        continue;
      }
      const meta = parseMetadata(metaText);
      if (meta === null) {
        continue;
      }
      const recorded = await fileStat(obk);
      if (recorded === null) {
        continue;
      }
      entries.push({ id, firstLine: meta.firstLine, time: meta.time });
    }
    entries.sort((left, right) => right.time.localeCompare(left.time));
    return { status: 'ok', entries };
  }

  async function restore(request: RecoveryRestoreRequest): Promise<RecoveryRestoreResult> {
    const root = recoveryRoot(deps.userData());
    const obk = obkPath(root, request.recoveryId);
    const metaText = await readFile(metaPath(root, request.recoveryId), 'utf8').catch(() => null);
    if (metaText === null) {
      return { status: 'refused', reason: 'notFound', message: 'That recovery copy was not found.' };
    }
    const meta = parseMetadata(metaText);
    if (meta === null) {
      return { status: 'refused', reason: 'unreadable', message: 'This recovery copy could not be read.' };
    }
    const recorded = await fileStat(obk);
    if (recorded === null) {
      return { status: 'refused', reason: 'unreadable', message: 'This recovery copy could not be read.' };
    }
    const decoded = await deps.readObk(obk);
    if (!decoded.ok) {
      const message = decoded.message.length > 0 ? decoded.message : 'This recovery copy could not be read.';
      return { status: 'refused', reason: 'unreadable', message };
    }
    const document = toDocumentMessage(decoded.document);
    const images = ipcImagesFromDecoded(decoded.manifest, decoded.packedImages);
    const name = recoveryTabName(meta.firstLine);
    return {
      status: 'ok',
      handle: request.recoveryId,
      name,
      document,
      images,
      stat: recorded,
    };
  }

  async function drop(request: RecoveryDropRequest): Promise<RecoveryDropResult> {
    const root = recoveryRoot(deps.userData());
    const obk = obkPath(root, request.recoveryId);
    const meta = metaPath(root, request.recoveryId);
    const hasMeta = await readFile(meta, 'utf8').then(() => true, () => false);
    if (!hasMeta) {
      return { status: 'notFound' };
    }
    await Promise.all([
      rm(obk, { force: true }),
      rm(meta, { force: true }),
    ]);
    return { status: 'ok' };
  }

  return { put, list, restore, drop };
}

function recoveryTabName(firstLine: string): string {
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) {
    return UNTITLED;
  }
  if (trimmed.length <= 80) {
    return trimmed;
  }
  return `${trimmed.slice(0, 77)}...`;
}