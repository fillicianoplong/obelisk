import { contextBridge, ipcRenderer } from 'electron';
import { exposeObeliskApi } from './bridge.js';
import { installThemeBridge } from './theme.js';
import { installViewBridge } from './view.js';
import { installZoomBridge } from './zoom.js';

declare function require(moduleName: string): unknown;

interface PreloadProcess {
  sandboxed?: boolean;
  contextIsolated?: boolean;
}

function nodeFileSystemAvailable(): boolean {
  try {
    require('fs');
    return true;
  } catch {
    return false;
  }
}

exposeObeliskApi(contextBridge, ipcRenderer);

const themeRoot = (globalThis as { document?: { documentElement?: { dataset: { theme?: string } } | null } }).document
  ?.documentElement;
installThemeBridge(contextBridge, ipcRenderer, process.argv, themeRoot ?? null);
installZoomBridge(contextBridge, process.argv);
installViewBridge(contextBridge, process.argv);

const preloadProcess = process as NodeJS.Process & PreloadProcess;

console.info(
  `OBELISK_PRELOAD ${JSON.stringify({
    sandboxed: preloadProcess.sandboxed === true,
    contextIsolated: preloadProcess.contextIsolated === true,
    nodeRequireFs: nodeFileSystemAvailable(),
  })}`,
);
