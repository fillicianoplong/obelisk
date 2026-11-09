import { APP_PAGE_URL } from '../../shared/app-page.js';
import type { DocumentMessage } from '../../shared/ipc/types.js';
import { createAppHandlers } from '../ipc/handlers.js';
import { createIpcRegistry } from '../ipc/registry.js';
import { createFileService } from './service.js';

// H-30. A renderer call that names a handle main did not issue. Nothing is read or written.

export interface UnissuedCall {
  channel: string;
  handle: string;
}

export interface UnissuedCheck {
  ok: false;
  reason: string;
  path: string;
}

function emptyDocument(): DocumentMessage {
  return {
    view: 'pageless',
    page: {},
    header: {},
    footer: {},
    blocks: [],
  };
}

function saveArgs(handle: string): unknown[] {
  return [{
    handle,
    document: emptyDocument(),
    revision: 1,
    expectedStat: null,
    replaceConfirmed: false,
  }];
}

export async function checkUnissuedHandle(call: UnissuedCall): Promise<UnissuedCheck> {
  const files = createFileService({
    showOpenDialog() {
      throw new Error('The Open dialog ran for a handle main did not issue.');
    },
    showSaveDialog() {
      throw new Error('The Save dialog ran for a handle main did not issue.');
    },
    confirmReplace() {
      throw new Error('The replace prompt ran for a handle main did not issue.');
    },
    readObk() {
      throw new Error('A file was read for a handle main did not issue.');
    },
    atomic: {
      fs: {
        open() {
          throw new Error('A file was written for a handle main did not issue.');
        },
        rename() {
          throw new Error('A file was renamed for a handle main did not issue.');
        },
        unlink() {
          throw new Error('A file was removed for a handle main did not issue.');
        },
        stat() {
          throw new Error('A file was stat-ed for a handle main did not issue.');
        },
        readdir() {
          throw new Error('A folder was listed for a handle main did not issue.');
        },
      },
    },
  });
  const registry = createIpcRegistry(createAppHandlers(files));
  const result = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: call.channel,
    args: call.channel === 'file:save' ? saveArgs(call.handle) : [],
  });
  const reason = result.status === 'error' ? result.code : result.status;
  return { ok: false, reason, path: '' };
}
