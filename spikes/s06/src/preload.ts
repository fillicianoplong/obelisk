import { contextBridge, ipcRenderer } from 'electron';

const proc = process as NodeJS.Process & {
  sandboxed?: boolean;
  type?: string;
  contextIsolated?: boolean;
};

contextBridge.exposeInMainWorld('spike', {
  preloadProbe() {
    return {
      sandboxed: proc.sandboxed === true,
      type: proc.type ?? '',
      contextIsolated: proc.contextIsolated === true,
      electron: proc.versions.electron ?? '',
      chrome: proc.versions.chrome ?? '',
      node: proc.versions.node ?? '',
    };
  },
  next(): Promise<unknown> {
    return ipcRenderer.invoke('spike:next');
  },
  result(payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke('spike:result', payload);
  },
  done(payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke('spike:done', payload);
  },
});
