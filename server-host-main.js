const { app, BrowserWindow, ipcMain, Tray, Menu, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { startSignalingServer, normalizeRoomLayout } = require('./signaling-server');
const { registerUpdateHandlers } = require('./update-helper');

// Estes argumentos permitem executar mais de um ServerHost no mesmo PC sem
// compartilharem porta, bans, configurações, plugins ou músicas. São úteis
// sobretudo para o pacote de teste de dois hosts.
const commandValue = (name) => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => String(arg).startsWith(prefix));
  return item ? String(item).slice(prefix.length) : '';
};
const executableDirectory = path.dirname(process.execPath);
const portableProfileName = path.basename(executableDirectory).toLowerCase();
const portableTestProfile = portableProfileName === 'serverhost-primario'
  ? { port: 3191, dataDirectory: path.join(executableDirectory, 'dados') }
  : portableProfileName === 'serverhost-secundario'
    ? { port: 3192, dataDirectory: path.join(executableDirectory, 'dados') }
    : null;
const portFromCommand = Number.parseInt(commandValue('voiceup-port'), 10);
const hostPort = Number.isInteger(portFromCommand) && portFromCommand >= 1024 && portFromCommand <= 65535
  ? portFromCommand
  : portableTestProfile?.port || 3000;
const dataDirectory = commandValue('voiceup-data-dir') || portableTestProfile?.dataDirectory || '';
if (dataDirectory) {
  try { app.setPath('userData', path.resolve(dataDirectory)); } catch { /* usa a pasta padrão se o argumento estiver inválido */ }
}

let signaling;
let mainWindow;
let tray;
let musicBotWindow;
let musicBotReady = false;
const pendingMusicCommands = [];
let isQuitting = false;
let closePromptOpen = false;
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
let pluginFolder = '';
let portablePluginFolder = '';
let musicFolder = '';
let pluginStateFile = '';
let hostSettings = { closeBehavior: 'tray', theme: 'ocean', rooms: [], cluster: { enabled: false, role: 'primary', primaryUrl: '', publicUrl: '', secret: '', nodeId: '', capacity: 100, weight: 1, failover: true, smartDistribution: true, heartbeatMs: 3000 } };

const settingsPath = () => path.join(app.getPath('userData'), 'server-settings.json');
function loadSettings() {
  try { hostSettings = { ...hostSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* first run */ }
  hostSettings.rooms = (Array.isArray(hostSettings.rooms) ? hostSettings.rooms : []).map((room) => normalizeRoomLayout(room)).filter((room) => room.id);
  hostSettings.cluster = { enabled: false, role: 'primary', primaryUrl: '', publicUrl: '', secret: '', nodeId: '', capacity: 100, weight: 1, failover: true, smartDistribution: true, heartbeatMs: 3000, ...(hostSettings.cluster || {}) };
  if (!hostSettings.cluster.nodeId) hostSettings.cluster.nodeId = `host-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!hostSettings.cluster.secret) hostSettings.cluster.secret = crypto.randomBytes(18).toString('hex');
  saveSettings();
}
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(hostSettings, null, 2), 'utf8'); } catch { /* optional preference */ } }
function addresses() { return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:${hostPort}`); }
function discordTemplateCode(value) {
  const input = String(value || '').trim();
  if (/^[a-z0-9_-]{2,80}$/i.test(input)) return input;
  const match = input.match(/(?:discord\.new|discord(?:app)?\.com\/(?:template|guild-template))\/([a-z0-9_-]+)/i);
  return match?.[1] || '';
}
function roomFromDiscordTemplate(payload = {}, fallback = {}) {
  const guild = payload.serialized_source_guild || payload.serializedSourceGuild || payload.guild || payload;
  const channels = Array.isArray(guild.channels) ? guild.channels : [];
  const categories = new Map(channels.filter((channel) => Number(channel.type) === 4).map((channel) => [String(channel.id || ''), String(channel.name || '').slice(0, 36)]));
  const channelCategory = (channel) => categories.get(String(channel.parent_id || channel.parentId || '')) || '';
  const voiceChannelSettings = channels.filter((channel) => [2, 13].includes(Number(channel.type))).map((channel, position) => ({
    id: channel.id,
    name: channel.name,
    position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : position,
    category: channelCategory(channel),
    userLimit: channel.user_limit ?? channel.userLimit ?? 0,
    bitrate: channel.bitrate,
    region: channel.rtc_region || 'auto'
  }));
  const textChannelSettings = channels.filter((channel) => [0, 5, 15].includes(Number(channel.type))).map((channel, position) => ({
    id: channel.id,
    name: channel.name,
    position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : position,
    category: channelCategory(channel),
    topic: channel.topic || '',
    slowModeSeconds: channel.rate_limit_per_user ?? channel.slowModeSeconds ?? 0,
    readOnly: false
  }));
  return normalizeRoomLayout({
    id: fallback.id || guild.id || payload.code || '',
    name: fallback.name || guild.name || payload.name || 'Modelo Discord',
    template: 'discord',
    voiceChannelSettings: voiceChannelSettings.length ? voiceChannelSettings : undefined,
    textChannelSettings: textChannelSettings.length ? textChannelSettings : undefined
  });
}
function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

