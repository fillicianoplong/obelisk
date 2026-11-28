import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DecodeResult } from '../codec/decode.js';
import { encodeObk } from '../codec/encode/index.js';
import { archiveMessage } from '../codec/archive/result.js';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type {
  DocumentMessage,
  FileOpenResult,
  FileStat,
  RecoveryDropResult,
  RecoveryListResult,
  RecoveryPutRequest,
  RecoveryPutResult,
  RecoveryRestoreRequest,
  RecoverySummary,
} from '../../shared/ipc/types.js';
import { FORMAT_NAME, FORMAT_VERSION } from '../../shared/schema/index.js';
import type { Document } from '../../shared/schema/index.js';
import { writeAtomic, type WriteAtomicResult } from '../file/writeAtomic.js';
import { formatRecoveryMetadata, parseRecoveryMetadata, type RecoveryMetadata } from './metadata.js';
import { isRecoveryId, recoveryDirectory, recoveryRecordPaths } from './paths.js';

const ENCODE_FAILED = 'This document is not valid, so it was not saved.';
const MISSING_MESSAGE = 'This recovery copy could not be found.';
const DAMAGED_MESSAGE = 'This recovery copy is damaged and cannot be restored.';

function writeError(result: Exclude<WriteAtomicResult, { status: 'ok' }>): IpcErrorResult {
  if (result.status === 'timeout') {
    return ipcError('TIMEOUT', result.message);
  }
  return result;
}

export interface RecoveryServiceDeps {
  userDataDir: string;
  writer?: string;
  privateAppData?: readonly string[];
  readObk(filePath: string): Promise<DecodeResult>;
}

export interface RecoveryService {
  put(request: RecoveryPutRequest): Promise<RecoveryPutResult>;
  list(): Promise<RecoveryListResult>;
  restore(request: RecoveryRestoreRequest): Promise<FileOpenResult>;
  drop(recoveryId: string): Promise<RecoveryDropResult>;
}

function newRecoveryId(used: Set<string>): string {
  let id = randomBytes(16).toString('hex');
  while (used.has(id)) {
    id = randomBytes(16).toString('hex');
  }
  used.add(id);
  return id;
}

function toDocumentMessage(document: Document): DocumentMessage {
  const copy = structuredClone(document);
  return {
    view: copy.view,
    page: copy.page as unknown as DocumentMessage['page'],
    header: copy.header as unknown as DocumentMessage['header'],
    footer: copy.footer as unknown as DocumentMessage['footer'],
    blocks: copy.blocks as unknown as DocumentMessage['blocks'],
  };
}

function refused(message: string): FileOpenResult {
  return { status: 'refused', reason: 'unreadable', message };
}

function recoveredTitle(firstLine: string): string {
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) {
    return 'Untitled';
  }
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

async function listRecoveryIds(userDataDir: string): Promise<Set<string>> {
  const dir = recoveryDirectory(userDataDir);
  let names: readonly string[];
  try {
    names = await readdir(dir);
  } catch {
    return new Set();
  }
  const ids = new Set<string>();
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const id = name.slice(0, -'.json'.length);
    if (isRecoveryId(id)) {
      ids.add(id);
    }
  }
  return ids;
}

async function removeRecord(userDataDir: string, recoveryId: string): Promise<void> {
  const paths = recoveryRecordPaths(userDataDir, recoveryId);
  if (paths === null) {
    return;
  }
  await Promise.all([
    unlink(paths.obk).catch(() => undefined),
    unlink(paths.meta).catch(() => undefined),
  ]);
}

