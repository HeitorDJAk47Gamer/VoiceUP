'use strict';

// Monta somente a edição Linux da beta local. Não publica, cria tags ou altera
// o catálogo assinado usado pelo site e pelo atualizador.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) throw new Error('A versão atual precisa ser uma beta desktop.');

const output = path.join(root, `test-v${version}`);
const linuxOutput = path.join(output, 'Linux');
const sources = [
  { directory: 'release-beta-platform-linux', product: 'VoiceUP', executable: 'voiceup' },
  { directory: 'release-beta-platform-linux-server', product: 'VoiceUPServer', executable: 'voiceup-server' }
];

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function packageRuntime({ directory, product, executable }) {
  const unpacked = path.join(root, directory, 'linux-unpacked');
  const metadata = JSON.parse(require('@electron/asar').extractFile(path.join(unpacked, 'resources', 'app.asar'), 'package.json'));
  if (metadata.version !== version) throw new Error(`${product}: runtime ${metadata.version}, esperado ${version}.`);
  const archive = path.join(linuxOutput, `${product}-${version}-linux-x64.tar.gz`);
  await tar.c({
    gzip: true,
    portable: true,
    file: archive,
    cwd: unpacked,
    prefix: `${product}-${version}`,
    onWriteEntry(entry) {
      const name = path.basename(entry.path);
      const executableFile = [executable, 'chrome-sandbox', 'chrome_crashpad_handler'].includes(name);
      entry.stat.mode = (entry.stat.mode & ~0o7777) | (entry.stat.isDirectory() || executableFile ? 0o755 : 0o644);
    }
  }, ['.']);
  const checked = new Set();
  await tar.t({ file: archive, onReadEntry(entry) {
    const name = path.posix.basename(entry.path);
    if ([executable, 'chrome-sandbox', 'chrome_crashpad_handler'].includes(name)) {
      if (!(entry.mode & 0o111)) throw new Error(`${product}: sem permissão de execução em ${entry.path}.`);
      checked.add(name);
    }
  }});
  if (checked.size !== 3) throw new Error(`${product}: executáveis Linux obrigatórios ausentes.`);
  return archive;
}

(async () => {
  fs.mkdirSync(linuxOutput, { recursive: true });
  const archives = [];
  for (const source of sources) archives.push(await packageRuntime(source));
  const guide = path.join(linuxOutput, 'LEIA-ME-LINUX.md');
  fs.writeFileSync(guide, `# VoiceUP ${version} para Linux\n\nEsta beta usa a mesma base funcional da edição Windows ${version} e não foi publicada.\n\n## Executar\n\nExtraia o pacote e, dentro da pasta extraída, use:\n\n\`\`\`bash\nchmod +x voiceup chrome-sandbox chrome_crashpad_handler\n./voiceup\n\`\`\`\n\nNo ServerHost, substitua \`voiceup\` por \`voiceup-server\`. Execute como usuário normal, sem \`sudo\` e sem \`--no-sandbox\`. O Electron já está incluído.\n\nO áudio isolado da tela ou aplicativo continua indisponível no Linux. No Wayland, a captura depende de PipeWire e xdg-desktop-portal. A execução real em Linux ainda precisa ser conferida; as validações deste pacote foram estruturais no Windows.\n`, 'utf8');
  const manifestPath = path.join(output, 'SHA256.txt');
  const preserved = fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(line => line && !/  Linux\//.test(line))
    : [];
  const generated = [...archives, guide].map(file => `${sha256(file)}  ${path.relative(output, file).replaceAll('\\', '/')}`);
  fs.writeFileSync(manifestPath, `${[...preserved, ...generated].sort().join('\n')}\n`, 'utf8');
  console.log(`Linux ${version}: Cliente e ServerHost adicionados a ${output}`);
  for (const line of generated) console.log(line);
})().catch(error => { console.error(error); process.exitCode = 1; });
