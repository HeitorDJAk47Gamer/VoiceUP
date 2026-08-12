const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { startSignalingServer } = require('./signaling-server');
const { registerUpdateHandlers } = require('./update-helper');

let signaling;
let mainWindow;
let tray;
let isQuitting = false;
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
function addresses() {
  return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:3000`);
}
async function openWindow() {
  signaling = await startSignalingServer(3000);
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
  return { port: 3000, urls, connectionCode };
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
registerUpdateHandlers(ipcMain, 'VoiceUPServer Setup ');
app.whenReady().then(openWindow).catch((error) => { console.error(error); app.quit(); });
app.on('activate', () => { mainWindow?.show(); });
app.on('before-quit', () => signaling?.server.close());
