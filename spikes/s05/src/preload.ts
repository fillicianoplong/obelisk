import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('s05', {
  getState: () => ipcRenderer.invoke('s05:get-state'),
  openDialog: () => ipcRenderer.invoke('s05:open-dialog'),
  record: (body: unknown) => ipcRenderer.invoke('s05:record', body),
  close: () => ipcRenderer.invoke('s05:close'),
});
