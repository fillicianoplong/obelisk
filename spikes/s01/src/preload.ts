import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('s01', {
  getState: () => ipcRenderer.invoke('s01:get-state'),
  useDesktop: () => ipcRenderer.invoke('s01:use-desktop'),
  pickFolder: () => ipcRenderer.invoke('s01:pick-folder'),
  close: () => ipcRenderer.invoke('s01:close'),
});
