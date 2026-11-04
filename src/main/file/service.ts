import path from 'node:path';
import { stat } from 'node:fs/promises';
import { archiveMessage } from '../codec/archive/result.js';
import type { DecodeResult } from '../codec/decode.js';
import type { IpcErrorResult } from '../../shared/ipc/errors.js';
import type { DocumentMessage, FileOpenResult, FileStat, SessionSetResult } from '../../shared/ipc/types.js';
import type { Document } from '../../shared/schema/index.js';
import { createHandleMap, pathNotAllowed, type HandleMap } from './handles.js';
import { openDialogOptions, type OpenDialogOptions } from './openDialog.js';

// Opening reads a file the user picked. It does not write, rename, or replace it.

const FILE_NAME_MAX = 255;

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface FileServiceDeps {
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>;
  readObk(filePath: string): Promise<DecodeResult>;
}

export interface FileService {
  openFromDialog(): Promise<FileOpenResult>;
  openPath(filePath: string): Promise<FileOpenResult>;
  guardHandle(handle: string): IpcErrorResult | null;
  retainOpenHandles(handles: readonly string[]): SessionSetResult;
  handles: HandleMap;
}

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

async function readStat(filePath: string): Promise<FileStat | null> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return null;
  }
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) {
    return null;
  }
  const modifiedMs = Math.trunc(info.mtimeMs);
  if (!Number.isSafeInteger(modifiedMs) || modifiedMs < 0) {
    return null;
  }
  return { size: info.size, modifiedMs };
}

export function createFileService(deps: FileServiceDeps): FileService {
  const handles = createHandleMap();

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
    const fileStat = await readStat(filePath);
    if (fileStat === null) {
      return refused('unreadable', archiveMessage('unreadable'));
    }

    const again = handles.handleForPath(filePath);
    if (again !== null) {
      return { status: 'alreadyOpen', tabId: again };
    }
    const handle = handles.issue(filePath, name, fileStat);
    return {
      status: 'ok',
      handle,
      name,
      document: toDocumentMessage(decoded.document),
      stat: fileStat,
    };
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