async function sendMusicBotCommand(command) {
  if (!musicBotWindow || musicBotWindow.isDestroyed()) {
    musicBotReady = false;
    musicBotWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'music-bot-preload.js'), contextIsolation: true, nodeIntegration: false } });
    await musicBotWindow.loadFile(path.join(__dirname, 'host', 'music-bot.html'), { query: { port: String(hostPort) } });
    musicBotWindow.on('closed', () => { musicBotWindow = null; musicBotReady = false; });
  }
  if (!musicBotReady) { pendingMusicCommands.push(command); return; }
  musicBotWindow.webContents.send('music-bot:command', command);
}
async function startHostedSignaling() {
  if (signaling) return { ok: true, message: 'Servidor já está online.' };
  signaling = await startSignalingServer(hostPort, {
    pluginDirectories: [pluginFolder, portablePluginFolder, path.join(__dirname, 'plugins')],
    musicDirectory: musicFolder,
    pluginStateFile,
    bansFile: path.join(app.getPath('userData'), 'bans.json'),
    roomLayouts: hostSettings.rooms,
    cluster: hostSettings.cluster,
    onPluginEvent: (event) => { if (event?.event === 'music-bot') sendMusicBotCommand(event.payload).catch(() => {}); }
  });
  return { ok: true, message: `Servidor iniciado na porta ${hostPort}.` };
}
async function stopHostedSignaling() {
  if (!signaling) return { ok: true, message: 'Servidor já está desligado.' };
  const current = signaling; signaling = null;
  const migration = current.redirectClientsForShutdown?.();
  if (migration?.redirected > 0) await new Promise((resolve) => setTimeout(resolve, 650));
  current.closeFederation?.();
  current.io.close();
  await new Promise((resolve) => current.server.close(() => resolve()));
  if (musicBotWindow && !musicBotWindow.isDestroyed()) musicBotWindow.webContents.send('music-bot:command', { action: 'stop-all' });
  return { ok: true, message: migration?.redirected > 0 ? `Servidor desligado. ${migration.redirected} Client(s) foram enviados ao host alternativo.` : 'Servidor desligado. O painel permanece aberto.' };
}
async function restartHostedSignaling() { await stopHostedSignaling(); return startHostedSignaling(); }

