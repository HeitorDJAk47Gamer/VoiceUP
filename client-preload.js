const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupDesktop', {
  version: () => ipcRenderer.invoke('update:check'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  desktopSources: () => ipcRenderer.invoke('capture:sources'),
  selectDesktopSource: (selection) => ipcRenderer.invoke('capture:select', selection),
  linkPreview: (url) => ipcRenderer.invoke('link:preview', url),
  setVideoFullscreen: (enabled) => ipcRenderer.invoke('window:set-video-fullscreen', enabled),
  windowSettings: () => ipcRenderer.invoke('window:settings'),
  saveWindowSettings: (settings) => ipcRenderer.invoke('window:save-settings', settings),
  configureShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:configure', shortcuts),
  clearShortcuts: () => ipcRenderer.invoke('shortcuts:clear'),
  onShortcutAction: (handler) => {
    ipcRenderer.removeAllListeners('shortcut:action');
    ipcRenderer.on('shortcut:action', (_event, action) => handler(action));
  },
  onCloseRequest: (handler) => {
    ipcRenderer.removeAllListeners('window:confirm-close');
    ipcRenderer.on('window:confirm-close', (_event, details) => handler(details));
  },
  respondClose: (choice) => ipcRenderer.invoke('window:close-choice', choice)
});
