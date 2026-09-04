const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseLinuxRouteTable } = require('../network-access');
const { assetFor, preferredLinuxExtension, updateAvailability } = require('../update-helper');

const workspace = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(workspace, file), 'utf8');
const packageJson = JSON.parse(read('package.json'));

assert.equal(packageJson.version, require('../public/release-history').version, 'Linux deve usar a mesma versão estável e histórico das outras edições.');
assert.equal(packageJson.desktopName, 'com.voiceup.app.desktop');
assert.match(packageJson.scripts['dist:linux'], /--linux AppImage deb --x64/);
assert.match(packageJson.scripts['dist:linux:server'], /--linux AppImage deb --x64/);
assert.doesNotMatch(packageJson.scripts['dist:linux'], /powershell|build:native|voiceup-process-audio\.exe|--win\b/i, 'O build Linux não pode depender do helper Windows.');
assert.doesNotMatch(packageJson.scripts['dist:linux:server'], /powershell|build:native|voiceup-process-audio\.exe|--win\b/i, 'O ServerHost Linux não pode depender do helper Windows.');
assert.equal(packageJson.build.extraResources, undefined, 'Recursos nativos Windows não podem ser globais.');
assert.equal(packageJson.build.win.extraResources[0].from, 'native/voiceup-process-audio.exe');
assert.deepEqual(packageJson.build.linux.target, ['AppImage', 'deb']);
assert.match(packageJson.build.linux.icon, /\.png$/i);
assert.equal(packageJson.build.linux.executableName, 'voiceup');
assert.equal(packageJson.build.linux.artifactName, '${productName}-${version}-linux-x64.${ext}');
assert.match(packageJson.scripts['dist:linux:server'], /extraMetadata\.desktopName=com\.goatgank\.voiceup\.server\.desktop/);

const clientMain = read('electron-main.js');
const serverMain = read('server-host-main.js');
const updater = read('update-helper.js');
assert.match(clientMain, /process\.platform === 'win32' \? 'voiceup-icon\.ico' : 'voiceup-logo-2d\.png'/);
assert.match(clientMain, /available:\s*process\.platform === 'win32'/, 'O helper de áudio por processo deve continuar restrito ao Windows.');
assert.match(clientMain, /linux-loopback-not-supported/);
assert.match(serverMain, /process\.platform === 'linux' \? pluginFolder/, 'Plugins do ServerHost precisam ficar em um diretório gravável no Linux.');
assert.match(updater, /linuxProductName/);
assert.match(updater, /\.AppImage/);
assert.match(updater, /fs\.chmodSync\(destination, 0o755\)/, 'O AppImage baixado deve receber permissão de execução.');
assert.match(updater, /packageUnavailable/, 'Uma versão publicada sem pacote Linux verificável deve ser informada sem iniciar download.');
assert.match(read('public/app.js'), /result\.packageUnavailable/);
assert.match(read('host/renderer.js'), /result\.packageUnavailable/);
assert.doesNotMatch(read('public/app.js'), /bandeja do Windows/);
assert.doesNotMatch(read('public/app.js'), /aplicativo Windows/);
assert.doesNotMatch(read('host/renderer.js'), /bandeja do Windows/);
assert.doesNotMatch(read('public/beta-ui.js'), /Win \+ \./);

const linuxAsset = assetFor('VoiceUP Setup ', '1.2.3', [{
  name: 'VoiceUP-1.2.3-linux-x64.AppImage',
  browser_download_url: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/download/v1.2.3/VoiceUP-1.2.3-linux-x64.AppImage',
  digest: `sha256:${'a'.repeat(64)}`,
  size: 1024
}], { platform: 'linux', arch: 'x64', linuxProductName: 'VoiceUP', linuxExtension: 'AppImage' });
assert.equal(linuxAsset.assetName, 'VoiceUP-1.2.3-linux-x64.AppImage');
assert.equal(linuxAsset.published, true);
assert.equal(preferredLinuxExtension('/opt/VoiceUP/voiceup', ''), 'deb');
assert.equal(updateAvailability('1.2.3', '1.2.2', linuxAsset, 'linux').available, true);
assert.equal(updateAvailability('1.2.3', '1.2.2', assetFor('VoiceUP Setup ', '1.2.3', [], { platform: 'linux', arch: 'x64', linuxProductName: 'VoiceUP' }), 'linux').packageUnavailable, true);

const routeTable = [
  'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
  'docker0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t00000000\t0102A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0'
].join('\n');
const route = parseLinuxRouteTable(routeTable, {
  docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.2' }],
  eth0: [{ family: 'IPv4', internal: false, address: '192.168.2.20' }]
});
assert.deepEqual(route, { gateway: '192.168.2.1', internalHost: '192.168.2.20', metric: 100, virtual: false });

const workflow = read('.github/workflows/release.yml');
assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
assert.match(workflow, /npm run dist:linux/);
assert.match(workflow, /npm run dist:linux:server/);
assert.ok(fs.existsSync(path.join(workspace, 'linux', 'README.md')));

console.log('Compatibilidade estática Linux validada para Cliente, ServerHost, rede, atualização e empacotamento.');
