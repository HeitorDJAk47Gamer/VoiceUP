const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assetFor, isNewer, preferredLinuxExtension, trustedDownloadUrl, updateAssetName, updateAvailability } = require('../update-helper');

const version = '9.8.7';
const assets = [
  {
    name: `VoiceUP.Setup.${version}.exe`,
    browser_download_url: `https://github.com/example/VoiceUP.Setup.${version}.exe`,
    digest: `sha256:${'a'.repeat(64)}`,
    size: 42
  },
  {
    name: `VoiceUPServer.Setup.${version}.exe`,
    browser_download_url: `https://github.com/example/VoiceUPServer.Setup.${version}.exe`,
    digest: `sha256:${'b'.repeat(64)}`,
    size: 43
  },
  {
    name: `VoiceUP-${version}-linux-x64.AppImage`,
    browser_download_url: `https://github.com/example/VoiceUP-${version}-linux-x64.AppImage`,
    digest: `sha256:${'c'.repeat(64)}`,
    size: 44
  },
  {
    name: `VoiceUPServer-${version}-linux-x64.deb`,
    browser_download_url: `https://github.com/example/VoiceUPServer-${version}-linux-x64.deb`,
    digest: `sha256:${'d'.repeat(64)}`,
    size: 45
  }
];

const windowsOptions = { platform: 'win32', arch: 'x64' };
const client = assetFor('VoiceUP Setup ', version, assets, windowsOptions);
assert.equal(client.assetName, `VoiceUP.Setup.${version}.exe`);
assert.equal(client.url, assets[0].browser_download_url);
assert.equal(client.digest, assets[0].digest);
assert.equal(client.size, assets[0].size);

const server = assetFor('VoiceUPServer Setup ', version, assets, windowsOptions);
assert.equal(server.assetName, `VoiceUPServer.Setup.${version}.exe`);
assert.equal(server.url, assets[1].browser_download_url);

const clientFallback = assetFor('VoiceUP Setup ', version, [], windowsOptions);
assert.equal(clientFallback.assetName, `VoiceUP.Setup.${version}.exe`);
assert.ok(clientFallback.url.endsWith(`/VoiceUP.Setup.${version}.exe`));

const serverFallback = assetFor('VoiceUPServer Setup ', version, [], windowsOptions);
assert.equal(serverFallback.assetName, `VoiceUPServer.Setup.${version}.exe`);
assert.ok(serverFallback.url.endsWith(`/VoiceUPServer.Setup.${version}.exe`));
assert.equal(serverFallback.digest, '', 'O fallback sem metadados não pode inventar um hash.');

const linuxClient = assetFor('VoiceUP Setup ', version, assets, { platform: 'linux', arch: 'x64', linuxProductName: 'VoiceUP', linuxExtension: 'AppImage' });
assert.equal(linuxClient.assetName, `VoiceUP-${version}-linux-x64.AppImage`);
assert.equal(linuxClient.url, assets[2].browser_download_url);
assert.equal(linuxClient.digest, assets[2].digest);
assert.equal(linuxClient.published, true);

const linuxServer = assetFor('VoiceUPServer Setup ', version, assets, { platform: 'linux', arch: 'x64', linuxProductName: 'VoiceUPServer', linuxExtension: 'deb' });
assert.equal(linuxServer.assetName, `VoiceUPServer-${version}-linux-x64.deb`);
assert.equal(linuxServer.url, assets[3].browser_download_url);
assert.equal(updateAvailability(version, '1.0.0', linuxClient, 'linux').available, true);
assert.equal(updateAvailability(version, '1.0.0', linuxClient, 'linux').packageUnavailable, false);
const missingLinuxPackage = assetFor('VoiceUP Setup ', version, [], { platform: 'linux', arch: 'x64', linuxProductName: 'VoiceUP', linuxExtension: 'AppImage' });
const unavailableLinuxUpdate = updateAvailability(version, '1.0.0', missingLinuxPackage, 'linux');
assert.equal(unavailableLinuxUpdate.available, false, 'Uma Release sem AppImage/deb verificado não pode aparecer como atualizável no Linux.');
assert.equal(unavailableLinuxUpdate.packageUnavailable, true);
assert.match(unavailableLinuxUpdate.message, /pacote Linux verificado/);
assert.equal(updateAvailability(version, version, missingLinuxPackage, 'linux').packageUnavailable, false);
assert.equal(updateAssetName('VoiceUP Setup ', version, { platform: 'linux', arch: 'arm64', linuxProductName: 'VoiceUP', linuxExtension: 'AppImage' }), `VoiceUP-${version}-linux-arm64.AppImage`);
assert.equal(preferredLinuxExtension('/opt/VoiceUP/voiceup', ''), 'deb');
assert.equal(preferredLinuxExtension('/tmp/.mount_voiceup/voiceup', '/downloads/VoiceUP.AppImage'), 'AppImage');
assert.equal(trustedDownloadUrl('https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/download/v1/app.exe'), true);
assert.equal(trustedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/app.exe'), true);
assert.equal(trustedDownloadUrl('http://github.com/VoiceUP.exe'), false);
assert.equal(trustedDownloadUrl('https://github.com.evil.example/VoiceUP.exe'), false);
assert.equal(trustedDownloadUrl('https://user@github.com/VoiceUP.exe'), false);

assert.equal(isNewer('1.1.2', '1.1.1'), true);
assert.equal(isNewer('1.1.1', '1.1.2'), false);
assert.equal(isNewer('1.1.3-beta.1', '1.1.2'), true);
assert.equal(isNewer('1.1.3-beta.2', '1.1.3-beta.1'), true);
assert.equal(isNewer('1.1.3-beta.3', '1.1.3-beta.2'), true);
assert.equal(isNewer('1.1.3-beta.7', '1.1.3-beta.6'), true);
assert.equal(isNewer('1.1.3-beta.9', '1.1.3-beta.8'), true);
assert.equal(isNewer('1.1.3-beta.8', '1.1.3-beta.9'), false);
assert.equal(isNewer('1.1.3', '1.1.3-beta.9'), true);
assert.equal(isNewer('1.1.3-beta.1', '1.1.3'), false);

const workspace = path.resolve(__dirname, '..');
const clientMain = fs.readFileSync(path.join(workspace, 'electron-main.js'), 'utf8');
const serverMain = fs.readFileSync(path.join(workspace, 'server-host-main.js'), 'utf8');
const updateHelper = fs.readFileSync(path.join(workspace, 'update-helper.js'), 'utf8');
assert.match(clientMain, /registerUpdateHandlers\(ipcMain,\s*['"]VoiceUP Setup\s*['"]/);
assert.match(serverMain, /registerUpdateHandlers\(ipcMain,\s*['"]VoiceUPServer Setup\s*['"]/);
assert.match(updateHelper, /verifyDownloadedUpdate\(destination, update[^)]*\)[\s\S]*shell\.openPath\(destination\)/, 'A assinatura e o hash devem ser verificados antes de abrir o pacote.');
assert.match(updateHelper, /releaseIntegrity\.verifySync/, 'O atualizador precisa validar a assinatura Ed25519 fixada no aplicativo.');
assert.match(updateHelper, /GitHub Release SHA-256/, 'O pacote Linux precisa ser aceito apenas após validar o SHA-256 oficial.');
assert.match(updateHelper, /packageUnavailable/, 'A interface precisa distinguir uma versão nova de um pacote verificável.');

console.log('Compatibilidade do atualizador validada para Cliente e ServerHost no Windows e Linux.');
