const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupServer', {
  info: () => ipcRenderer.invoke('server-info'),
  stats: () => ipcRenderer.invoke('server-stats'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  moderate: (action, id) => ipcRenderer.invoke('server:moderate', { action, id }),
  unban: (clientId) => ipcRenderer.invoke('server:unban', clientId),
  control: (action) => ipcRenderer.invoke('server:control', action),
  settings: () => ipcRenderer.invoke('server:settings'),
  saveSettings: (settings) => ipcRenderer.invoke('server:save-settings', settings)
});
