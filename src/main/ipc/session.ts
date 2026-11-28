import type { SessionSetRequest, SessionSetResult } from '../../shared/ipc/types.js';
import { ipcError } from '../../shared/ipc/errors.js';
import type { FileService } from '../file/service.js';
import { preferencesStore } from '../preferences/store.js';
import { sessionActivationOrder } from '../session/order.js';
import { sessionStore } from '../session/store.js';

export interface SessionHandlerOptions {
  userData: () => string;
  files: FileService;
}

function pathsFromHandles(files: FileService, handles: readonly string[], activeHandle: string | null): {
  paths: string[];
  activePath: string | null;
} {
  const paths: string[] = [];
  for (const handle of handles) {
    const issued = files.handles.lookup(handle);
    if (issued !== null) {
      paths.push(issued.filePath);
    }
  }
  let activePath: string | null = null;
  if (activeHandle !== null) {
    const issued = files.handles.lookup(activeHandle);
    if (issued !== null) {
      activePath = issued.filePath;
    }
  }
  return { paths, activePath };
}

export async function handleSessionSet(
  request: SessionSetRequest,
  options: SessionHandlerOptions,
  immediate = false,
): Promise<SessionSetResult> {
  const kept = options.files.retainOpenHandles(request.handles);
  if (kept.status !== 'ok') {
    return kept;
  }
  const userData = options.userData();
  const restore = preferencesStore(userData).getValue('restoreTabs') === true;
  const sessions = sessionStore(userData);
  if (!restore) {
    try {
      await sessions.clear();
    } catch {
      return ipcError('EBUSY_EXHAUSTED', 'The session could not be cleared.');
    }
    return { status: 'ok' };
  }
  const { paths, activePath } = pathsFromHandles(options.files, request.handles, request.activeHandle);
  sessions.scheduleUpdate({ paths, activePath });
  try {
    await sessions.queuePersist(immediate);
  } catch {
    return ipcError('EBUSY_EXHAUSTED', 'The session could not be saved.');
  }
  return { status: 'ok' };
}

export function sessionPathsForLaunch(userDataDir: string): readonly string[] {
  const restore = preferencesStore(userDataDir).getValue('restoreTabs') === true;
  if (!restore) {
    return [];
  }
  const sessions = sessionStore(userDataDir);
  const record = sessions.read();
  if (record.paths.length === 0) {
    return [];
  }
  return sessionActivationOrder(record.paths, record.activePath);
}