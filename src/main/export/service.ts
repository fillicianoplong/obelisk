import path from 'node:path';
import { stat } from 'node:fs/promises';
import { ipcError, ipcTimeout, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type { ExportRunRequest, ExportRunResult, FileStat } from '../../shared/ipc/types.js';
import type { IssuedFile } from '../file/handles.js';
import {
  replacePromptOptions,
  type ReplacePromptOptions,
  type SaveDialogResult,
} from '../file/saveDialog.js';
import { writeAtomic, type WriteAtomicOptions } from '../file/writeAtomic.js';
import {
  EXPORT_DENIED_MESSAGE,
  EXPORT_DIALOG_FAILED_MESSAGE,
  EXPORT_NAME_MESSAGE,
  EXPORT_NOT_A_FILE_MESSAGE,
  EXPORT_REPLACE_FAILED_MESSAGE,
  EXPORT_REPLACE_WITH_IMAGES_MESSAGE,
  EXPORT_TIMEOUT_MESSAGE,
  EXPORT_TIMEOUT_MS,
} from './constants.js';
import { writeExportCompanions } from './companion-write.js';
import { exportDialogOptions } from './dialog.js';
import { exportDocument } from './index.js';
import { markdownImagesFolderPath } from './markdown/folder.js';
import { defaultExportPath, ensureExportName, exportNameFromPath } from './path.js';

export interface ExportServiceDeps {
  showExportDialog(options: ReturnType<typeof exportDialogOptions>): Promise<SaveDialogResult>;
  confirmReplace?(options: ReplacePromptOptions): Promise<boolean>;
  lookupHandle(handle: string): IssuedFile | null;
  documentsDirectory?(): string;
  platform?: NodeJS.Platform;
  privateAppData?: readonly string[];
  atomic?: WriteAtomicOptions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  exportTimeoutMs?: number;
}

type DiskFile =
  | { kind: 'missing' }
  | { kind: 'file'; stat: FileStat }
  | { kind: 'other' }
  | { kind: 'denied' };

function nodeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
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

class ExportTimeout extends Error {
  constructor() {
    super('timeout');
    this.name = 'ExportTimeout';
  }
}

async function withExportDeadline<T>(work: Promise<T>, deadline: number, now: () => number): Promise<T> {
  const remaining = Math.max(0, deadline - now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExportTimeout()), remaining);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface ExportService {
  run(request: ExportRunRequest): Promise<ExportRunResult>;
}

export function createExportService(deps: ExportServiceDeps): ExportService {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const exportTimeoutMs = deps.exportTimeoutMs ?? EXPORT_TIMEOUT_MS;

  function sourcePath(handle: string | null): string | null {
    if (handle === null) {
      return null;
    }
    return deps.lookupHandle(handle)?.filePath ?? null;
  }

  function defaultPath(handle: string | null, format: ExportRunRequest['format']): string | undefined {
    let documents: string;
    try {
      documents = deps.documentsDirectory?.() ?? '';
    } catch {
      return undefined;
    }
    return defaultExportPath(
      sourcePath(handle),
      format,
      documents,
      deps.privateAppData ?? [],
    );
  }

  async function imagesFolderExists(mdPath: string): Promise<boolean> {
    try {
      const info = await stat(markdownImagesFolderPath(mdPath));
      return info.isDirectory();
    } catch {
      return false;
    }
  }

  async function confirmReplace(
    target: string,
    pickedPath: string,
    format: ExportRunRequest['format'],
  ): Promise<boolean | 'cancelled' | IpcErrorResult> {
    const windowsConfirmed = platform === 'win32' && target === pickedPath;
    if (windowsConfirmed) {
      return true;
    }
    if (!deps.confirmReplace) {
      return ipcError('EACCES', EXPORT_REPLACE_FAILED_MESSAGE);
    }
    try {
      const withImages = format === 'markdown' && await imagesFolderExists(target);
      const options = replacePromptOptions();
      const replace = await deps.confirmReplace({
        ...options,
        message: withImages ? EXPORT_REPLACE_WITH_IMAGES_MESSAGE : options.message,
      });
      if (!replace) {
        return 'cancelled';
      }
      return true;
    } catch {
      return ipcError('EACCES', EXPORT_REPLACE_FAILED_MESSAGE);
    }
  }

  return {
    async run(request): Promise<ExportRunResult> {
      if (!deps.showExportDialog) {
        return ipcError('EACCES', EXPORT_DIALOG_FAILED_MESSAGE);
      }
      let picked: SaveDialogResult;
      try {
        picked = await deps.showExportDialog(exportDialogOptions(request.format, defaultPath(request.handle, request.format)));
      } catch {
        return ipcError('EACCES', EXPORT_DIALOG_FAILED_MESSAGE);
      }
      if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath.length === 0) {
        return { status: 'cancelled' };
      }
      if (!path.isAbsolute(picked.filePath)) {
        return ipcError('PATH_NOT_ALLOWED', EXPORT_DENIED_MESSAGE);
      }

      const target = ensureExportName(picked.filePath, request.format);
      const name = exportNameFromPath(target);
      if (name === null) {
        return ipcError('EACCES', EXPORT_NAME_MESSAGE);
      }

      const inspected = await inspectFile(target);
      if (inspected.kind === 'denied') {
        return ipcError('EACCES', EXPORT_DENIED_MESSAGE);
      }
      if (inspected.kind === 'other') {
        return ipcError('EACCES', EXPORT_NOT_A_FILE_MESSAGE);
      }
      if (inspected.kind === 'file') {
        const confirmed = await confirmReplace(target, picked.filePath, request.format);
        if (confirmed === 'cancelled') {
          return { status: 'cancelled' };
        }
        if (typeof confirmed !== 'boolean') {
          return confirmed;
        }
      }

      const deadline = now() + exportTimeoutMs;
      let produced;
      try {
        produced = await withExportDeadline(
          exportDocument(request.format, request.document, request.assets, { filePath: target }),
          deadline,
          now,
        );
      } catch (error) {
        if (error instanceof ExportTimeout) {
          return ipcTimeout(EXPORT_TIMEOUT_MESSAGE);
        }
        return ipcError('EACCES', EXPORT_DENIED_MESSAGE);
      }

      const companions = produced.companions ?? [];
      if (companions.length > 0) {
        let folderWritten;
        try {
          folderWritten = await withExportDeadline(
            writeExportCompanions(target, companions, {
              ...deps.atomic,
              kind: 'record',
              privateAppData: deps.privateAppData ?? [],
              timeoutMs: Math.max(0, deadline - now()),
              now,
              sleep,
            }),
            deadline,
            now,
          );
        } catch (error) {
          if (error instanceof ExportTimeout) {
            return ipcTimeout(EXPORT_TIMEOUT_MESSAGE);
          }
          return ipcError('EACCES', EXPORT_DENIED_MESSAGE);
        }
        if (folderWritten.status !== 'ok') {
          return folderWritten;
        }
      }

      let written;
      try {
        written = await withExportDeadline(
          writeAtomic(target, produced.bytes, {
            ...deps.atomic,
            kind: 'record',
            privateAppData: deps.privateAppData ?? [],
            timeoutMs: Math.max(0, deadline - now()),
            now,
            sleep,
          }),
          deadline,
          now,
        );
      } catch (error) {
        if (error instanceof ExportTimeout) {
          return ipcTimeout(EXPORT_TIMEOUT_MESSAGE);
        }
        return ipcError('EACCES', EXPORT_DENIED_MESSAGE);
      }

      if (written.status !== 'ok') {
        return written;
      }
      return { status: 'ok', name, formulasAsImages: produced.formulasAsImages };
    },
  };
}