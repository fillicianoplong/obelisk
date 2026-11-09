import path from 'node:path';
import { stat } from 'node:fs/promises';
import { archiveMessage } from '../codec/archive/result.js';
import { encodeObk } from '../codec/encode/index.js';
import type { DecodeResult } from '../codec/decode.js';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type {
  DocumentMessage,
  FileOpenResult,
  FileSaveAsRequest,
  FileSaveAsResult,
  FileSaveRequest,
  FileSaveResult,
  FileStat,
  SessionSetResult,
} from '../../shared/ipc/types.js';
import { FORMAT_NAME, FORMAT_VERSION } from '../../shared/schema/index.js';
import type { Document } from '../../shared/schema/index.js';
import { createHandleMap, pathNotAllowed, type HandleMap, type IssuedFile } from './handles.js';
import { openDialogOptions, type OpenDialogOptions } from './openDialog.js';
import {
  ensureObkName,
  replacePromptOptions,
  saveDialogOptions,
  UNTITLED_FILE_NAME,
  type ReplacePromptOptions,
  type SaveDialogOptions,
  type SaveDialogResult,
} from './saveDialog.js';
import { defaultDocumentDirectory, writeAtomic, type WriteAtomicOptions } from './writeAtomic.js';

// Opening reads a file the user picked. Saving writes only through writeAtomic,
// and only after the stat check and, for a new name, the replace prompt.

const FILE_NAME_MAX = 255;

const ENCODE_FAILED_MESSAGE = 'This document is not valid, so it was not saved.';
const SAVE_DIALOG_FAILED_MESSAGE = 'The Save dialog could not be shown.';
const REPLACE_PROMPT_FAILED_MESSAGE = 'The replace prompt could not be shown, so it was not saved.';
const NOT_A_FILE_MESSAGE = 'This path is not a file, so it was not saved.';
const ALREADY_OPEN_MESSAGE = 'That file is already open, so it was not saved.';
const DENIED_MESSAGE = 'The save was denied, so it was not saved.';
const NAME_MESSAGE = 'This file name cannot be shown, so it was not saved.';

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface FileServiceDeps {
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>;
  readObk(filePath: string): Promise<DecodeResult>;
  showSaveDialog?(options: SaveDialogOptions): Promise<SaveDialogResult>;
  confirmReplace?(options: ReplacePromptOptions): Promise<boolean>;
  documentsDirectory?(): string;
  writer?: string;
  platform?: NodeJS.Platform;
  privateAppData?: readonly string[];
  atomic?: WriteAtomicOptions;
}

export interface FileService {
  openFromDialog(): Promise<FileOpenResult>;
  openPath(filePath: string): Promise<FileOpenResult>;
  save(request: FileSaveRequest): Promise<FileSaveResult>;
  saveAs(request: FileSaveAsRequest): Promise<FileSaveAsResult>;
  guardHandle(handle: string): IpcErrorResult | null;
  retainOpenHandles(handles: readonly string[]): SessionSetResult;
  handles: HandleMap;
}

type DiskFile =
  | { kind: 'missing' }
  | { kind: 'file'; stat: FileStat }
  | { kind: 'other' }
  | { kind: 'denied' };

type WriteGate = { status: 'ready' } | FileSaveResult;

function refused(reason: string, message: string): FileOpenResult {
  return { status: 'refused', reason, message };
}

function fileNameOf(filePath: string): string | null {
  const name = path.basename(filePath);
  if (name.length < 1 || name.length > FILE_NAME_MAX) {
    return null;
  }
  if (name.includes('/') || name.includes('\\')) {
    return null;
  }
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return null;
    }
  }
  return name;
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

function nodeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function sameStat(left: FileStat, right: FileStat): boolean {
  return left.size === right.size && left.modifiedMs === right.modifiedMs;
}

function savedStat(stat: FileStat, bytes: number): FileStat {
  const modifiedMs = Math.trunc(stat.modifiedMs);
  return {
    size: Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : bytes,
    modifiedMs: Number.isSafeInteger(modifiedMs) && modifiedMs >= 0 ? modifiedMs : 0,
  };
}

async function inspectFile(filePath: string): Promise<DiskFile> {
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (nodeCode(error) === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'denied' };
  }
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) {
    return { kind: 'other' };
  }
  const modifiedMs = Math.trunc(info.mtimeMs);
  if (!Number.isSafeInteger(modifiedMs) || modifiedMs < 0) {
    return { kind: 'other' };
  }
  return { kind: 'file', stat: { size: info.size, modifiedMs } };
}

