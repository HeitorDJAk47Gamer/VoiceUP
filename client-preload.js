const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupDesktop', {
  version: () => ipcRenderer.invoke('update:check'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  desktopSources: () => ipcRenderer.invoke('capture:sources'),
  selectDesktopSource: (selection) => ipcRenderer.invoke('capture:select', selection),
  setVideoFullscreen: (enabled) => ipcRenderer.invoke('window:set-video-fullscreen', enabled),
  windowSettings: () => ipcRenderer.invoke('window:settings'),
  saveWindowSettings: (settings) => ipcRenderer.invoke('window:save-settings', settings)
});
