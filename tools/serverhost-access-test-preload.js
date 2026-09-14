'use strict';

const { contextBridge } = require('electron');
let progressHandler = null;
const backupCalls = [];
const roleAssignmentCalls = [];
const permissionDefinitions = [
  { id: 'manageServer', label: 'Configurar servidor', description: 'Opções administrativas.' },
  { id: 'manageRoles', label: 'Gerenciar cargos', description: 'Criar e atribuir cargos.' },
  { id: 'manageChannels', label: 'Criar e editar canais', description: 'Gerenciar canais.' },
  { id: 'moveMembers', label: 'Mover pessoas entre calls', description: 'Mover pessoas.' },
  { id: 'moderateMembers', label: 'Expulsar, castigar e banir', description: 'Moderar pessoas.' },
  { id: 'manageMessages', label: 'Gerenciar mensagens', description: 'Moderar mensagens.' },
  { id: 'viewAuditLog', label: 'Consultar auditoria', description: 'Consultar registros.' }
];
const roles = [
  { id: 'admin', name: 'Administrador', color: '#ff7188', position: 100, protected: true, permissions: permissionDefinitions.map((item) => item.id) },
  { id: 'moderator', name: 'Moderador', color: '#a879ff', position: 50, protected: true, permissions: ['moveMembers', 'moderateMembers', 'manageMessages', 'viewAuditLog'] },
  { id: 'member', name: 'Membro', color: '#8792a8', position: 0, protected: true, permissions: [] }
];
const accessControl = { version: 1, roles, assignments: [{ clientId: 'protected-person', roleIds: ['moderator'], lastName: 'Pessoa', updatedAt: new Date().toISOString() }] };
const settings = { closeBehavior: 'ask', theme: 'forest', serverIcon: '', hardwareAcceleration: true, restartRequired: false, storage: { retentionDays: 30, maxPerRoom: 300 }, chatPolicy: { cooldownSeconds: 0, pluginMessageMaxLength: 2000 }, publicAccess: { automatic: false, consentVersion: 0 } };
const stats = () => ({
  online: true, port: 3000, uptimeSeconds: 80, participants: 1, rooms: 1, averagePing: 12,
  events: { signals: 2, joins: 1, messages: 0 }, bandwidth: { inboundKbps: 0, outboundKbps: 0 },
  logs: [{ time: '12:00:00', level: 'info', message: 'Servidor iniciado.' }], plugins: [], pluginErrors: [], reports: [], bans: [], chatPunishments: [],
  roomLayouts: [], storage: { totalBytes: 100, categories: {}, policy: settings.storage }, publicAccess: { status: 'disabled', mapped: false, message: 'Desativado.' },
  cluster: { enabled: false, state: 'desativado', nodes: [] }, webrtc: { connections: [], supportedClients: 0, unsupportedClients: 1 },
  accessControl, permissionDefinitions,
  securityAudit: [{ id: 'audit-host-1', at: new Date().toISOString(), action: 'member.roles.changed', outcome: 'allowed', actor: { name: 'ServerHost' }, target: { name: 'Pessoa' }, details: { roleIds: ['moderator'] } }],
  members: [{ id: 'socket-person', clientId: 'protected-person', name: 'Pessoa', color: '#56e2cf', avatar: '', room: 'equipe', voiceChannel: 'Geral', connectedSeconds: 35, identityVerified: true, remote: false, roleIds: ['moderator'], roles: [roles[1]], platform: 'windows', status: 'online', ping: 12 }]
});
contextBridge.exposeInMainWorld('voiceupServer', {
  info: async () => ({ version: '1.2.2-beta.27', port: 3000, urls: ['http://127.0.0.1:3000'], connectionCode: 'VU1:test', pluginFolder: 'plugins', musicFolder: 'music', online: true }),
  getInfo: async () => ({ version: '1.2.2-beta.27' }), getStats: async () => stats(), stats: async () => stats(), settings: async () => settings,
  rooms: async () => [], clusterSettings: async () => ({ enabled: false, role: 'primary', primaryUrl: '', publicUrl: '', secret: 'test-secret-value', nodeId: 'test-host', capacity: 100, weight: 1, failover: true, smartDistribution: true }),
  checkForUpdates: async () => ({ ok: true, available: false, installedVersion: '1.2.2-beta.27', version: '1.2.2-beta.27' }), downloadUpdate: async () => ({ ok: false }),
  onUpdateProgress: (handler) => { progressHandler = handler; }, onCloseRequest: () => {}, respondClose: async () => true,
  saveRole: async () => ({ ok: true, message: 'Cargo salvo.' }), deleteRole: async () => ({ ok: true, message: 'Cargo removido.' }), assignRoles: async (clientId, roleIds, name) => { roleAssignmentCalls.push({ clientId, roleIds, name }); const assignment = accessControl.assignments.find((entry) => entry.clientId === clientId); if (assignment) assignment.roleIds = [...roleIds]; return { ok: true, message: 'Cargos salvos.' }; }, clearSecurityAudit: async () => ({ ok: true, removed: 1 }),
  saveRoom: async () => ({ ok: true, rooms: [] }), deleteRoom: async () => ({ ok: true, rooms: [] }), importDiscordTemplate: async () => ({ ok: false, message: 'Indisponível no teste.' }),
  control: async () => ({ ok: true, message: 'OK' }), openPath: async () => ({ ok: true }), saveSettings: async () => settings, saveCluster: async () => ({ ok: true, message: 'OK' }), configurePlugin: async () => ({ ok: true }), pluginAction: async () => ({ ok: true }), moderate: async () => ({ ok: true }), unban: async () => ({ ok: true }), unpunish: async () => ({ ok: true }), cleanupMessages: async () => ({ ok: true, removed: 0 }), clearReports: async () => ({ ok: true, removed: 0 }), restartApplication: async () => true,
  backupStatus: async () => ({ ok: true }),
  createBackup: async (options) => { backupCalls.push({ action: 'create', options }); return { ok: true, fileName: 'teste.voiceup-backup', fileCount: 9, totalBytes: 4096, archiveBytes: 2048 }; },
  chooseBackup: async () => ({ ok: true, token: 'backup-token', fileName: 'amigos.voiceup-backup', createdAt: '2026-09-08T12:00:00.000Z', sourceVersion: '1.2.2-beta.27', fileCount: 10, totalBytes: 8192, pluginFileCount: 1, musicFileCount: 1, includes: { core: true, plugins: true, music: true, attachments: true } }),
  restoreBackup: async (token) => { backupCalls.push({ action: 'restore', token }); return { ok: true, restarting: true, message: 'Backup restaurado.' }; },
  openBackupFolder: async () => ({ ok: true })
});
contextBridge.exposeInMainWorld('voiceupHostUiTest', { emitProgress: (packet) => progressHandler?.(packet), backupCalls: () => JSON.parse(JSON.stringify(backupCalls)), roleAssignmentCalls: () => JSON.parse(JSON.stringify(roleAssignmentCalls)) });
