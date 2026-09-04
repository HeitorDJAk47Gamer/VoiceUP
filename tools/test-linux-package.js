const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const workspace = path.resolve(__dirname, '..');
const version = require(path.join(workspace, 'package.json')).version;
const release = process.argv.includes('--release');

const packages = [
  {
    label: 'Cliente',
    directory: path.join(workspace, 'release-linux', 'linux-unpacked'),
    executable: 'voiceup',
    main: 'electron-main.js',
    expectedName: 'voiceup',
    expectedProductName: undefined,
    requiredFiles: ['electron-main.js', path.join('public', 'index.html')],
    output: path.join(workspace, 'release-linux'),
    productName: 'VoiceUP'
  },
  {
    label: 'ServerHost',
    directory: path.join(workspace, 'release-linux-server', 'linux-unpacked'),
    executable: 'voiceup-server',
    main: 'server-host-main.js',
    expectedName: 'voiceup-server',
    expectedProductName: 'VoiceUPServer',
    requiredFiles: ['server-host-main.js', path.join('host', 'index.html')],
    output: path.join(workspace, 'release-linux-server'),
    productName: 'VoiceUPServer'
  }
];

function hasElfSignature(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    fs.readSync(descriptor, header, 0, header.length, 0);
    return header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally { fs.closeSync(descriptor); }
}

function allFiles(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  visit(directory);
  return result;
}

for (const item of packages) {
  assert.ok(fs.existsSync(item.directory), `${item.label}: runtime Linux ausente.`);
  const executable = path.join(item.directory, item.executable);
  assert.ok(fs.existsSync(executable), `${item.label}: executável Linux ausente.`);
  assert.equal(hasElfSignature(executable), true, `${item.label}: o runtime não é um ELF Linux.`);

  const appAsar = path.join(item.directory, 'resources', 'app.asar');
  assert.ok(fs.existsSync(appAsar), `${item.label}: app.asar ausente.`);
  const entries = new Set(asar.listPackage(appAsar).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')));
  for (const requiredFile of item.requiredFiles) {
    assert.equal(entries.has(requiredFile.replaceAll('\\', '/')), true, `${item.label}: ${requiredFile} ausente do app.asar.`);
  }
  const windowsAppEntries = [...entries].filter((entry) => /\.exe$/i.test(entry));
  assert.deepEqual(windowsAppEntries, [], `${item.label}: executável Windows incluído no app.asar.`);
  const updater = asar.extractFile(appAsar, 'update-helper.js').toString();
  assert.match(updater, /packageUnavailable/, `${item.label}: atualizador Linux sem proteção para pacote não verificado.`);
  const metadata = JSON.parse(asar.extractFile(appAsar, 'package.json').toString());
  assert.equal(metadata.main, item.main, `${item.label}: ponto de entrada incorreto.`);
  assert.equal(metadata.name, item.expectedName, `${item.label}: identidade de pacote incorreta.`);
  if (item.expectedProductName) assert.equal(metadata.productName, item.expectedProductName, `${item.label}: productName incorreto.`);
  assert.equal(metadata.desktopName, item.label === 'Cliente' ? 'com.voiceup.app.desktop' : 'com.goatgank.voiceup.server.desktop', `${item.label}: desktopName incorreto.`);

  const windowsExecutables = allFiles(item.directory).filter((file) => /\.exe$/i.test(file));
  assert.deepEqual(windowsExecutables, [], `${item.label}: arquivo Windows incluído indevidamente.`);

  if (release) {
    for (const extension of ['AppImage', 'deb']) {
      const artifact = path.join(item.output, `${item.productName}-${version}-linux-x64.${extension}`);
      assert.ok(fs.existsSync(artifact), `${item.label}: pacote ${extension} ausente.`);
      assert.ok(fs.statSync(artifact).size > 1024 * 1024, `${item.label}: pacote ${extension} pequeno demais.`);
    }
  }
}

console.log(`Pacotes Linux ${release ? 'finais e ' : ''}desempacotados validados para Cliente e ServerHost.`);
