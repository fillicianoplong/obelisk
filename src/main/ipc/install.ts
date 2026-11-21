import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { readInUtilityProcess } from '../codec/utility-host.js';
import { createFileService } from '../file/service.js';
import { pickOpenDialogOwner, type OpenDialogOptions } from '../file/openDialog.js';
import type { ReplacePromptOptions, SaveDialogOptions, SaveDialogResult } from '../file/saveDialog.js';
import { ipcError } from '../../shared/ipc/errors.js';
import { installSpellChecker } from '../security/session.js';
import { readSpellingSetting, writeSpellingSetting } from '../settings.js';
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

function fileDialogsCancelled(): boolean {
  return process.env.OBELISK_CANCEL_FILE_DIALOGS === '1';
}

async function showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }> {
  if (fileDialogsCancelled()) {
    return { canceled: true, filePaths: [] };
  }
  const owner = dialogOwner();
  const result = owner
    ? await dialog.showOpenDialog(owner.window, options)
    : await dialog.showOpenDialog(options);
  return { canceled: result.canceled, filePaths: result.filePaths };
}

async function showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult> {
  if (fileDialogsCancelled()) {
    return { canceled: true, filePath: '' };
  }
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
  const registry = createIpcRegistry(createAppHandlers(files));
  const userData = () => app.getPath('userData');
  registry.setHandler('spell:add', (request) => {
    session.defaultSession.addWordToSpellCheckerDictionary(request.word);
    return { status: 'ok' };
  });
  registry.setHandler('prefs:get', (request) => {
    if (request.key !== 'spelling') {
      return ipcError('NOT_IMPLEMENTED', 'prefs:get is not available yet.');
    }
    return { status: 'ok', key: 'spelling', value: readSpellingSetting(userData()) };
  });
  registry.setHandler('prefs:set', (request) => {
    if (request.key !== 'spelling') {
      return ipcError('NOT_IMPLEMENTED', 'prefs:set is not available yet.');
    }
    writeSpellingSetting(userData(), request.value);
    installSpellChecker(session.defaultSession, request.value);
    return { status: 'ok' };
  });
  bindIpcHandlers(ipc, registry);
  return files;
}

function wrapIpcMain(): IpcMainLike {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => listener(event, ...args));
    },
  };
}
