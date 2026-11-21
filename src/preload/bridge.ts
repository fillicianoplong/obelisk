import type { ObeliskApi, SpellLookupResult } from '../shared/ipc/api.js';
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
  SpellAddResult,
  SigDeleteResult,
  SigGetResult,
  SigListResult,
  SigSaveResult,
} from '../shared/ipc/types.js';
import type { SpellContextEvent } from '../shared/ipc/types.js';
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

export interface SpellWordChecker {
  isWordMisspelled(word: string): boolean;
  getWordSuggestions(word: string): string[];
}

const EMPTY_LOOKUP: SpellLookupResult = { misspelled: false, suggestions: [] };

function lookupSpelling(spell: SpellWordChecker | undefined, word: unknown): SpellLookupResult {
  if (typeof word !== 'string' || word.length < 1 || word.length > 64 || spell === undefined) {
    return EMPTY_LOOKUP;
  }
  try {
    if (spell.isWordMisspelled(word) !== true) {
      return EMPTY_LOOKUP;
    }
  } catch {
    return EMPTY_LOOKUP;
  }
  let listed: readonly unknown[] = [];
  try {
    const value = spell.getWordSuggestions(word);
    if (Array.isArray(value)) {
      listed = value;
    }
  } catch {
    listed = [];
  }
  const suggestions = listed
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64)
    .slice(0, 5);
  return { misspelled: true, suggestions };
}

type ActivatedListener = (result: FileOpenResult) => void;

function createFileActivatedApi(ipc: PreloadIpc): ObeliskApi['file:activated'] {
  let nextId = 1;
  const listenersById = new Map<number, ActivatedListener>();
  const pending: FileOpenResult[] = [];
  let hubInstalled = false;

  function dispatchPayload(payload: unknown): void {
    const parsed = parseFileOpenResult(payload);
    if (parsed === null) {
      return;
    }
    if (listenersById.size === 0) {
      pending.push(parsed);
      return;
    }
    for (const listener of listenersById.values()) {
      listener(parsed);
    }
  }

  function ensureHub(): void {
    if (hubInstalled) {
      return;
    }
    hubInstalled = true;
    ipc.on(IPC_EVENT_CHANNEL, (_event, payload) => {
      dispatchPayload(payload);
    });
  }

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('The file:activated listener must be a function.');
      }
      ensureHub();
      const id = nextId;
      nextId += 1;
      listenersById.set(id, listener);
      if (pending.length > 0) {
        const queued = pending.slice();
        pending.length = 0;
        for (const result of queued) {
          listener(result);
        }
      }
      return id;
    },
    unsubscribe(id) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        return;
      }
      listenersById.delete(id);
    },
  };
}

export function createObeliskApi(ipc: PreloadIpc, spell?: SpellWordChecker): ObeliskApi {
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
    'spell:add': (request) => ipc.invoke('spell:add', request) as Promise<SpellAddResult>,
    'file:activated': createFileActivatedApi(ipc),
    'spell:context': createSpellContextApi(ipc),
    'spell:lookup': (word) => lookupSpelling(spell, word),
  };
}

function parseSpellContext(payload: unknown): SpellContextEvent | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.misspelledWord !== 'string' || !Array.isArray(record.suggestions)) {
    return null;
  }
  const suggestions = record.suggestions.filter((item): item is string => typeof item === 'string');
  return { misspelledWord: record.misspelledWord, suggestions };
}

function createSpellContextApi(ipc: PreloadIpc): ObeliskApi['spell:context'] {
  let nextId = 1;
  const listenersById = new Map<number, (payload: SpellContextEvent) => void>();
  let hubInstalled = false;

  function ensureHub(): void {
    if (hubInstalled) {
      return;
    }
    hubInstalled = true;
    ipc.on('spell:context', (_event, payload) => {
      const parsed = parseSpellContext(payload);
      if (parsed === null) {
        return;
      }
      for (const listener of listenersById.values()) {
        listener(parsed);
      }
    });
  }

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('The spell:context listener must be a function.');
      }
      ensureHub();
      const id = nextId;
      nextId += 1;
      listenersById.set(id, listener);
      return id;
    },
    unsubscribe(id) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        return;
      }
      listenersById.delete(id);
    },
  };
}

export function exposeObeliskApi(bridge: ContextBridgeLike, ipc: PreloadIpc, spell?: SpellWordChecker): void {
  bridge.exposeInMainWorld(OBELISK_BRIDGE_KEY, createObeliskApi(ipc, spell));
}
