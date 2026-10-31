import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readInUtilityProcess } from '../codec/utility-host.js';
import { createFileService } from '../file/service.js';
import { pickOpenDialogOwner, type OpenDialogOptions } from '../file/openDialog.js';
import type { ReplacePromptOptions, SaveDialogOptions, SaveDialogResult } from '../file/saveDialog.js';
import { bindIpcHandlers, type IpcMainLike } from './bind.js';
import { createAppHandlers } from './handlers.js';
import { createIpcRegistry } from './registry.js';

function dialogOwner(): { window: BrowserWindow } | null {
  return pickOpenDialogOwner(
    BrowserWindow.getAllWindows().map((window) => ({
      destroyed: window.isDestroyed(),
      focused: window.isFocused(),
      window,
    })),
  );
}

async function showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }> {
  const owner = dialogOwner();
  const result = owner
    ? await dialog.showOpenDialog(owner.window, options)
    : await dialog.showOpenDialog(options);
  return { canceled: result.canceled, filePaths: result.filePaths };
}

async function showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult> {
  const owner = dialogOwner();
  const result = owner
    ? await dialog.showSaveDialog(owner.window, options)
    : await dialog.showSaveDialog(options);
  return { canceled: result.canceled, filePath: result.filePath };
}

async function confirmReplace(options: ReplacePromptOptions): Promise<boolean> {
  const owner = dialogOwner();
  const box = {
    type: 'warning' as const,
    title: options.title,
    message: options.message,
    buttons: [...options.buttons],
    cancelId: options.cancelId,
    defaultId: options.defaultId,
    noLink: true,
  };
  const result = owner
    ? await dialog.showMessageBox(owner.window, box)
    : await dialog.showMessageBox(box);
  return result.response === 0;
}

export function installIpc(ipc: IpcMainLike = wrapIpcMain()): ReturnType<typeof createFileService> {
  const files = createFileService({
    showOpenDialog,
    showSaveDialog,
    confirmReplace,
    readObk: (filePath) => readInUtilityProcess(filePath),
    documentsDirectory: () => app.getPath('documents'),
    writer: app.getVersion(),
    privateAppData: [app.getPath('userData')],
  });
  bindIpcHandlers(ipc, createIpcRegistry(createAppHandlers(files)));
  return files;
}

function wrapIpcMain(): IpcMainLike {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => listener(event, ...args));
    },
  };
}
