const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceupServer', {
  info: () => ipcRenderer.invoke('server-info'),
  stats: () => ipcRenderer.invoke('server-stats'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  updateRecovery: () => ipcRenderer.invoke('update:recovery'),
  onUpdateProgress: (handler) => {
    ipcRenderer.removeAllListeners('update:progress');
    ipcRenderer.on('update:progress', (_event, progress) => handler(progress));
  },
  moderate: (action, id, options = {}) => ipcRenderer.invoke('server:moderate', { action, id, ...options }),
  unban: (clientId) => ipcRenderer.invoke('server:unban', clientId),
  unpunish: (clientId) => ipcRenderer.invoke('server:unpunish', clientId),
  control: (action) => ipcRenderer.invoke('server:control', action),
  openPath: (target) => ipcRenderer.invoke('server:open-path', target),
  settings: () => ipcRenderer.invoke('server:settings'),
  saveSettings: (settings) => ipcRenderer.invoke('server:save-settings', settings),
  backupStatus: () => ipcRenderer.invoke('server:backup-status'),
  createBackup: (options) => ipcRenderer.invoke('server:create-backup', options),
  chooseBackup: () => ipcRenderer.invoke('server:choose-backup'),
  restoreBackup: (token) => ipcRenderer.invoke('server:restore-backup', token),
  openBackupFolder: () => ipcRenderer.invoke('server:open-backup-folder'),
  restartApplication: () => ipcRenderer.invoke('window:restart'),
  rooms: () => ipcRenderer.invoke('server:rooms'),
  saveRole: (role) => ipcRenderer.invoke('server:save-role', role),
  deleteRole: (roleId) => ipcRenderer.invoke('server:delete-role', roleId),
  assignRoles: (clientId, roleIds, name) => ipcRenderer.invoke('server:assign-roles', { clientId, roleIds, name }),
  clearSecurityAudit: () => ipcRenderer.invoke('server:clear-security-audit'),
  importDiscordTemplate: (source, roomId, roomName) => ipcRenderer.invoke('server:import-discord-template', { source, roomId, roomName }),
  saveRoom: (room) => ipcRenderer.invoke('server:save-room', room),
  deleteRoom: (roomId) => ipcRenderer.invoke('server:delete-room', roomId),
  cleanupMessages: (options) => ipcRenderer.invoke('server:cleanup-messages', options),
  clearReports: () => ipcRenderer.invoke('server:clear-reports'),
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
