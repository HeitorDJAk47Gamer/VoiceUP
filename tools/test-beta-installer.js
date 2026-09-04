const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

const workspace = path.resolve(__dirname, '..');
const version = require(path.join(workspace, 'package.json')).version;

assert.match(version, /^\d+\.\d+\.\d+-beta\.\d+$/, 'A versao deve usar o formato x.y.z-beta.n.');

const installers = [
  path.join(workspace, 'release-beta', `VoiceUP Setup ${version}.exe`),
  path.join(workspace, 'release-beta-server', `VoiceUPServer Setup ${version}.exe`)
];

for (const installer of installers) {
  assert.ok(fs.existsSync(installer), `Instalador ausente: ${installer}`);
  assert.ok(fs.statSync(installer).size > 1024 * 1024, `Instalador invalido ou incompleto: ${installer}`);
}

const executables = [
  path.join(workspace, 'release-beta', 'win-unpacked', 'VoiceUP.exe'),
  path.join(workspace, 'release-beta-server', 'win-unpacked', 'VoiceUPServer.exe')
];

for (const executable of executables) {
  assert.ok(fs.existsSync(executable), `Executável portátil ausente: ${executable}`);
  assert.ok(fs.statSync(executable).size > 1024 * 1024, `Executável portátil inválido: ${executable}`);
}

const clientArchive = path.join(workspace, 'release-beta', 'win-unpacked', 'resources', 'app.asar');
const serverArchive = path.join(workspace, 'release-beta-server', 'win-unpacked', 'resources', 'app.asar');
const packagedManifest = (archive) => JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const clientManifest = packagedManifest(clientArchive);
const serverManifest = packagedManifest(serverArchive);
assert.equal(clientManifest.version, version, 'O Client empacotado deve conter a beta atual.');
assert.equal(serverManifest.version, version, 'O ServerHost empacotado deve conter a beta atual.');
assert.equal(clientManifest.main, 'electron-main.js', 'O pacote do Client deve iniciar pelo processo do Client.');
assert.equal(serverManifest.main, 'server-host-main.js', 'O pacote do ServerHost deve iniciar pelo processo do ServerHost.');
assert.equal(serverManifest.name, 'voiceup-server', 'O ServerHost precisa de identidade interna própria.');
assert.equal(serverManifest.productName, 'VoiceUPServer', 'O ServerHost precisa de nome de produto próprio.');
assert.notEqual(clientManifest.name, serverManifest.name, 'Cliente e ServerHost não podem compartilhar a identidade do aplicativo.');
// Electron 43 no longer writes win-unpacked/version. The executable itself is
// validated below through its fuses; keep the pinned runtime assertion here.
assert.equal(require(path.join(workspace, 'package.json')).devDependencies.electron, '43.4.1', 'A beta precisa usar a linha validada do Electron 43.');

