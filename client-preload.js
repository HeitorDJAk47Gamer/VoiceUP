const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupDesktop', {
  version: () => ipcRenderer.invoke('update:check'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  desktopSources: () => ipcRenderer.invoke('capture:sources'),
  selectDesktopSource: (selection) => ipcRenderer.invoke('capture:select', selection),
  setVideoFullscreen: (enabled) => ipcRenderer.invoke('window:set-video-fullscreen', enabled)
});
