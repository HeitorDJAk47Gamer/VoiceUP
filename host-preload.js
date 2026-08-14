const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupServer', {
  info: () => ipcRenderer.invoke('server-info'),
  stats: () => ipcRenderer.invoke('server-stats'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  moderate: (action, id) => ipcRenderer.invoke('server:moderate', { action, id }),
  unban: (clientId) => ipcRenderer.invoke('server:unban', clientId),
  control: (action) => ipcRenderer.invoke('server:control', action),
  openPath: (target) => ipcRenderer.invoke('server:open-path', target),
  settings: () => ipcRenderer.invoke('server:settings'),
  saveSettings: (settings) => ipcRenderer.invoke('server:save-settings', settings),
  rooms: () => ipcRenderer.invoke('server:rooms'),
  saveRoom: (room) => ipcRenderer.invoke('server:save-room', room),
  deleteRoom: (roomId) => ipcRenderer.invoke('server:delete-room', roomId),
  clusterSettings: () => ipcRenderer.invoke('server:cluster-settings'),
  saveCluster: (settings) => ipcRenderer.invoke('server:save-cluster', settings),
  onCloseRequest: (handler) => {
    ipcRenderer.removeAllListeners('window:confirm-close');
    ipcRenderer.on('window:confirm-close', (_event, details) => handler(details));
  },
  respondClose: (choice) => ipcRenderer.invoke('window:close-choice', choice)
  ,configurePlugin: (id, values) => ipcRenderer.invoke('server:configure-plugin', { id, ...values })
  ,pluginAction: (id, action, payload) => ipcRenderer.invoke('server:plugin-action', { id, action, payload })
});
