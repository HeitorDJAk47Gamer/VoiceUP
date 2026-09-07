'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readWindowsStartup, writeWindowsStartup } = require('../windows-startup');

const workspace = path.resolve(__dirname, '..');
const executablePath = 'C:\\Program Files\\VoiceUP\\VoiceUP.exe';
const calls = [];
let enabled = false;
const fakeApp = {
  isPackaged: true,
  getLoginItemSettings(query) {
    calls.push({ type: 'get', query });
    return { openAtLogin: enabled };
  },
  setLoginItemSettings(settings) {
    calls.push({ type: 'set', settings });
    enabled = settings.openAtLogin === true;
  }
};

assert.deepEqual(readWindowsStartup(fakeApp, { platform: 'linux', executablePath }), { supported: false, enabled: false });
assert.deepEqual(readWindowsStartup({ ...fakeApp, isPackaged: false }, { platform: 'win32', executablePath }), { supported: false, enabled: false });
assert.equal(calls.length, 0, 'Sistemas não suportados e execuções de desenvolvimento não podem tocar na inicialização do sistema.');

assert.deepEqual(readWindowsStartup(fakeApp, { platform: 'win32', executablePath }), { supported: true, enabled: false });
assert.deepEqual(calls.at(-1), { type: 'get', query: { path: executablePath, args: [] } });

assert.deepEqual(writeWindowsStartup(fakeApp, true, { platform: 'win32', executablePath }), { supported: true, enabled: true });
assert.deepEqual(calls.find((call) => call.type === 'set')?.settings, {
  path: executablePath,
  args: [],
  name: 'VoiceUP',
  openAtLogin: true,
  enabled: true
});

assert.deepEqual(writeWindowsStartup(fakeApp, false, { platform: 'win32', executablePath }), { supported: true, enabled: false });
assert.equal(calls.filter((call) => call.type === 'set').at(-1).settings.openAtLogin, false);

const main = fs.readFileSync(path.join(workspace, 'electron-main.js'), 'utf8');
const client = fs.readFileSync(path.join(workspace, 'public', 'app.js'), 'utf8');
const translations = fs.readFileSync(path.join(workspace, 'public', 'i18n.js'), 'utf8');
const manifest = require(path.join(workspace, 'package.json'));

assert.match(main, /startWithWindows:\s*false/, 'A preferência deve nascer desligada.');
assert.match(main, /writeWindowsStartup\(app, next\.startWithWindows\)/, 'A alteração deve chegar à integração nativa do Windows.');
assert.match(client, /id="start-with-windows-toggle"/, 'A opção precisa existir nas preferências do Client.');
assert.match(client, /start-with-windows-toggle'\)\?\.addEventListener\('change'/, 'A opção deve ser salva assim que for alterada.');
assert.match(client, /startWithWindowsSupported/, 'A interface deve ocultar a opção fora do Windows instalado.');
assert.equal((translations.match(/'settings\.startWithWindows':/g) || []).length, 4, 'A opção precisa estar traduzida nos quatro idiomas.');
assert.ok(manifest.build.files.includes('windows-startup.js'), 'A integração nativa precisa entrar no pacote final.');

console.log('PASS Windows startup: desativado por padrão, restrito ao pacote Windows, persistência imediata e quatro idiomas.');