async function openWindow() {
  loadSettings();
  pluginFolder = path.join(app.getPath('userData'), 'plugins');
  portablePluginFolder = path.join(path.dirname(process.execPath), 'plugins');
  musicFolder = path.join(app.getPath('userData'), 'music');
  pluginStateFile = path.join(app.getPath('userData'), 'plugin-settings.json');
  fs.mkdirSync(pluginFolder, { recursive: true }); fs.mkdirSync(musicFolder, { recursive: true });
  const bundledPluginFolder = path.join(__dirname, 'plugins');
  if (fs.existsSync(bundledPluginFolder)) for (const file of fs.readdirSync(bundledPluginFolder).filter((name) => name.endsWith('.js'))) {
    const destination = path.join(pluginFolder, file);
    if (!fs.existsSync(destination) || ['musica.js', 'dados.js', 'xp-chat.js'].includes(file)) fs.copyFileSync(path.join(bundledPluginFolder, file), destination);
  }
  const bundledMusicReadme = path.join(__dirname, 'music', 'README.md');
  if (fs.existsSync(bundledMusicReadme)) fs.copyFileSync(bundledMusicReadme, path.join(musicFolder, 'README.md'));
  await startHostedSignaling();
  mainWindow = new BrowserWindow({ width: 960, height: 800, minWidth: 680, minHeight: 600, title: 'VoiceUp Server', icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'), backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'host-preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (hostSettings.closeBehavior === 'quit') { event.preventDefault(); isQuitting = true; app.quit(); return; }
    event.preventDefault();
    if (hostSettings.closeBehavior === 'ask') {
      if (!closePromptOpen) {
        closePromptOpen = true;
        mainWindow.webContents.send('window:confirm-close', { app: 'server' });
      }
      return;
    }
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; closePromptOpen = false; });
  await mainWindow.loadFile(path.join(__dirname, 'host', 'index.html'));
  tray = new Tray(path.join(__dirname, 'assets', 'voiceup-icon.ico'));
  tray.setToolTip('VoiceUp Server - ativo');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: revealMainWindow },
    { label: 'Iniciar servidor', click: () => startHostedSignaling().catch(() => {}) },
    { label: 'Desligar servidor', click: () => stopHostedSignaling().catch(() => {}) },
    { type: 'separator' },
    { label: 'Encerrar programa', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', revealMainWindow);
}

