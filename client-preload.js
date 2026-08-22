const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupDesktop', {
  version: () => ipcRenderer.invoke('update:check'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  desktopSources: () => ipcRenderer.invoke('capture:sources'),
  selectDesktopSource: (selection) => ipcRenderer.invoke('capture:select', selection),
  processAudioCapability: () => ipcRenderer.invoke('capture:process-audio-capability'),
  startProcessAudio: (sourceId) => ipcRenderer.invoke('capture:process-audio-start', sourceId),
  stopProcessAudio: () => ipcRenderer.invoke('capture:process-audio-stop'),
  onProcessAudioData: (handler) => {
    ipcRenderer.removeAllListeners('capture:process-audio-data');
    ipcRenderer.on('capture:process-audio-data', (_event, data) => handler(data));
  },
  onProcessAudioState: (handler) => {
    ipcRenderer.removeAllListeners('capture:process-audio-state');
    ipcRenderer.on('capture:process-audio-state', (_event, state) => handler(state));
  },
  linkPreview: (url) => ipcRenderer.invoke('link:preview', url),
  setVideoFullscreen: (enabled) => ipcRenderer.invoke('window:set-video-fullscreen', enabled),
  windowSettings: () => ipcRenderer.invoke('window:settings'),
  saveWindowSettings: (settings) => ipcRenderer.invoke('window:save-settings', settings),
  configureShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:configure', shortcuts),
  clearShortcuts: () => ipcRenderer.invoke('shortcuts:clear'),
  startDirectRoom: (options) => ipcRenderer.invoke('direct-room:start', options),
  stopDirectRoom: () => ipcRenderer.invoke('direct-room:stop'),
  directRoomStatus: () => ipcRenderer.invoke('direct-room:status'),
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
