import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('s02', {
  getState: () => ipcRenderer.invoke('s02:get-state'),
});
