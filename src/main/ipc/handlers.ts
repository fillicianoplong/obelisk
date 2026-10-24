import type { InvokeChannel } from '../../shared/ipc/channels.js';
import { ipcError, type IpcErrorResult } from '../../shared/ipc/errors.js';
import type { RequestMap, ResultMap } from '../../shared/ipc/types.js';

export type IpcHandler<C extends InvokeChannel> = (
  request: RequestMap[C],
) => ResultMap[C] | Promise<ResultMap[C]>;

export type IpcHandlerMap = { [C in InvokeChannel]: IpcHandler<C> };

function notReady(channel: InvokeChannel): IpcErrorResult {
  return ipcError('NOT_IMPLEMENTED', `${channel} is not available yet.`);
}

export function createStubHandlers(): IpcHandlerMap {
  return {
    'file:open': () => notReady('file:open'),
    'file:save': (_request) => notReady('file:save'),
    'file:saveAs': (_request) => notReady('file:saveAs'),
    'session:set': (_request) => notReady('session:set'),
    'export:run': (_request) => notReady('export:run'),
    'print:run': (_request) => notReady('print:run'),
    'prefs:get': (_request) => notReady('prefs:get'),
    'prefs:set': (_request) => notReady('prefs:set'),
    'sig:list': () => notReady('sig:list'),
    'sig:get': (_request) => notReady('sig:get'),
    'sig:save': (_request) => notReady('sig:save'),
    'sig:delete': (_request) => notReady('sig:delete'),
    'recovery:put': (_request) => notReady('recovery:put'),
    'recovery:list': () => notReady('recovery:list'),
    'recovery:restore': (_request) => notReady('recovery:restore'),
    'recovery:drop': (_request) => notReady('recovery:drop'),
    'link:open': (_request) => notReady('link:open'),
  };
}
