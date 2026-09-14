'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-update-ui-'));
const errors = [];
let window;
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
setTimeout(() => { console.error(`Update UI timeout. Errors: ${JSON.stringify(errors)}`); app.exit(1); }, 40000).unref();

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'update-progress-test-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
      partition: 'update-ui-test'
    }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  await runtimeReady;
  await evaluate(`applyTheme('forest'); window.voiceupUpdateTest.emit({ phase: 'downloading', percent: 47, version: '9.9.9', message: 'Baixando teste…', minimizable: true });`);
  await pause(100);
  let state = await evaluate(`(() => {
    const overlay = document.querySelector('#client-update-progress');
    const card = document.querySelector('.client-update-card');
    return { visible: !overlay.classList.contains('hidden'), width: document.querySelector('#client-update-bar').style.width, message: document.querySelector('#client-update-message').textContent, background: getComputedStyle(card).backgroundImage, minimizeVisible: !document.querySelector('#client-update-minimize').classList.contains('hidden') };
  })()`);
  assert.equal(state.visible, true);
  assert.equal(state.width, '47%');
  assert.equal(state.message, 'Baixando teste…');
  assert.match(state.background, /gradient/i);
  assert.equal(state.minimizeVisible, true);

  await evaluate(`document.querySelector('#client-update-progress').click();`);
  state = await evaluate(`({ overlayHidden: document.querySelector('#client-update-progress').classList.contains('hidden'), chipVisible: !document.querySelector('#client-update-chip').classList.contains('hidden') })`);
  assert.deepEqual(state, { overlayHidden: true, chipVisible: true });
  await evaluate(`document.querySelector('#client-update-chip').click(); window.voiceupUpdateTest.emit({ phase: 'installing', percent: 100, message: 'Instalando silenciosamente…', minimizable: false }); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('#client-update-progress').click();`);
  state = await evaluate(`({ visible: !document.querySelector('#client-update-progress').classList.contains('hidden'), minimizeHidden: document.querySelector('#client-update-minimize').classList.contains('hidden'), detail: document.querySelector('#client-update-detail').textContent })`);
  assert.equal(state.visible, true, 'The final install phase must not be dismissible while the app is about to close.');
  assert.equal(state.minimizeHidden, true);
  assert.match(state.detail, /dados serão preservados/i);
  assert.deepEqual(errors, []);
  console.log('PASS update UI: themed progress, percentage, minimization and protected silent-install phase.');
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-update-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron may still hold cache files briefly. */ }
  }
  app.exit(process.exitCode || 0);
});
