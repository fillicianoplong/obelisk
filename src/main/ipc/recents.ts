import type { FileOpenResult, RecentsListResult, RecentsOpenRequest, RecentsOpenResult } from '../../shared/ipc/types.js';
import type { FileService } from '../file/service.js';
import type { RecentsStore } from '../recents/store.js';

export function handleRecentsList(store: RecentsStore): RecentsListResult {
  return { status: 'ok', entries: store.listForRenderer() };
}

export async function handleRecentsOpen(
  request: RecentsOpenRequest,
  store: RecentsStore,
  files: FileService,
): Promise<RecentsOpenResult> {
  const filePath = store.pathForId(request.id);
  if (filePath === null) {
    return { status: 'notFound' };
  }
  const opened: FileOpenResult = await files.openPath(filePath);
  if (opened.status === 'ok') {
    store.touch(filePath, opened.name);
  }
  return opened;
}