const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { startSignalingServer } = require('./signaling-server');
const { registerUpdateHandlers } = require('./update-helper');

let signaling;
let mainWindow;
let tray;
let musicBotWindow;
let musicBotReady = false;
const pendingMusicCommands = [];
let isQuitting = false;
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
let pluginFolder = '';
let portablePluginFolder = '';
let musicFolder = '';
let hostSettings = { closeBehavior: 'tray' };

const settingsPath = () => path.join(app.getPath('userData'), 'server-settings.json');
function loadSettings() { try { hostSettings = { ...hostSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* first run */ } }
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(hostSettings, null, 2), 'utf8'); } catch { /* optional preference */ } }
function addresses() { return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:3000`); }

async function sendMusicBotCommand(command) {
  if (!musicBotWindow || musicBotWindow.isDestroyed()) {
    musicBotReady = false;
    musicBotWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'music-bot-preload.js'), contextIsolation: true, nodeIntegration: false } });
    await musicBotWindow.loadFile(path.join(__dirname, 'host', 'music-bot.html'));
    musicBotWindow.on('closed', () => { musicBotWindow = null; musicBotReady = false; });
  }
  if (!musicBotReady) { pendingMusicCommands.push(command); return; }
  musicBotWindow.webContents.send('music-bot:command', command);
}
async function startHostedSignaling() {
  if (signaling) return { ok: true, message: 'Servidor já está online.' };
  signaling = await startSignalingServer(3000, {
    pluginDirectories: [pluginFolder, portablePluginFolder, path.join(__dirname, 'plugins')],
    musicDirectory: musicFolder,
    bansFile: path.join(app.getPath('userData'), 'bans.json'),
    onPluginEvent: (event) => { if (event?.event === 'music-bot') sendMusicBotCommand(event.payload).catch(() => {}); }
  });
  return { ok: true, message: 'Servidor iniciado na porta 3000.' };
}
async function stopHostedSignaling() {
  if (!signaling) return { ok: true, message: 'Servidor já está desligado.' };
  const current = signaling; signaling = null;
  current.io.close();
  await new Promise((resolve) => current.server.close(() => resolve()));
  musicBotWindow?.webContents.send('music-bot:command', { action: 'stop' });
  return { ok: true, message: 'Servidor desligado. O painel permanece aberto.' };
}
async function restartHostedSignaling() { await stopHostedSignaling(); return startHostedSignaling(); }

async function openWindow() {
  loadSettings();
  pluginFolder = path.join(app.getPath('userData'), 'plugins');
  portablePluginFolder = path.join(path.dirname(process.execPath), 'plugins');
  musicFolder = path.join(app.getPath('userData'), 'music');
  fs.mkdirSync(pluginFolder, { recursive: true }); fs.mkdirSync(musicFolder, { recursive: true });
  const bundledPluginFolder = path.join(__dirname, 'plugins');
  if (fs.existsSync(bundledPluginFolder)) for (const file of fs.readdirSync(bundledPluginFolder).filter((name) => name.endsWith('.js'))) {
    const destination = path.join(pluginFolder, file);
    if (!fs.existsSync(destination) || file === 'musica.js') fs.copyFileSync(path.join(bundledPluginFolder, file), destination);
  }
  const bundledMusicReadme = path.join(__dirname, 'music', 'README.md');
  if (fs.existsSync(bundledMusicReadme)) fs.copyFileSync(bundledMusicReadme, path.join(musicFolder, 'README.md'));
  await startHostedSignaling();
  mainWindow = new BrowserWindow({ width: 960, height: 800, minWidth: 680, minHeight: 600, title: 'VoiceUp Server', icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'), backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'host-preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', (event) => {
    if (isQuitting || hostSettings.closeBehavior === 'quit') return;
    event.preventDefault();
    if (hostSettings.closeBehavior === 'ask') {
      const choice = dialog.showMessageBoxSync(mainWindow, { type: 'question', title: 'VoiceUp Server', message: 'O que deseja fazer com o servidor?', detail: 'Manter ativo deixa o servidor funcionando na bandeja do Windows.', buttons: ['Manter ativo na bandeja', 'Encerrar programa', 'Cancelar'], defaultId: 0, cancelId: 2 });
      if (choice === 1) { isQuitting = true; app.quit(); } else if (choice === 0) mainWindow.hide();
      return;
    }
    mainWindow.hide();
  });
  await mainWindow.loadFile(path.join(__dirname, 'host', 'index.html'));
  tray = new Tray(path.join(__dirname, 'assets', 'voiceup-icon.ico'));
  tray.setToolTip('VoiceUp Server - ativo');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Iniciar servidor', click: () => startHostedSignaling().catch(() => {}) },
    { label: 'Desligar servidor', click: () => stopHostedSignaling().catch(() => {}) },
    { type: 'separator' },
    { label: 'Encerrar programa', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

ipcMain.handle('server-info', () => {
  const urls = addresses(); const host = urls[0] || 'http://localhost:3000';
  return { port: 3000, urls, connectionCode: `VU1:${Buffer.from(JSON.stringify({ host })).toString('base64')}`, pluginFolder, portablePluginFolder, musicFolder, online: Boolean(signaling) };
});
ipcMain.handle('server-stats', () => {
  const now = process.hrtime.bigint(); const usage = process.cpuUsage(lastCpu); const elapsedMicros = Number(now - lastCpuAt) / 1000;
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  const cpuPercent = elapsedMicros > 0 ? Math.min(100, Math.round(((usage.user + usage.system) / elapsedMicros) * 1000) / 10) : 0;
  const memory = process.memoryUsage();
  const stats = signaling?.getStats?.() || { uptimeSeconds: 0, participants: 0, rooms: 0, averagePing: null, events: { signals: 0 }, logs: [{ time: new Date().toLocaleTimeString('pt-BR'), level: 'info', message: 'Servidor desligado.' }], plugins: [], pluginErrors: [], members: [], bans: [] };
  return { ...stats, online: Boolean(signaling), cpuPercent, memoryMb: Math.round(memory.rss / 1024 / 1024), heapMb: Math.round(memory.heapUsed / 1024 / 1024) };
});
ipcMain.handle('server:moderate', (_event, { action, id } = {}) => {
  if (!signaling) return { ok: false, message: 'O servidor está desligado.' };
  if (action === 'kick') return signaling.kick(id);
  if (action === 'ban') return signaling.ban(id);
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
ipcMain.handle('server:save-settings', (_event, next = {}) => { const allowed = ['tray', 'ask', 'quit']; hostSettings.closeBehavior = allowed.includes(next.closeBehavior) ? next.closeBehavior : 'tray'; saveSettings(); return hostSettings; });
ipcMain.handle('music-bot:read-track', (_event, fileName) => {
  const safeName = path.basename(String(fileName || ''));
  if (!/\.(mp3|ogg|wav|m4a|aac)$/i.test(safeName)) throw new Error('Formato de música inválido.');
  const file = path.join(musicFolder, safeName); if (!fs.existsSync(file)) throw new Error('Arquivo de música não encontrado.');
  return fs.readFileSync(file);
});
ipcMain.on('music-bot:ready', () => { musicBotReady = true; while (pendingMusicCommands.length) musicBotWindow?.webContents.send('music-bot:command', pendingMusicCommands.shift()); });
registerUpdateHandlers(ipcMain, 'VoiceUPServer Setup ');
app.whenReady().then(openWindow).catch((error) => { console.error(error); app.quit(); });
app.on('activate', () => { mainWindow?.show(); });
app.on('before-quit', () => { musicBotWindow?.destroy(); signaling?.io.close(); signaling?.server.close(); });
