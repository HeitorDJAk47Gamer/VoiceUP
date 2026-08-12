const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupDesktop', {
  version: () => ipcRenderer.invoke('update:check'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download')
});
