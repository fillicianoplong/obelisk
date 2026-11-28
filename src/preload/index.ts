import { contextBridge, ipcRenderer } from 'electron';
import { exposeObeliskApi } from './bridge.js';
import { installReducedMotion } from './reduced-motion.js';
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

const doc = (globalThis as {
  document?: { documentElement?: { dataset: { theme?: string; reducedMotion?: string } } } | null;
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
  };
}).document;
installReducedMotion(
  doc?.documentElement && typeof globalThis.matchMedia === 'function'
    ? { documentElement: doc.documentElement, matchMedia: globalThis.matchMedia.bind(globalThis) }
    : null,
);
const themeRoot = doc?.documentElement ?? null;
installThemeBridge(contextBridge, ipcRenderer, process.argv, themeRoot);
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
