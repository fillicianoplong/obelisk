import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('s07', {
  getState: () => ipcRenderer.invoke('s07:get-state'),
  close: () => ipcRenderer.invoke('s07:close'),
});