export function createRecoveryService(deps: RecoveryServiceDeps): RecoveryService {
  const writer = deps.writer ?? '0.1.72.0';

  async function ensureDir(): Promise<void> {
    await mkdir(recoveryDirectory(deps.userDataDir), { recursive: true });
  }

  async function encodeDocument(document: DocumentMessage): Promise<{ ok: true; bytes: Buffer } | IpcErrorResult> {
    let encoded;
    try {
      encoded = await encodeObk(document, {
        format: FORMAT_NAME,
        formatVersion: FORMAT_VERSION,
        writer,
        images: [],
      });
    } catch {
      return ipcError('ENCODE_FAILED', ENCODE_FAILED);
    }
    if (!encoded.ok) {
      return ipcError('ENCODE_FAILED', ENCODE_FAILED);
    }
    return { ok: true, bytes: encoded.bytes };
  }

  return {
    async put(request) {
      await ensureDir();
      const known = await listRecoveryIds(deps.userDataDir);
      let recoveryId = request.recoveryId;
      if (recoveryId !== null && !known.has(recoveryId)) {
        return ipcError('PATH_NOT_ALLOWED', MISSING_MESSAGE);
      }
      if (recoveryId === null) {
        recoveryId = newRecoveryId(known);
      }
      const paths = recoveryRecordPaths(deps.userDataDir, recoveryId);
      if (paths === null) {
        return ipcError('PATH_NOT_ALLOWED', MISSING_MESSAGE);
      }

      let createdMs = Date.now();
      let existing: RecoveryMetadata | null = null;
      try {
        const text = await readFile(paths.meta, 'utf8');
        existing = parseRecoveryMetadata(text);
        if (existing !== null) {
          createdMs = existing.createdMs;
        }
      } catch {
        // A first write creates the metadata file.
      }

      const encoded = await encodeDocument(request.document);
      if (!('bytes' in encoded)) {
        return encoded;
      }

      const updatedMs = Date.now();
      const metadata: RecoveryMetadata = {
        version: 1,
        createdMs,
        updatedMs,
        firstLine: request.firstLine,
      };
      const metaBytes = Buffer.from(formatRecoveryMetadata(metadata), 'utf8');

      const obkWritten = await writeAtomic(paths.obk, encoded.bytes, {
        kind: 'record',
        privateAppData: deps.privateAppData ?? [],
      });
      if (obkWritten.status !== 'ok') {
        return writeError(obkWritten);
      }
      const metaWritten = await writeAtomic(paths.meta, metaBytes, {
        kind: 'record',
        privateAppData: deps.privateAppData ?? [],
      });
      if (metaWritten.status !== 'ok') {
        return writeError(metaWritten);
      }
      return { status: 'ok', recoveryId };
    },

    async list() {
      await ensureDir();
      const dir = recoveryDirectory(deps.userDataDir);
      let names: readonly string[];
      try {
        names = await readdir(dir);
      } catch {
        return { status: 'ok', entries: [] };
      }
      const entries: RecoverySummary[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) {
          continue;
        }
        const id = name.slice(0, -'.json'.length);
        if (!isRecoveryId(id)) {
          continue;
        }
        const metaPath = path.join(dir, name);
        let text: string;
        try {
          text = await readFile(metaPath, 'utf8');
        } catch {
          continue;
        }
        const meta = parseRecoveryMetadata(text);
        if (meta === null) {
          continue;
        }
        entries.push({
          id,
          firstLine: meta.firstLine,
          time: new Date(meta.updatedMs).toISOString(),
        });
      }
      entries.sort((left, right) => right.time.localeCompare(left.time));
      return { status: 'ok', entries };
    },

    async restore(request) {
      const paths = recoveryRecordPaths(deps.userDataDir, request.recoveryId);
      if (paths === null) {
        return { status: 'refused', reason: 'invalid', message: MISSING_MESSAGE };
      }

      let meta: RecoveryMetadata | null = null;
      try {
        meta = parseRecoveryMetadata(await readFile(paths.meta, 'utf8'));
      } catch {
        return refused(DAMAGED_MESSAGE);
      }
      if (meta === null) {
        return refused(DAMAGED_MESSAGE);
      }

      let decoded: DecodeResult;
      try {
        decoded = await deps.readObk(paths.obk);
      } catch {
        return refused(archiveMessage('unreadable'));
      }
      if (!decoded.ok) {
        const message = decoded.message.length > 0 ? decoded.message : DAMAGED_MESSAGE;
        return refused(message);
      }

      let stat: FileStat;
      try {
        const info = await readFile(paths.obk);
        stat = { size: info.byteLength, modifiedMs: meta.updatedMs };
      } catch {
        return refused(DAMAGED_MESSAGE);
      }

      return {
        status: 'ok',
        recoveryId: request.recoveryId,
        name: recoveredTitle(meta.firstLine),
        document: toDocumentMessage(decoded.document),
        stat,
      };
    },

    async drop(recoveryId) {
      const paths = recoveryRecordPaths(deps.userDataDir, recoveryId);
      if (paths === null) {
        return { status: 'notFound' };
      }
      let hadFile = false;
      try {
        await readFile(paths.meta);
        hadFile = true;
      } catch {
        // notFound when neither file exists
      }
      try {
        await readFile(paths.obk);
        hadFile = true;
      } catch {
        // notFound when neither file exists
      }
      if (!hadFile) {
        return { status: 'notFound' };
      }
      await removeRecord(deps.userDataDir, recoveryId);
      return { status: 'ok' };
    },
  };
}