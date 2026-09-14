'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
const clientMain = read('electron-main.js');
const serverMain = read('server-host-main.js');
const client = read('public/app.js');
const updater = read('update-helper.js');

assert.equal(pkg.build.appId, 'com.voiceup.app', 'O appId estável do Client mudou e criaria outro perfil no Windows.');
assert.equal(pkg.build.productName, 'VoiceUP', 'O nome estável do Client mudou e poderia criar outra instalação.');
assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'O desinstalador não pode apagar dados usados pela próxima versão.');
assert.match(pkg.scripts['dist:server'], /appId=com\.goatgank\.voiceup\.server/);
assert.match(pkg.scripts['dist:server'], /extraMetadata\.name=voiceup-server/);
assert.match(clientMain, /app\.getPath\(['"]userData['"]\)/, 'Preferências da janela deixaram de usar o perfil persistente do Electron.');
assert.match(serverMain, /const settingsPath = \(\) => path\.join\(app\.getPath\(['"]userData['"]\), ['"]server-settings\.json['"]\)/);
assert.match(serverMain, /security-audit\.json/);
assert.match(client, /localStorage\.setItem\(['"]voiceup-profile-v1['"]/, 'O Client mudou a chave histórica do perfil.');
assert.match(client, /voiceup-identity-key-v1/, 'A identidade protegida deixou de usar uma chave persistente.');
assert.match(updater, /app\.getPath\(['"]temp['"]\).*voiceup-update-/, 'O pacote temporário da atualização deixou de ficar na pasta temporária.');
assert.doesNotMatch(updater, /clearStorageData|session\.clearStorageData|appData[^\n]*rmSync|userData[^\n]*rmSync/, 'O atualizador contém uma limpeza de dados persistentes.');
assert.match(updater, /fs\.rmSync\(updateDirectory/, 'Somente a pasta temporária de uma atualização com falha deve ser removida.');
console.log('PASS update data: identidades de instalação e chaves de perfil permanecem estáveis; somente temporários podem ser removidos.');
