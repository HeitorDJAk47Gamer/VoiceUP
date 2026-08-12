const { app, BrowserWindow, shell, desktopCapturer, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerUpdateHandlers } = require('./update-helper');

let mainWindow;
let tray;
let isQuitting = false;
let selectedCapture = { id: '', includeAudio: false };
let windowSettings = { closeBehavior: 'tray' };
const settingsPath = () => path.join(app.getPath('userData'), 'window-settings.json');
function loadSettings() { try { windowSettings = { ...windowSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* first start */ } }
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(windowSettings, null, 2), 'utf8'); } catch { /* optional preference */ } }
function revealWindow() { mainWindow?.show(); mainWindow?.focus(); }
function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'assets', 'voiceup-icon.ico'));
  tray.setToolTip('VoiceUP');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir VoiceUP', click: revealWindow }, { type: 'separator' }, { label: 'Encerrar programa', click: () => { isQuitting = true; app.quit(); } }]));
  tray.on('double-click', revealWindow);
}
async function createWindow() {
  loadSettings(); createTray();
  mainWindow = new BrowserWindow({ width: 1180, height: 760, minWidth: 780, minHeight: 600, title: 'VoiceUp', icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'), backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'client-preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', (event) => {
    if (isQuitting || windowSettings.closeBehavior === 'quit') return;
    event.preventDefault();
    if (windowSettings.closeBehavior === 'ask') {
      const choice = dialog.showMessageBoxSync(mainWindow, { type: 'question', title: 'VoiceUP', message: 'Fechar o VoiceUP?', detail: 'Você pode mantê-lo aberto na bandeja do Windows.', buttons: ['Manter na bandeja', 'Encerrar programa', 'Cancelar'], defaultId: 0, cancelId: 2 });
      if (choice === 1) { isQuitting = true; app.quit(); } else if (choice === 0) mainWindow.hide();
      return;
    }
    mainWindow.hide();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media' || permission === 'display-capture'));
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media' || permission === 'display-capture');
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: true });
      const source = sources.find((item) => item.id === selectedCapture.id) || sources[0];
      callback(source ? { video: source, ...(selectedCapture.includeAudio ? { audio: 'loopback' } : {}) } : {});
    } catch { callback({}); }
  });
  await mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'), { query: { version: app.getVersion() } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
registerUpdateHandlers(ipcMain, 'VoiceUP Setup ');
ipcMain.handle('capture:sources', async () => (await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: true, thumbnailSize: { width: 420, height: 236 } })).map((source) => ({
  id: source.id,
  name: source.name,
  kind: source.id.startsWith('screen:') ? 'screen' : 'window',
  thumbnail: source.thumbnail?.isEmpty?.() ? '' : source.thumbnail?.toDataURL?.() || '',
  appIcon: source.appIcon?.isEmpty?.() ? '' : source.appIcon?.toDataURL?.() || ''
})));
ipcMain.handle('capture:select', (_event, selection = {}) => { selectedCapture = { id: String(selection.id || ''), includeAudio: Boolean(selection.includeAudio) }; return true; });
ipcMain.handle('window:set-video-fullscreen', (_event, enabled) => { mainWindow?.setFullScreen(Boolean(enabled)); return Boolean(enabled); });
ipcMain.handle('window:settings', () => windowSettings);
ipcMain.handle('window:save-settings', (_event, next = {}) => { const allowed = ['tray', 'ask', 'quit']; windowSettings.closeBehavior = allowed.includes(next.closeBehavior) ? next.closeBehavior : 'tray'; saveSettings(); return windowSettings; });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else revealWindow(); });
app.on('before-quit', () => { isQuitting = true; });
