const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assetFor, isNewer } = require('../update-helper');

const version = '9.8.7';
const assets = [
  {
    name: `VoiceUP.Setup.${version}.exe`,
    browser_download_url: `https://example.invalid/VoiceUP.Setup.${version}.exe`
  },
  {
    name: `VoiceUPServer.Setup.${version}.exe`,
    browser_download_url: `https://example.invalid/VoiceUPServer.Setup.${version}.exe`
  }
];

const client = assetFor('VoiceUP Setup ', version, assets);
assert.equal(client.assetName, `VoiceUP.Setup.${version}.exe`);
assert.equal(client.url, assets[0].browser_download_url);

const server = assetFor('VoiceUPServer Setup ', version, assets);
assert.equal(server.assetName, `VoiceUPServer.Setup.${version}.exe`);
assert.equal(server.url, assets[1].browser_download_url);

const clientFallback = assetFor('VoiceUP Setup ', version);
assert.equal(clientFallback.assetName, `VoiceUP.Setup.${version}.exe`);
assert.ok(clientFallback.url.endsWith(`/VoiceUP.Setup.${version}.exe`));

const serverFallback = assetFor('VoiceUPServer Setup ', version);
assert.equal(serverFallback.assetName, `VoiceUPServer.Setup.${version}.exe`);
assert.ok(serverFallback.url.endsWith(`/VoiceUPServer.Setup.${version}.exe`));

assert.equal(isNewer('1.1.2', '1.1.1'), true);
assert.equal(isNewer('1.1.1', '1.1.2'), false);

const workspace = path.resolve(__dirname, '..');
const clientMain = fs.readFileSync(path.join(workspace, 'electron-main.js'), 'utf8');
const serverMain = fs.readFileSync(path.join(workspace, 'server-host-main.js'), 'utf8');
assert.match(clientMain, /registerUpdateHandlers\(ipcMain,\s*['"]VoiceUP Setup\s*['"]\)/);
assert.match(serverMain, /registerUpdateHandlers\(ipcMain,\s*['"]VoiceUPServer Setup\s*['"]\)/);

console.log('Compatibilidade do atualizador validada para Cliente e ServerHost.');
