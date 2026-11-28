import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { SpellHost } from '../spell/utility-host.js';
import { readInUtilityProcess } from '../codec/utility-host.js';
import { createExportService } from '../export/service.js';
import { createFileService } from '../file/service.js';
import { pickOpenDialogOwner, type OpenDialogOptions } from '../file/openDialog.js';
import type { ReplacePromptOptions, SaveDialogOptions, SaveDialogResult } from '../file/saveDialog.js';
import { ipcError } from '../../shared/ipc/errors.js';
import { openAllowedLink } from '../security/links.js';
import { readClipboardItems } from '../clipboard/read.js';
import { createRecoveryService } from '../recoveryStore/service.js';
import { handlePrefsGet, handlePrefsSet, type PrefsHandlerOptions } from './prefs.js';
import { bindIpcHandlers, type IpcMainLike } from './bind.js';
import { createAppHandlers } from './handlers.js';
import { imageOpenDialogOptions, pickImageFile } from '../images/pick.js';
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

export function installIpc(
  ipc: IpcMainLike = wrapIpcMain(),
  prefsOptions?: Pick<PrefsHandlerOptions, 'onThemeChanged'>,
): ReturnType<typeof createFileService> {
  const files = createFileService({
    showOpenDialog,
    showSaveDialog,
    confirmReplace,
    readObk: (filePath) => readInUtilityProcess(filePath),
    documentsDirectory: () => app.getPath('documents'),
    writer: app.getVersion(),
    privateAppData: [app.getPath('userData')],
  });
  const userDataPath = app.getPath('userData');
  const exports = createExportService({
    showExportDialog: showSaveDialog,
    confirmReplace,
    lookupHandle: (handle) => files.handles.lookup(handle),
    documentsDirectory: () => app.getPath('documents'),
    privateAppData: [userDataPath],
    platform: process.platform,
  });
  const registry = createIpcRegistry(createAppHandlers(files, exports));
  const userData = () => app.getPath('userData');
  const recovery = createRecoveryService({
    userData,
    writer: app.getVersion(),
    readObk: (filePath) => readInUtilityProcess(filePath),
    privateAppData: [userData()],
  });
  const spell = new SpellHost(userData, () => app.getAppPath());
  registry.setHandler('spell:add', async (request) => {
    try {
      await spell.add(request.word);
      return { status: 'ok' };
    } catch {
      return ipcError('NOT_IMPLEMENTED', 'The spelling dictionary is not available.');
    }
  });
  registry.setHandler('spell:check', async (request) => {
    try {
      const misspelled = await spell.check(request.words);
      return { status: 'ok', misspelled };
    } catch {
      return ipcError('NOT_IMPLEMENTED', 'The spelling dictionary is not available.');
    }
  });
  registry.setHandler('image:pick', async () => pickImageFile({
    pickPath: async () => showOpenDialog(imageOpenDialogOptions()),
  }));
  registry.setHandler('recovery:put', (request) => recovery.put(request));
  registry.setHandler('recovery:list', () => recovery.list());
  registry.setHandler('recovery:restore', (request) => recovery.restore(request));
  registry.setHandler('recovery:drop', (request) => recovery.drop(request));
  registry.setHandler('clipboard:read', async () => {
    try {
      const [plain, items, native] = await Promise.all([
        clipboard.readText().catch(() => ''),
        clipboard.read().catch(() => []),
        Promise.resolve().then(() => {
          const readBitmap = (clipboard as { readImage?: () => Electron.NativeImage }).readImage;
          if (typeof readBitmap !== 'function') {
            return null;
          }
          const image = readBitmap.call(clipboard);
          if (image.isEmpty()) {
            return null;
          }
          const png = image.toPNG();
          return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
        }).catch(() => null),
      ]);
      return { status: 'ok', ...(await readClipboardItems(items, plain, native)) };
    } catch {
      return ipcError('EACCES', 'The clipboard could not be read.');
    }
  });
  registry.setHandler('spell:suggest', async (request) => {
    try {
      const result = await spell.suggest(request.word);
      return { status: 'ok', misspelled: result.misspelled, suggestions: result.suggestions };
    } catch {
      return ipcError('NOT_IMPLEMENTED', 'The spelling dictionary is not available.');
    }
  });
  registry.setHandler('link:open', (request) => openAllowedLink(request.address, {
    openExternal: (href) => shell.openExternal(href),
  }));
  const prefs: PrefsHandlerOptions = {
    userData,
    onThemeChanged: prefsOptions?.onThemeChanged,
  };
  registry.setHandler('prefs:get', (request) => handlePrefsGet(request, prefs));
  registry.setHandler('prefs:set', (request) => handlePrefsSet(request, prefs));
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
