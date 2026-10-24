import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { bindIpcHandlers, type IpcMainLike } from './bind.js';
import { createIpcRegistry } from './registry.js';

export function installIpc(ipc: IpcMainLike = wrapIpcMain()): void {
  bindIpcHandlers(ipc, createIpcRegistry());
}

function wrapIpcMain(): IpcMainLike {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => listener(event, ...args));
    },
  };
}