const packagedWelcome = asar.extractFile(clientArchive, 'public/index.html').toString('utf8');
const packagedWelcomeCss = asar.extractFile(clientArchive, 'public/beta.css').toString('utf8');
const packagedWelcomeApp = asar.extractFile(clientArchive, 'public/app.js').toString('utf8');
const packagedClientMain = asar.extractFile(clientArchive, 'electron-main.js').toString('utf8');
const packagedClientPreload = asar.extractFile(clientArchive, 'client-preload.js').toString('utf8');
const packagedServerMain = asar.extractFile(serverArchive, 'server-host-main.js').toString('utf8');
const packagedHostPreload = asar.extractFile(serverArchive, 'host-preload.js').toString('utf8');
const packagedHostHtml = asar.extractFile(serverArchive, 'host/index.html').toString('utf8');
const packagedBetaUi = asar.extractFile(clientArchive, 'public/beta-ui.js').toString('utf8');
const packagedMediaStability = asar.extractFile(clientArchive, 'public/media-stability.js').toString('utf8');
const packagedRnnoiseEngine = asar.extractFile(clientArchive, 'public/rnnoise-engine.js').toString('utf8');
const packagedRnnoiseWorklet = asar.extractFile(clientArchive, path.join('public', 'vendor', 'rnnoise', 'rnnoise-worklet.js')).toString('utf8');
const packagedRnnoiseWasm = asar.extractFile(clientArchive, path.join('public', 'vendor', 'rnnoise', 'rnnoise.wasm'));
const packagedRnnoiseSimdWasm = asar.extractFile(clientArchive, path.join('public', 'vendor', 'rnnoise', 'rnnoise_simd.wasm'));
const packagedSocketLoader = asar.extractFile(clientArchive, 'public/socket-loader.js').toString('utf8');
const packagedSocketClient = asar.extractFile(clientArchive, path.join('node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'));
assert.match(packagedWelcome, /id="welcome-avatar-preview"/, 'O pacote Client precisa incluir a prévia de foto de perfil.');
assert.match(packagedWelcome, /Content-Security-Policy/, 'O Client precisa incluir uma política de conteúdo.');
assert.match(packagedWelcome, /script-src 'self'/, 'O Client não pode executar scripts remotos.');
assert.match(packagedWelcome, /script-src 'self' 'wasm-unsafe-eval'/, 'A política do Client precisa permitir somente a compilação WASM local exigida pelo RNNoise.');
assert.match(packagedWelcomeCss, /\.welcome:not\(\.hidden\)\{display:flex/, 'O pacote Client precisa incluir a tela inicial centralizada.');
assert.match(packagedWelcomeApp, /voiceup-welcome-open/, 'O pacote Client precisa incluir a rolagem resiliente da tela inicial.');
assert.equal(packagedWelcomeApp.indexOf("$('host-room').value = storedProfile.roomId || '';\nrefreshWelcomeProfile();"), -1, 'O pacote Client não pode interromper a tela inicial antes de registrar os botões.');
assert.ok(packagedWelcomeApp.lastIndexOf('refreshWelcomeProfile();') > packagedWelcomeApp.indexOf('const safeAvatar'), 'O pacote Client precisa iniciar a prévia somente depois dos auxiliares de avatar.');
assert.match(packagedBetaUi, /voiceup-saved-server-actions-layout/, 'O pacote Client precisa manter os botões Novo e Salvar atual compactos.');
assert.match(packagedWelcomeApp, /externalMediaAutoLoad = storedProfile\.externalMediaAutoLoad === true/, 'Mídia externa precisa iniciar desativada.');
assert.match(packagedWelcomeApp, /id="hardware-acceleration-toggle"/, 'O Client empacotado precisa oferecer aceleração de hardware configurável.');
assert.match(packagedWelcomeApp, /id="fullscreen-game-capture-toggle"/, 'O Client empacotado precisa oferecer compatibilidade com jogos em tela cheia.');
assert.doesNotMatch(packagedWelcomeApp, /cursor\s*:\s*['"]never['"]/, 'O Client empacotado não pode remover o cursor da live.');
assert.ok(packagedClientMain.indexOf('app.disableHardwareAcceleration()') < packagedClientMain.indexOf('app.whenReady()'), 'O Client empacotado precisa aplicar a preferência antes de iniciar o Electron.');
assert.ok(packagedClientMain.indexOf("disableChromiumFeature('AllowWgcScreenCapturer')") < packagedClientMain.indexOf('app.whenReady()'), 'O Client empacotado precisa escolher o capturador alternativo antes de iniciar o Electron.');
assert.match(packagedClientMain, /fullscreenGameCaptureCompatibility:\s*true/, 'A compatibilidade de tela cheia precisa iniciar ligada no pacote.');
assert.match(packagedClientMain, /backgroundThrottling:\s*false/, 'A captura não pode ser limitada quando um jogo cobre a janela do VoiceUP.');
assert.match(packagedWelcomeApp, /'maintain-framerate'/, 'Lives em movimento precisam preservar FPS antes da resolução.');
assert.match(packagedWelcomeApp, /screenBase\s*=\s*\{[^}]*720:\s*3800000/, 'A live de jogo precisa conter o teto de bitrate revisado.');
assert.match(packagedClientPreload, /restartApplication:.*window:restart/, 'O Client empacotado precisa oferecer reinício controlado.');
assert.match(packagedClientPreload, /rnnoiseAsset:.*audio:rnnoise-asset/, 'O Client empacotado precisa carregar o RNNoise pelo canal local seguro.');
assert.match(packagedClientMain, /RNNOISE_ASSETS = Object\.freeze/, 'O processo principal precisa restringir os componentes RNNoise a uma lista fechada.');
assert.match(packagedClientMain, /secureHandle\('audio:rnnoise-asset'/, 'O RNNoise precisa usar um manipulador restrito ao Client confiável.');
assert.ok(packagedServerMain.indexOf('app.disableHardwareAcceleration()') < packagedServerMain.indexOf('app.whenReady()'), 'O ServerHost empacotado precisa aplicar a preferência antes de iniciar o Electron.');
assert.match(packagedHostPreload, /restartApplication:.*window:restart/, 'O ServerHost empacotado precisa oferecer reinício controlado.');
assert.match(packagedHostHtml, /id="host-hardware-acceleration"/, 'O ServerHost empacotado precisa oferecer aceleração de hardware configurável.');
assert.match(packagedSocketLoader, /socket\.io-client\/dist\/socket\.io\.min\.js/, 'O Socket.IO precisa ser carregado do próprio pacote.');
assert.ok(packagedSocketClient.length > 10000, 'A biblioteca Socket.IO local não foi empacotada.');
assert.ok(packagedWelcome.indexOf('src="channel-roster.js"') < packagedWelcome.indexOf('src="app.js"'), 'Os auxiliares dos canais precisam carregar antes do aplicativo.');
assert.ok(packagedWelcome.indexOf('src="app.js"') < packagedWelcome.indexOf('src="rnnoise-engine.js"'), 'O mecanismo RNNoise precisa carregar depois da base do Client.');
assert.ok(packagedWelcome.indexOf('src="rnnoise-engine.js"') < packagedWelcome.indexOf('src="beta-ui.js"'), 'O RNNoise precisa estar pronto antes da camada de áudio da beta.');
assert.match(packagedWelcomeApp, /noiseSuppression: noiseEnabled && !rnnoise/, 'O Client não pode aplicar duas supressões de ruído ao mesmo tempo.');
assert.match(packagedBetaUi, /Microfone · RNNoise \(ML local\)/, 'O fluxo de chamada precisa publicar o microfone processado pelo RNNoise.');
assert.match(packagedBetaUi, /filtro padrão/, 'Uma falha do RNNoise precisa manter o microfone com fallback seguro.');
assert.match(packagedBetaUi, /data-media-tile-fullscreen/, 'Cada live ou câmera precisa oferecer sua própria tela cheia.');
assert.match(packagedBetaUi, /data-grid-size/, 'A chamada precisa organizar participantes em uma grade responsiva.');
assert.match(packagedMediaStability, /video-theater-single/, 'A tela cheia individual precisa ocultar somente as outras mídias durante o foco.');
assert.match(packagedMediaStability, /selectTheaterTile\(null\)/, 'Ao sair da tela cheia, a grade precisa ser restaurada sem perder transmissões.');
assert.match(packagedRnnoiseEngine, /PROCESSOR_NAME = '@sapphi-red\/web-noise-suppressor\/rnnoise'/, 'O mecanismo precisa usar o processador RNNoise esperado.');
assert.match(packagedRnnoiseEngine, /sampleRate: 48000/, 'O RNNoise precisa criar seu contexto em 48 kHz.');
assert.match(packagedRnnoiseWorklet, /registerProcessor\(`@sapphi-red\/web-noise-suppressor\/rnnoise`/, 'O AudioWorklet RNNoise não foi empacotado corretamente.');
assert.ok(packagedRnnoiseWasm.length > 100000 && packagedRnnoiseSimdWasm.length > 100000, 'Os binários RNNoise/WASM estão ausentes ou incompletos.');
assert.deepEqual([...packagedRnnoiseWasm.subarray(0, 4)], [0, 97, 115, 109], 'O binário RNNoise padrão não possui o cabeçalho WASM.');
assert.deepEqual([...packagedRnnoiseSimdWasm.subarray(0, 4)], [0, 97, 115, 109], 'O binário RNNoise SIMD não possui o cabeçalho WASM.');
for (const notice of ['NOTICE.txt', 'LICENSE-rnnoise.txt', 'LICENSE-web-noise-suppressor.txt', 'LICENSE-shiguredo-rnnoise-wasm.txt']) {
  assert.ok(asar.extractFile(clientArchive, path.join('public', 'vendor', 'rnnoise', notice)).length > 500, `Aviso legal RNNoise ausente: ${notice}`);
}
assert.match(asar.extractFile(clientArchive, 'public/channel-roster.js').toString('utf8'), /createActivityClock/, 'O pacote precisa incluir o cronômetro dos canais.');
assert.match(asar.extractFile(clientArchive, 'public/channel-roster.css').toString('utf8'), /channel-member-mute-slot/, 'O pacote precisa incluir a lista vertical de membros.');
assert.match(asar.extractFile(clientArchive, 'public/channel-roster.css').toString('utf8'), /channel-live-dot/, 'O pacote precisa mostrar a bolinha Ao vivo ao lado do nick.');
assert.match(packagedWelcome, /src="channel-media-status.js"/, 'Os indicadores de live e câmera precisam carregar no Client.');
assert.match(asar.extractFile(clientArchive, 'public/channel-media-status.js').toString('utf8'), /media-state-update/, 'O pacote precisa incluir os indicadores independentes de mídia.');
assert.match(asar.extractFile(serverArchive, 'signaling-server.js').toString('utf8'), /voiceActivity:/, 'O host precisa compartilhar o início contínuo das calls.');
assert.match(asar.extractFile(serverArchive, 'signaling-server.js').toString('utf8'), /media-state-update/, 'O host precisa compartilhar os indicadores de live e câmera.');

for (const archive of [clientArchive, serverArchive]) {
  for (const file of ['public/index.html', 'public/app.js', 'public/beta-ui.js', 'public/media-stability.js', 'public/rnnoise-engine.js', 'public/vendor/rnnoise/rnnoise-worklet.js', 'public/vendor/rnnoise/rnnoise.wasm', 'public/vendor/rnnoise/rnnoise_simd.wasm', 'public/channel-roster.js', 'public/channel-roster.css', 'public/channel-media-status.js', 'signaling-server.js']) {
    assert.ok(asar.extractFile(archive, file.split('/').join(path.sep)).equals(fs.readFileSync(path.join(workspace, file))), `O pacote precisa conter o arquivo atual: ${file}`);
  }
}

Promise.all(executables.map((executable) => getCurrentFuseWire(executable))).then((fuseWires) => {
  for (const fuses of fuseWires) {
    assert.equal(fuses[FuseV1Options.RunAsNode], 48, 'ELECTRON_RUN_AS_NODE precisa estar desativado.');
    assert.equal(fuses[FuseV1Options.EnableCookieEncryption], 49, 'A criptografia de cookies precisa estar ativada.');
    assert.equal(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], 48, 'NODE_OPTIONS precisa estar desativado.');
    assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], 48, 'Argumentos de inspeção precisam estar desativados.');
    assert.equal(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], 49, 'A integridade do ASAR precisa estar ativada.');
    assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49, 'O Electron deve carregar somente o app.asar.');
  }
  console.log(`Instaladores ${version} validados: Electron 43.4.1, fuses de segurança, Socket.IO local, CSP e identidades separadas.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