ipcMain.handle('server-info', () => {
  const urls = addresses(); const host = urls[0] || `http://localhost:${hostPort}`;
  return { port: hostPort, urls, connectionCode: `VU1:${Buffer.from(JSON.stringify({ host })).toString('base64')}`, pluginFolder, portablePluginFolder, musicFolder, online: Boolean(signaling), version: app.getVersion() };
});
ipcMain.handle('server-stats', () => {
  const now = process.hrtime.bigint(); const usage = process.cpuUsage(lastCpu); const elapsedMicros = Number(now - lastCpuAt) / 1000;
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  const cpuPercent = elapsedMicros > 0 ? Math.min(100, Math.round(((usage.user + usage.system) / elapsedMicros) * 1000) / 10) : 0;
  const memory = process.memoryUsage();
  const memoryMb = Math.round(memory.rss / 1024 / 1024);
  signaling?.updateNodeMetrics?.({ cpuPercent, memoryMb, memoryPressure: os.totalmem() > 0 ? memory.rss / os.totalmem() : 0 });
  const stats = signaling?.getStats?.() || { uptimeSeconds: 0, participants: 0, rooms: 0, averagePing: null, events: { signals: 0 }, logs: [{ time: new Date().toLocaleTimeString('pt-BR'), level: 'info', message: 'Servidor desligado.' }], plugins: [], pluginErrors: [], members: [], bans: [] };
  return { ...stats, port: hostPort, online: Boolean(signaling), cpuPercent, memoryMb, heapMb: Math.round(memory.heapUsed / 1024 / 1024) };
});
ipcMain.handle('server:moderate', (_event, { action, id, durationMinutes, reason } = {}) => {
  if (!signaling) return { ok: false, message: 'O servidor está desligado.' };
  if (action === 'kick') return signaling.kick(id);
  if (action === 'ban') return signaling.ban(id, { durationMinutes, reason });
  return { ok: false, message: 'Ação inválida.' };
});
ipcMain.handle('server:unban', (_event, clientId) => signaling ? signaling.unban(clientId) : { ok: false, message: 'O servidor está desligado.' });
ipcMain.handle('server:control', async (_event, action) => {
  try {
    if (action === 'start') return await startHostedSignaling();
    if (action === 'stop') return await stopHostedSignaling();
    if (action === 'restart') return await restartHostedSignaling();
    if (action === 'reload-plugins') { await restartHostedSignaling(); return { ok: true, message: 'Plugins recarregados. As pessoas precisam entrar novamente na sala.' }; }
    return { ok: false, message: 'Ação inválida.' };
  } catch (error) { return { ok: false, message: error.message || 'Não foi possível alterar o servidor.' }; }
});
ipcMain.handle('server:settings', () => hostSettings);
ipcMain.handle('server:rooms', () => hostSettings.rooms);
ipcMain.handle('server:import-discord-template', async (_event, { source, roomId, roomName } = {}) => {
  try {
    const raw = String(source || '').trim(); if (!raw) return { ok: false, message: 'Cole um código, link ou JSON de modelo do Discord.' };
    let payload;
    if (raw.startsWith('{') || raw.startsWith('[')) payload = JSON.parse(raw);
    else {
      const code = discordTemplateCode(raw); if (!code) return { ok: false, message: 'Código ou link de modelo Discord inválido.' };
      const response = await fetch(`https://discord.com/api/v10/guilds/templates/${encodeURIComponent(code)}`, { headers: { 'user-agent': 'VoiceUP-ServerHost/1.1' } });
      if (!response.ok) return { ok: false, message: `O Discord respondeu ${response.status}. Verifique se o modelo é público.` };
      payload = await response.json();
    }
    const room = roomFromDiscordTemplate(payload, { id: String(roomId || '').trim(), name: String(roomName || '').trim() });
    if (!room.voiceChannels.length && !room.textChannels.length) return { ok: false, message: 'O modelo não contém canais compatíveis.' };
    return { ok: true, message: 'Modelo Discord convertido. Revise os canais antes de salvar.', room };
  } catch (error) { return { ok: false, message: error.message || 'Não foi possível importar o modelo.' }; }
});
ipcMain.handle('server:cluster-settings', () => hostSettings.cluster);
ipcMain.handle('server:save-cluster', async (_event, next = {}) => {
  const role = next.role === 'secondary' ? 'secondary' : 'primary';
  const enabled = next.enabled === true;
  const primaryUrl = String(next.primaryUrl || '').trim().replace(/\/$/, '').slice(0, 300);
  const publicUrl = String(next.publicUrl || '').trim().replace(/\/$/, '').slice(0, 300);
  const secret = String(next.secret || '').trim().slice(0, 128);
  const capacity = Math.min(5000, Math.max(2, Math.round(Number(next.capacity) || 100)));
  const weight = Math.min(10, Math.max(.1, Number(next.weight) || 1));
  const failover = next.failover !== false;
  const smartDistribution = next.smartDistribution !== false;
  if (enabled && secret.length < 12) return { ok: false, message: 'Use uma chave de pareamento com pelo menos 12 caracteres.' };
  if (enabled && role === 'secondary' && !/^https?:\/\//i.test(primaryUrl)) return { ok: false, message: 'Informe o endereço completo do host primário.' };
  if (enabled && publicUrl && !/^https?:\/\//i.test(publicUrl)) return { ok: false, message: 'O endereço público deste host deve começar com http:// ou https://.' };
  hostSettings.cluster = { ...hostSettings.cluster, enabled, role, primaryUrl, publicUrl, secret, capacity, weight, failover, smartDistribution };
  saveSettings();
  await restartHostedSignaling();
  return { ok: true, message: enabled ? `Cluster ${role === 'primary' ? 'primário' : 'secundário'} ativado.` : 'Cluster desativado.', cluster: hostSettings.cluster };
});
ipcMain.handle('server:save-room', (_event, next = {}) => {
  const room = normalizeRoomLayout(next);
  if (!room.id) return { ok: false, message: 'Informe um código válido para a sala.' };
  const previousId = String(next.previousId || room.id).toLowerCase();
  const duplicate = hostSettings.rooms.find((item) => item.id.toLowerCase() === room.id.toLowerCase() && item.id.toLowerCase() !== previousId);
  if (duplicate) return { ok: false, message: 'Já existe uma sala com esse código.' };
  const index = hostSettings.rooms.findIndex((item) => item.id.toLowerCase() === previousId);
  if (index >= 0) hostSettings.rooms[index] = room; else hostSettings.rooms.push(room);
  saveSettings();
  signaling?.updateRoomLayouts?.(hostSettings.rooms);
  return { ok: true, message: index >= 0 ? 'Sala atualizada.' : 'Sala criada.', rooms: hostSettings.rooms };
});
ipcMain.handle('server:delete-room', (_event, roomId) => {
  const id = String(roomId || '').toLowerCase();
  const before = hostSettings.rooms.length;
  hostSettings.rooms = hostSettings.rooms.filter((room) => room.id.toLowerCase() !== id);
  if (hostSettings.rooms.length === before) return { ok: false, message: 'Sala não encontrada.' };
  saveSettings();
  signaling?.updateRoomLayouts?.(hostSettings.rooms);
  return { ok: true, message: 'Sala removida. O código continua aceitando os canais padrão por compatibilidade.', rooms: hostSettings.rooms };
});
ipcMain.handle('server:save-settings', (_event, next = {}) => {
  const closeBehaviors = ['tray', 'ask', 'quit'];
  const themes = ['ocean', 'violet', 'forest', 'graphite'];
  hostSettings.closeBehavior = closeBehaviors.includes(next.closeBehavior) ? next.closeBehavior : hostSettings.closeBehavior;
  hostSettings.theme = themes.includes(next.theme) ? next.theme : hostSettings.theme;
  saveSettings();
  return hostSettings;
});
ipcMain.handle('window:close-choice', (_event, choice) => {
  if (!closePromptOpen) return false;
  closePromptOpen = false;
  if (choice === 'tray') { mainWindow?.hide(); return true; }
  if (choice === 'quit') { isQuitting = true; app.quit(); return true; }
  return true;
});
ipcMain.handle('server:configure-plugin', async (_event, { id, enabled, settings } = {}) => {
  if (!signaling?.configurePlugin) return { ok: false, message: 'O servidor está desligado.' };
  return signaling.configurePlugin(String(id || ''), { enabled, settings });
});
ipcMain.handle('server:plugin-action', async (_event, { id, action, payload } = {}) => {
  if (!signaling?.pluginAction) return { ok: false, message: 'O servidor está desligado.' };
  return signaling.pluginAction(String(id || ''), String(action || ''), payload || {});
});
ipcMain.handle('server:open-path', async (_event, target) => {
  const folder = ({ plugins: pluginFolder, music: musicFolder })[target];
  if (!folder) return { ok: false, message: 'Pasta inválida.' };
  const error = await shell.openPath(folder);
  return error ? { ok: false, message: error } : { ok: true };
});
ipcMain.handle('music-bot:read-track', (_event, fileName) => {
  const safeName = path.basename(String(fileName || ''));
  if (!/\.(mp3|ogg|wav|m4a|aac)$/i.test(safeName)) throw new Error('Formato de música inválido.');
  const file = path.join(musicFolder, safeName); if (!fs.existsSync(file)) throw new Error('Arquivo de música não encontrado.');
  return fs.readFileSync(file);
});
ipcMain.on('music-bot:ready', () => { musicBotReady = true; while (pendingMusicCommands.length) musicBotWindow?.webContents.send('music-bot:command', pendingMusicCommands.shift()); });
registerUpdateHandlers(ipcMain, 'VoiceUPServer Setup ');
app.whenReady().then(openWindow).catch((error) => { console.error(error); app.quit(); });
app.on('activate', revealMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (isQuitting || hostSettings.closeBehavior === 'quit')) app.quit(); });
app.on('before-quit', () => { musicBotWindow?.destroy(); signaling?.io.close(); signaling?.server.close(); });