async function prepareWrite(
  filePath: string,
  recorded: FileStat | null,
  expectedStat: FileStat | null,
  replaceConfirmed: boolean,
): Promise<WriteGate> {
  const disk = await inspectFile(filePath);
  if (disk.kind === 'denied') {
    return ipcError('EACCES', DENIED_MESSAGE);
  }
  if (disk.kind === 'other') {
    return ipcError('EACCES', NOT_A_FILE_MESSAGE);
  }
  if (disk.kind === 'missing') {
    return { status: 'ready' };
  }
  // Save compares the stat recorded at open or the last save (FR-13).
  if (recorded && !sameStat(disk.stat, recorded)) {
    if (expectedStat !== null && sameStat(disk.stat, expectedStat)) {
      return { status: 'ready' };
    }
    return { status: 'conflict', stat: disk.stat };
  }
  if (!recorded && !replaceConfirmed) {
    return { status: 'exists' };
  }
  return { status: 'ready' };
}

export function createFileService(deps: FileServiceDeps): FileService {
  const handles = createHandleMap();
  const platform = deps.platform ?? process.platform;
  const writer = deps.writer ?? '0.1.24.0';

  async function openPath(filePath: string): Promise<FileOpenResult> {
    // A relative path is not resolved against the working directory.
    if (!path.isAbsolute(filePath)) {
      return refused('not-a-file', archiveMessage('not-a-file'));
    }
    const openAlready = handles.handleForPath(filePath);
    if (openAlready !== null) {
      return { status: 'alreadyOpen', tabId: openAlready };
    }

    let decoded: DecodeResult;
    try {
      decoded = await deps.readObk(filePath);
    } catch {
      return refused('unreadable', archiveMessage('unreadable'));
    }
    if (!decoded.ok) {
      const message = decoded.message.length > 0 ? decoded.message : archiveMessage('unreadable');
      return refused(decoded.reason, message);
    }

    const name = fileNameOf(filePath);
    if (name === null) {
      return refused('invalid', 'This file name cannot be shown, so it was not opened.');
    }
    const inspected = await inspectFile(filePath);
    if (inspected.kind !== 'file') {
      return refused('unreadable', archiveMessage('unreadable'));
    }

    const again = handles.handleForPath(filePath);
    if (again !== null) {
      return { status: 'alreadyOpen', tabId: again };
    }
    const handle = handles.issue(filePath, name, inspected.stat);
    return {
      status: 'ok',
      handle,
      name,
      document: toDocumentMessage(decoded.document),
      stat: inspected.stat,
    };
  }

  function defaultSavePath(previous: IssuedFile | null): string | undefined {
    if (previous) {
      return previous.filePath;
    }
    let documents: string;
    try {
      documents = deps.documentsDirectory?.() ?? '';
    } catch {
      return undefined;
    }
    if (documents.length === 0) {
      return undefined;
    }
    const directory = defaultDocumentDirectory({
      documents,
      privateRoots: deps.privateAppData ?? [],
    });
    if (!directory.ok) {
      return undefined;
    }
    return path.join(directory.directory, UNTITLED_FILE_NAME);
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
      return ipcError('ENCODE_FAILED', ENCODE_FAILED_MESSAGE);
    }
    if (!encoded.ok) {
      return ipcError('ENCODE_FAILED', ENCODE_FAILED_MESSAGE);
    }
    return { ok: true, bytes: encoded.bytes };
  }

  async function commit(
    filePath: string,
    document: DocumentMessage,
    revision: number,
    recorded: FileStat | null,
    expectedStat: FileStat | null,
    replaceConfirmed: boolean,
  ): Promise<FileSaveResult> {
    const gate = await prepareWrite(filePath, recorded, expectedStat, replaceConfirmed);
    if (gate.status !== 'ready') {
      return gate;
    }
    const encoded = await encodeDocument(document);
    if (!('bytes' in encoded)) {
      return encoded;
    }
    const written = await writeAtomic(filePath, encoded.bytes, {
      ...deps.atomic,
      kind: 'document',
      privateAppData: deps.privateAppData ?? [],
    });
    if (written.status !== 'ok') {
      return written;
    }
    return {
      status: 'ok',
      stat: savedStat(written.stat, encoded.bytes.byteLength),
      revision,
    };
  }

  function finishSaveAs(
    previous: IssuedFile | null,
    filePath: string,
    name: string,
    stat: FileStat,
    revision: number,
  ): FileSaveAsResult {
    const sameFile = previous !== null && handles.handleForPath(filePath) === previous.handle;
    if (sameFile && previous) {
      handles.remember(previous.handle, stat);
      return { status: 'ok', handle: previous.handle, name, stat, revision };
    }
    if (previous) {
      handles.forget(previous.handle);
    }
    const handle = handles.issue(filePath, name, stat);
    return { status: 'ok', handle, name, stat, revision };
  }

  return {
    handles,
    openPath,
    async openFromDialog() {
      let picked: OpenDialogResult;
      try {
        picked = await deps.showOpenDialog(openDialogOptions());
      } catch {
        return refused('unreadable', 'The Open dialog could not be shown.');
      }
      if (picked.canceled || picked.filePaths.length === 0) {
        return { status: 'cancelled' };
      }
      const filePath = picked.filePaths[0];
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return { status: 'cancelled' };
      }
      return openPath(filePath);
    },
    async save(request) {
      const issued = handles.lookup(request.handle);
      if (issued === null) {
        return pathNotAllowed();
      }
      const written = await commit(
        issued.filePath,
        request.document,
        request.revision,
        issued.stat,
        request.expectedStat,
        request.replaceConfirmed,
      );
      if (written.status === 'ok') {
        handles.remember(request.handle, written.stat);
      }
      return written;
    },
    async saveAs(request) {
      const previous = request.handle === null ? null : handles.lookup(request.handle);
      if (request.handle !== null && previous === null) {
        return pathNotAllowed();
      }
      if (!deps.showSaveDialog) {
        return ipcError('EACCES', SAVE_DIALOG_FAILED_MESSAGE);
      }
      let picked: SaveDialogResult;
      try {
        picked = await deps.showSaveDialog(saveDialogOptions(defaultSavePath(previous)));
      } catch {
        return ipcError('EACCES', SAVE_DIALOG_FAILED_MESSAGE);
      }
      if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath.length === 0) {
        return { status: 'cancelled' };
      }
      if (!path.isAbsolute(picked.filePath)) {
        return pathNotAllowed();
      }
      const target = ensureObkName(picked.filePath);
      const name = fileNameOf(target);
      if (name === null) {
        return ipcError('EACCES', NAME_MESSAGE);
      }
      const owner = handles.handleForPath(target);
      if (owner !== null && owner !== previous?.handle) {
        return ipcError('EACCES', ALREADY_OPEN_MESSAGE);
      }
      const inspected = await inspectFile(target);
      if (inspected.kind === 'denied') {
        return ipcError('EACCES', DENIED_MESSAGE);
      }
      if (inspected.kind === 'other') {
        return ipcError('EACCES', NOT_A_FILE_MESSAGE);
      }
      let replaceConfirmed = false;
      if (inspected.kind === 'file') {
        // On Windows the dialog's replace prompt is the confirmation (spike S-05).
        // Another platform, or a name whose extension we had to add, asks here.
        const windowsConfirmed = platform === 'win32' && target === picked.filePath;
        if (windowsConfirmed) {
          replaceConfirmed = true;
        } else if (!deps.confirmReplace) {
          return ipcError('EACCES', REPLACE_PROMPT_FAILED_MESSAGE);
        } else {
          let replace: boolean;
          try {
            replace = await deps.confirmReplace(replacePromptOptions());
          } catch {
            return ipcError('EACCES', REPLACE_PROMPT_FAILED_MESSAGE);
          }
          if (!replace) {
            return { status: 'cancelled' };
          }
          replaceConfirmed = true;
        }
      }
      const written = await commit(target, request.document, request.revision, null, null, replaceConfirmed);
      if (written.status !== 'ok') {
        return written;
      }
      return finishSaveAs(previous, target, name, written.stat, written.revision);
    },
    guardHandle(handle) {
      if (handles.lookup(handle) === null) {
        return pathNotAllowed();
      }
      return null;
    },
    retainOpenHandles(openHandles) {
      if (!handles.retain(openHandles)) {
        return pathNotAllowed();
      }
      return { status: 'ok' };
    },
  };
}
