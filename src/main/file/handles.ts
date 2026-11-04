import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type { FileStat } from '../../shared/ipc/types.js';

// Handles are the only file identity the renderer sees. The path stays here.

export const PATH_NOT_ALLOWED_MESSAGE = 'That file is not one this window opened.';

export function pathNotAllowed(): IpcErrorResult {
  return ipcError('PATH_NOT_ALLOWED', PATH_NOT_ALLOWED_MESSAGE);
}

export interface IssuedFile {
  handle: string;
  filePath: string;
  name: string;
  stat: FileStat;
}

export interface HandleMap {
  issue(filePath: string, name: string, stat: FileStat): string;
  lookup(handle: string): IssuedFile | null;
  handleForPath(filePath: string): string | null;
  // Drops every handle that is not in the list. An unknown handle changes nothing.
  retain(handles: readonly string[]): boolean;
}

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function newHandle(used: Map<string, IssuedFile>): string {
  let handle = randomBytes(16).toString('hex');
  while (used.has(handle)) {
    handle = randomBytes(16).toString('hex');
  }
  return handle;
}

export function createHandleMap(): HandleMap {
  const byHandle = new Map<string, IssuedFile>();
  const byPath = new Map<string, string>();

  return {
    issue(filePath, name, stat) {
      const key = pathKey(filePath);
      const existing = byPath.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const handle = newHandle(byHandle);
      byHandle.set(handle, { handle, filePath, name, stat });
      byPath.set(key, handle);
      return handle;
    },
    lookup(handle) {
      return byHandle.get(handle) ?? null;
    },
    handleForPath(filePath) {
      return byPath.get(pathKey(filePath)) ?? null;
    },
    retain(handles) {
      for (const handle of handles) {
        if (!byHandle.has(handle)) {
          return false;
        }
      }
      const keep = new Set(handles);
      for (const [handle, issued] of byHandle) {
        if (keep.has(handle)) {
          continue;
        }
        byHandle.delete(handle);
        byPath.delete(pathKey(issued.filePath));
      }
      return true;
    },
  };
}
