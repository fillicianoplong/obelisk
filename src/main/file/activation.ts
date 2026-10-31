import type { BrowserWindow } from 'electron';
import { IPC_EVENT_CHANNEL } from '../../shared/ipc/channels.js';
import type { FileOpenResult } from '../../shared/ipc/types.js';
import type { FileService } from './service.js';

export async function openLaunchPaths(
  files: FileService,
  paths: readonly string[],
  notify: (result: FileOpenResult) => void,
): Promise<void> {
  for (const filePath of paths) {
    const result = await files.openPath(filePath);
    notify(result);
  }
}

export function sendFileActivated(window: BrowserWindow, result: FileOpenResult): void {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(IPC_EVENT_CHANNEL, result);
}
