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
let musicFolder = '';
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
function addresses() {
  return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:3000`);
}
async function openWindow() {
  pluginFolder = path.join(app.getPath('userData'), 'plugins');
  musicFolder = path.join(app.getPath('userData'), 'music');
  fs.mkdirSync(pluginFolder, { recursive: true });
  fs.mkdirSync(musicFolder, { recursive: true });
  const bundledPluginFolder = path.join(__dirname, 'plugins');
  if (fs.existsSync(bundledPluginFolder)) for (const file of fs.readdirSync(bundledPluginFolder).filter((name) => name.endsWith('.js'))) {
    const destination = path.join(pluginFolder, file);
    if (!fs.existsSync(destination) || file === 'musica.js') fs.copyFileSync(path.join(bundledPluginFolder, file), destination);
  }
  const bundledMusicReadme = path.join(__dirname, 'music', 'README.md');
  const musicReadme = path.join(musicFolder, 'README.md');
  if (fs.existsSync(bundledMusicReadme)) fs.copyFileSync(bundledMusicReadme, musicReadme);
  signaling = await startSignalingServer(3000, { pluginDirectories: [pluginFolder, bundledPluginFolder], musicDirectory: musicFolder, onPluginEvent: (event) => { if (event?.event === 'music-bot') sendMusicBotCommand(event.payload).catch(() => {}); } });
  mainWindow = new BrowserWindow({ width: 920, height: 760, minWidth: 650, minHeight: 560, title: 'VoiceUp Server', icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'), backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'host-preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      title: 'VoiceUp Server',
      message: 'O que deseja fazer com o servidor?',
      detail: 'Manter ativo deixa o servidor funcionando na bandeja do Windows.',
      buttons: ['Manter ativo na bandeja', 'Encerrar servidor', 'Cancelar'],
      defaultId: 0,
      cancelId: 2
    });
    if (choice === 0) mainWindow.hide();
    if (choice === 1) { isQuitting = true; app.quit(); }
  });
  await mainWindow.loadFile(path.join(__dirname, 'host', 'index.html'));
  tray = new Tray(path.join(__dirname, 'assets', 'voiceup-icon.ico'));
  tray.setToolTip('VoiceUp Server · ativo');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Encerrar servidor', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}
ipcMain.handle('server-info', () => {
  const urls = addresses();
  const host = urls[0] || 'http://localhost:3000';
  const connectionCode = `VU1:${Buffer.from(JSON.stringify({ host })).toString('base64')}`;
  return { port: 3000, urls, connectionCode, pluginFolder, musicFolder };
});
ipcMain.handle('server-stats', () => {
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage(lastCpu);
  const elapsedMicros = Number(now - lastCpuAt) / 1000;
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
  const cpuPercent = elapsedMicros > 0 ? Math.min(100, Math.round(((usage.user + usage.system) / elapsedMicros) * 1000) / 10) : 0;
  const memory = process.memoryUsage();
  return { ...signaling.getStats(), cpuPercent, memoryMb: Math.round(memory.rss / 1024 / 1024), heapMb: Math.round(memory.heapUsed / 1024 / 1024) };
});
ipcMain.handle('music-bot:read-track', (_event, fileName) => {
  const safeName = path.basename(String(fileName || ''));
  if (!/\.(mp3|ogg|wav|m4a|aac)$/i.test(safeName)) throw new Error('Formato de música inválido.');
  const file = path.join(musicFolder, safeName);
  if (!fs.existsSync(file)) throw new Error('Arquivo de música não encontrado.');
  return fs.readFileSync(file);
});
ipcMain.on('music-bot:ready', () => { musicBotReady = true; while (pendingMusicCommands.length) musicBotWindow?.webContents.send('music-bot:command', pendingMusicCommands.shift()); });
registerUpdateHandlers(ipcMain, 'VoiceUPServer Setup ');
app.whenReady().then(openWindow).catch((error) => { console.error(error); app.quit(); });
app.on('activate', () => { mainWindow?.show(); });
app.on('before-quit', () => { musicBotWindow?.destroy(); signaling?.server.close(); });
