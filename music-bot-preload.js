const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupMusicBot', {
  readTrack: (fileName) => ipcRenderer.invoke('music-bot:read-track', fileName),
  onCommand: (handler) => ipcRenderer.on('music-bot:command', (_event, command) => handler(command)),
  ready: () => ipcRenderer.send('music-bot:ready')
});
