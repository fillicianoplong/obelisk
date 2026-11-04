import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readInUtilityProcess } from '../codec/utility-host.js';
import { createFileService } from '../file/service.js';
import { pickOpenDialogOwner, type OpenDialogOptions } from '../file/openDialog.js';
import { bindIpcHandlers, type IpcMainLike } from './bind.js';
import { createAppHandlers } from './handlers.js';
import { createIpcRegistry } from './registry.js';

async function showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }> {
  const owner = pickOpenDialogOwner(
    BrowserWindow.getAllWindows().map((window) => ({
      destroyed: window.isDestroyed(),
      focused: window.isFocused(),
      window,
    })),
  );
  const result = owner
    ? await dialog.showOpenDialog(owner.window, options)
    : await dialog.showOpenDialog(options);
  return { canceled: result.canceled, filePaths: result.filePaths };
}

export function installIpc(ipc: IpcMainLike = wrapIpcMain()): void {
  const files = createFileService({
    showOpenDialog,
    readObk: (filePath) => readInUtilityProcess(filePath),
  });
  bindIpcHandlers(ipc, createIpcRegistry(createAppHandlers(files)));
}

function wrapIpcMain(): IpcMainLike {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => listener(event, ...args));
    },
  };
}
