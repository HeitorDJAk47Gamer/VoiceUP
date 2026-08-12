const { app, BrowserWindow, shell, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const { registerUpdateHandlers } = require('./update-helper');

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 780,
    minHeight: 600,
    title: 'VoiceUp',
    icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'),
    backgroundColor: '#101522',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'client-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media' || permission === 'display-capture');
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback(sources[0] ? { video: sources[0] } : {});
    } catch {
      callback({});
    }
  });
  await mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'), { query: { version: app.getVersion() } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

registerUpdateHandlers(ipcMain, 'VoiceUP Setup ');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
