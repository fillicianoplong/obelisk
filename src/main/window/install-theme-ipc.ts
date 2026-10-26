import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ThemeSetting } from '../../shared/theme.js';
import { THEME_GET_CHANNEL } from '../../shared/theme.js';
import { frameUrlFromEvent, type IpcMainLike } from '../ipc/bind.js';
import { dispatchThemeGet } from './theme-ipc.js';

export function installThemeIpc(getTheme: () => ThemeSetting, ipc: IpcMainLike = wrapIpcMain()): void {
  ipc.handle(THEME_GET_CHANNEL, (event, ...args) => {
    return dispatchThemeGet(
      {
        senderUrl: frameUrlFromEvent(event),
        channel: THEME_GET_CHANNEL,
        args,
      },
      getTheme(),
    );
  });
}

function wrapIpcMain(): IpcMainLike {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => listener(event, ...args));
    },
  };
}
