'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-host-access-ui-'));
const errors = [];
let window;
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
setTimeout(() => { console.error(`ServerHost access UI timeout. Errors: ${JSON.stringify(errors)}`); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false, width: 1080, height: 820,
    webPreferences: { preload: path.join(__dirname, 'serverhost-access-test-preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true, partition: 'host-access-ui-test' }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text); });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '..', 'host', 'index.html'));
  await runtimeReady;
  await pause(350);
  await evaluate(`document.querySelector('[data-view="access"]').click();`);
  await pause(100);
  let state = await evaluate(`(() => ({
    active: document.querySelector('[data-page="access"]').classList.contains('active'),
    roleCount: document.querySelectorAll('#role-list .role-card').length,
    permissionCount: document.querySelectorAll('#permission-editor input').length,
    people: document.querySelectorAll('#role-member-list .role-member').length,
    audits: document.querySelectorAll('#security-audit-list .security-audit-entry').length,
    memberRole: document.querySelector('#member-list .inline-role')?.textContent || '',
    ping: document.querySelector('#member-list .ping-bars em')?.textContent || ''
  }))()`);
  assert.deepEqual(state, { active: true, roleCount: 3, permissionCount: 7, people: 1, audits: 1, memberRole: 'Moderador', ping: '12 ms' });
  await evaluate(`(() => {
    const input = document.querySelector('#role-member-list input[value="moderator"]');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await pause(120);
  state = await evaluate(`({ saveButton: Boolean(document.querySelector('[data-save-member-roles]')), calls: window.voiceupHostUiTest.roleAssignmentCalls(), autosave: document.querySelector('.role-assignment-autosave')?.textContent.trim() })`);
  assert.equal(state.saveButton, false, 'O ServerHost não deve mostrar botão para salvar atribuições.');
  assert.deepEqual(state.calls, [{ clientId: 'protected-person', roleIds: [], name: 'Pessoa' }]);
  assert.equal(state.autosave, '', 'O ServerHost não deve manter uma legenda de autosave depois que a alteração termina.');
  await evaluate(`document.querySelector('[data-edit-role="moderator"]').click();`);
  state = await evaluate(`({ name: document.querySelector('#role-name').value, color: document.querySelector('#role-color').value, selectedPermissions: document.querySelectorAll('#permission-editor input:checked').length, deleteHidden: document.querySelector('#delete-role').classList.contains('hidden') })`);
  assert.deepEqual(state, { name: 'Moderador', color: '#a879ff', selectedPermissions: 4, deleteHidden: true });

  await evaluate(`window.voiceupHostUiTest.emitProgress({ phase: 'downloading', percent: 63, message: 'Baixando teste…', minimizable: true });`);
  state = await evaluate(`({ visible: !document.querySelector('#update-progress').classList.contains('hidden'), width: document.querySelector('#update-progress-bar').style.width, theme: document.body.dataset.theme, background: getComputedStyle(document.querySelector('.update-progress-card')).backgroundImage })`);
  assert.equal(state.visible, true); assert.equal(state.width, '63%'); assert.equal(state.theme, 'forest'); assert.match(state.background, /gradient/i);
  await evaluate(`document.querySelector('#update-progress').click();`);
  state = await evaluate(`({ overlayHidden: document.querySelector('#update-progress').classList.contains('hidden'), chipVisible: !document.querySelector('#update-progress-chip').classList.contains('hidden') })`);
  assert.deepEqual(state, { overlayHidden: true, chipVisible: true });
  await evaluate(`document.querySelector('[data-view="settings"]').click(); document.querySelector('.backup-panel').scrollIntoView({ block: 'center' }); document.querySelector('#backup-include-music').checked = true;`);
  await pause(80);
  fs.writeFileSync(path.join(__dirname, 'serverhost-backup-beta5.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('#create-server-backup').click();`);
  await pause(80);
  state = await evaluate(`({ active: document.querySelector('[data-page="settings"]').classList.contains('active'), panel: Boolean(document.querySelector('.backup-panel')), create: Boolean(document.querySelector('#create-server-backup')), restore: Boolean(document.querySelector('#restore-server-backup')), layout: getComputedStyle(document.querySelector('.backup-content-grid')).display, status: document.querySelector('#backup-status b').textContent, calls: window.voiceupHostUiTest.backupCalls() })`);
  assert.equal(state.active, true); assert.equal(state.panel, true); assert.equal(state.create, true); assert.equal(state.restore, true); assert.equal(state.layout, 'grid');
  assert.equal(state.status, 'teste.voiceup-backup');
  assert.deepEqual(state.calls, [{ action: 'create', options: { includePlugins: true, includeMusic: true } }]);
  await evaluate(`document.querySelector('#restore-server-backup').click();`);
  await pause(80);
  state = await evaluate(`({ visible: !document.querySelector('#app-dialog').classList.contains('hidden'), title: document.querySelector('#app-dialog-title').textContent, detail: document.querySelector('#app-dialog-detail').textContent })`);
  assert.equal(state.visible, true); assert.equal(state.title, 'Restaurar este servidor?'); assert.match(state.detail, /estado atual será salvo automaticamente/);
  await evaluate(`document.querySelector('[data-dialog-value="confirm"]').click();`);
  await pause(80);
  state = await evaluate(`({ status: document.querySelector('#backup-status b').textContent, calls: window.voiceupHostUiTest.backupCalls() })`);
  assert.equal(state.status, 'Backup restaurado');
  assert.deepEqual(state.calls.at(-1), { action: 'restore', token: 'backup-token' });
  assert.deepEqual(errors, []);
  console.log('PASS ServerHost UI: roles, permissions, assignments, audit, backup/restore, ping and themed update progress.');
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-host-access-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron may hold cache files briefly. */ }
  }
  app.exit(process.exitCode || 0);
});
