import type { ObeliskApi } from '../shared/ipc/api.js';
import { IPC_EVENT_CHANNEL } from '../shared/ipc/channels.js';
import type {
  ExportRunResult,
  FileOpenResult,
  FileSaveAsResult,
  FileSaveResult,
  LinkOpenResult,
  PrefsGetResult,
  PrefsSetResult,
  PrintRunResult,
  RecoveryDropResult,
  RecoveryListResult,
  RecoveryPutResult,
  RecoveryRestoreResult,
  SessionSetResult,
  SigDeleteResult,
  SigGetResult,
  SigListResult,
  SigSaveResult,
} from '../shared/ipc/types.js';
import { parseFileOpenResult } from '../shared/ipc/validate.js';

export const OBELISK_BRIDGE_KEY = 'obelisk';

export interface PreloadIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export interface ContextBridgeLike {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

type ActivatedListener = (event: unknown, payload: unknown) => void;

function createFileActivatedApi(ipc: PreloadIpc): ObeliskApi['file:activated'] {
  let nextId = 1;
  const wrappedById = new Map<number, ActivatedListener>();

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('The file:activated listener must be a function.');
      }
      const id = nextId;
      nextId += 1;
      const wrapped: ActivatedListener = (_event, payload) => {
        const parsed = parseFileOpenResult(payload);
        if (parsed === null) {
          return;
        }
        listener(parsed);
      };
      wrappedById.set(id, wrapped);
      ipc.on(IPC_EVENT_CHANNEL, wrapped);
      return id;
    },
    unsubscribe(id) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        return;
      }
      const wrapped = wrappedById.get(id);
      if (wrapped === undefined) {
        return;
      }
      wrappedById.delete(id);
      ipc.removeListener(IPC_EVENT_CHANNEL, wrapped);
    },
  };
}

export function createObeliskApi(ipc: PreloadIpc): ObeliskApi {
  return {
    'file:open': () => ipc.invoke('file:open') as Promise<FileOpenResult>,
    'file:save': (request) => ipc.invoke('file:save', request) as Promise<FileSaveResult>,
    'file:saveAs': (request) => ipc.invoke('file:saveAs', request) as Promise<FileSaveAsResult>,
    'session:set': (request) => ipc.invoke('session:set', request) as Promise<SessionSetResult>,
    'export:run': (request) => ipc.invoke('export:run', request) as Promise<ExportRunResult>,
    'print:run': (request) => ipc.invoke('print:run', request) as Promise<PrintRunResult>,
    'prefs:get': (request) => ipc.invoke('prefs:get', request) as Promise<PrefsGetResult>,
    'prefs:set': (request) => ipc.invoke('prefs:set', request) as Promise<PrefsSetResult>,
    'sig:list': () => ipc.invoke('sig:list') as Promise<SigListResult>,
    'sig:get': (request) => ipc.invoke('sig:get', request) as Promise<SigGetResult>,
    'sig:save': (request) => ipc.invoke('sig:save', request) as Promise<SigSaveResult>,
    'sig:delete': (request) => ipc.invoke('sig:delete', request) as Promise<SigDeleteResult>,
    'recovery:put': (request) => ipc.invoke('recovery:put', request) as Promise<RecoveryPutResult>,
    'recovery:list': () => ipc.invoke('recovery:list') as Promise<RecoveryListResult>,
    'recovery:restore': (request) => ipc.invoke('recovery:restore', request) as Promise<RecoveryRestoreResult>,
    'recovery:drop': (request) => ipc.invoke('recovery:drop', request) as Promise<RecoveryDropResult>,
    'link:open': (request) => ipc.invoke('link:open', request) as Promise<LinkOpenResult>,
    'file:activated': createFileActivatedApi(ipc),
  };
}

export function exposeObeliskApi(bridge: ContextBridgeLike, ipc: PreloadIpc): void {
  bridge.exposeInMainWorld(OBELISK_BRIDGE_KEY, createObeliskApi(ipc));
}
