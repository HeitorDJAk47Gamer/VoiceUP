const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '.verify-camera-userdata'));

async function verifyCameraCapture() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const open = async (video) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const track = stream.getVideoTracks()[0];
      const result = {
        label: track?.label || cameras[0]?.label || 'Câmera disponível',
        settings: track?.getSettings?.() || {}
      };
      stream.getTracks().forEach((item) => item.stop());
      return result;
    };
    const first = await open(true);
    await new Promise((resolve) => setTimeout(resolve, 320));
    const reopened = await open({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 }
    });
    return { deviceCount: cameras.length, first, reopened };
  } catch (error) {
    return { failed: true, name: error?.name || 'Error', message: error?.message || String(error) };
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(__dirname, 'camera-test.html'));
    const result = await window.webContents.executeJavaScript(`(${verifyCameraCapture.toString()})()`);
    if (result.failed) {
      process.stderr.write(`${JSON.stringify({ ok: false, name: result.name, message: result.message })}\n`);
      app.exit(1);
      return;
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, name: error?.name || 'Error', message: error?.message || String(error) })}\n`);
    app.exit(1);
  }
});
