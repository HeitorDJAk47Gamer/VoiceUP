const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), 'utf8');
const clientMain = read('electron-main.js');
const serverMain = read('server-host-main.js');
const clientPreload = read('client-preload.js');
const hostPreload = read('host-preload.js');
const clientRenderer = read(path.join('public', 'app.js'));
const hostRenderer = read(path.join('host', 'renderer.js'));
const hostHtml = read(path.join('host', 'index.html'));

for (const [label, source] of [['Client', clientMain], ['ServerHost', serverMain]]) {
  const disableAt = source.indexOf('app.disableHardwareAcceleration()');
  const readyAt = source.indexOf('app.whenReady()');
  assert.ok(disableAt >= 0, `${label} precisa aplicar a preferência no processo principal.`);
  assert.ok(readyAt > disableAt, `${label} precisa desativar a aceleração antes de o Electron ficar pronto.`);
  assert.match(source, /hardwareAcceleration:\s*true/, `${label} precisa manter a aceleração ligada por padrão.`);
  assert.match(source, /restartRequired:/, `${label} precisa informar quando há reinício pendente.`);
  assert.match(source, /typeof next\.hardwareAcceleration === 'boolean'/, `${label} deve aceitar somente um booleano persistido.`);
  assert.match(source, /app\.relaunch\(\)[\s\S]*app\.quit\(\)/, `${label} precisa oferecer reinício controlado.`);
}

assert.match(clientPreload, /restartApplication:.*window:restart/, 'O Client precisa expor somente o IPC de reinício necessário.');
assert.match(hostPreload, /restartApplication:.*window:restart/, 'O ServerHost precisa expor somente o IPC de reinício necessário.');
assert.match(clientRenderer, /id="hardware-acceleration-toggle"/, 'A opção precisa aparecer no Client.');
assert.match(clientRenderer, /hardwareAcceleration:\s*hardwareAccelerationEnabled/, 'O Client precisa salvar a escolha no processo principal.');
assert.match(clientRenderer, /hardware-acceleration-restart-button/, 'O Client precisa oferecer reinício sem forçá-lo.');
assert.match(hostHtml, /id="host-hardware-acceleration"/, 'A opção precisa aparecer no ServerHost.');
assert.match(hostRenderer, /hardwareAcceleration:\s*\$\('host-hardware-acceleration'\)\.checked/, 'O ServerHost precisa salvar a escolha.');
assert.match(hostRenderer, /host-hardware-restart-button/, 'O ServerHost precisa oferecer reinício sem forçá-lo.');

console.log('Aceleração de hardware validada no Client e ServerHost: padrão ligado, persistência local e reinício controlado.');
