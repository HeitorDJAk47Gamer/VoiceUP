// Local-only bundle: never uploads artifacts or changes updater configuration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tar = require('tar');

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const mobileVersion = require('../mobile/package.json').version;
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) throw new Error('Expected a desktop beta.');
if (!/^\d+\.\d+\.\d+-mobile-beta\.\d+$/.test(mobileVersion)) throw new Error('Expected a mobile beta.');
const output = path.join(root, `test-v${version}`);
const hashes = [];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function record(file) {
  hashes.push(`${digest(file)}  ${path.relative(output, file).replaceAll('\\', '/')}`);
}

function copy(source, target) {
  const destination = path.join(output, target);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, source), destination);
  record(destination);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  for (const [source, target, executable] of [
    ['release-beta-platform-client', 'Client', 'VoiceUP.exe'],
    ['release-beta-platform-server', 'ServerHost', 'VoiceUPServer.exe']
  ]) {
    const destination = path.join(output, target);
    fs.cpSync(path.join(root, source, 'win-unpacked'), destination, { recursive: true });
    record(path.join(destination, executable));
    record(path.join(destination, 'resources', 'app.asar'));
    const installer = `${target === 'Client' ? 'VoiceUP' : 'VoiceUPServer'} Setup ${version}.exe`;
    copy(`${source}/${installer}`, `Instaladores/${installer}`);
    copy(`${source}/${installer}.blockmap`, `Instaladores/${installer}.blockmap`);
  }
  copy(`.store-build/VoiceUP ${version}.appx`, `Store/VoiceUP ${version}.appx`);
  copy(`test-${mobileVersion}/VoiceUP-${mobileVersion}.apk`, `Android/VoiceUP-${mobileVersion}.apk`);
  for (const file of ['VoiceUP-SelfWeb.html', 'LEIA-ME.md', 'THIRD-PARTY-LICENSES.txt', 'manifest.json', 'runtime-test-results.json']) {
    copy(`selfweb/dist/${file}`, `SelfWeb/${file}`);
  }
  copy(`deploy/VoiceUP-Server-Cloud-${version}-linux-downloads.zip`, `Cloud/VoiceUP-Server-Cloud-${version}.zip`);

  for (const [source, product, executable] of [
    ['release-beta-platform-linux', 'VoiceUP', 'voiceup'],
    ['release-beta-platform-linux-server', 'VoiceUPServer', 'voiceup-server']
  ]) {
    const file = path.join(output, 'Linux', `${product}-${version}-linux-x64.tar.gz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await tar.c({
      gzip: true, portable: true, file,
      cwd: path.join(root, source, 'linux-unpacked'),
      prefix: `${product}-${version}`,
      onWriteEntry(entry) {
        // Windows does not retain POSIX executable bits in unpacked builds.
        const name = path.basename(entry.path);
        const executableFile = [executable, 'chrome-sandbox', 'chrome_crashpad_handler'].includes(name);
        entry.stat.mode = (entry.stat.mode & ~0o7777) | (entry.stat.isDirectory() || executableFile ? 0o755 : 0o644);
      }
    }, ['.']);
    const checked = new Set();
    await tar.t({file, onReadEntry(entry) {
      const name = path.posix.basename(entry.path);
      if ([executable, 'chrome-sandbox', 'chrome_crashpad_handler'].includes(name)) {
        if (!(entry.mode & 0o111)) throw new Error(`Missing executable permission: ${entry.path}`);
        checked.add(name);
      }
    }});
    if (checked.size !== 3) throw new Error(`${product}: missing Linux executable helpers.`);
    record(file);
    console.log(`Packaged ${path.basename(file)} with executable permissions.`);
  }
  fs.writeFileSync(path.join(output, 'SHA256.txt'), `${hashes.join('\n')}\n`);
  console.log(`Local test bundle: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
