'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = require('./package.json');
const sourceVersion = require('../package.json').version;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const inputs = {};
function read(relative) {
  const data = fs.readFileSync(path.join(root, relative));
  inputs[relative.replaceAll('\\', '/')] = sha256(data);
  return data.toString('utf8').replace(/\r\n/g, '\n');
}
function adaptScript(source, file) {
  // Preserve Desktop source/protocol identifiers. Only storage accesses and
  // local product metadata are specialized in the generated Web edition.
  source = source.replace(/\blocalStorage\.(getItem|setItem|removeItem)/g, 'window.voiceupSelfWebStorage.local.$1')
    .replace(/\bsessionStorage\.(getItem|setItem|removeItem)/g, 'window.voiceupSelfWebStorage.session.$1');
  if (file === 'app.js') {
    const versionLine = /^window\.voiceupVersion = [^\n]+;/m;
    if (!versionLine.test(source)) throw new Error('Não foi possível localizar a versão do Client.');
    source = source.replace(versionLine, `window.voiceupVersion = ${JSON.stringify(manifest.version)};`)
      .replace('"url(\'../assets/voiceup-logo.png\')"', '`url("${window.voiceupSelfWebLogo}")`');
  }
  return source;
}
function build() {
  let html = read('public/index.html');
  const licenseFiles=['socket.io-client/LICENSE','engine.io-client/LICENSE','engine.io-parser/LICENSE','socket.io-parser/LICENSE','@socket.io/component-emitter/LICENSE','debug/LICENSE','ms/license.md'];
  const licenses=licenseFiles.map((file)=>`${file}\n\n${read(`node_modules/${file}`)}`).join('\n\n--------------------\n\n');
  const logo = fs.readFileSync(path.join(root, 'assets/voiceup-icon.ico'));
  inputs['assets/voiceup-icon.ico'] = sha256(logo);
  const logoUrl = `data:image/x-icon;base64,${logo.toString('base64')}`;
  const bootstrap = `window.voiceupSelfWebLogo = ${JSON.stringify(logoUrl)};\nwindow.voiceupSelfWebBuild = Object.freeze(${JSON.stringify({version:manifest.version,sourceVersion})});\n${read('selfweb/bootstrap.js')}`;
  const scriptSources = [
    ['socket.io-client', read('node_modules/socket.io-client/dist/socket.io.min.js').replace(/\/\/# sourceMappingURL=.*$/gm, '')],
    ['selfweb/bootstrap.js', bootstrap]
  ];
  for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const file = match[1];
    // Socket.IO is embedded; native RNNoise and desktop release/update UI
    // are deliberately not included in the browser-only edition.
    if (['socket-loader.js', 'rnnoise-engine.js', 'release-notes.js'].includes(file)) continue;
    scriptSources.push([file, adaptScript(read(`public/${file}`), file)]);
  }
  scriptSources.push(['selfweb/browser.js', read('selfweb/browser.js')]);
  const hashes = [];
  const scripts = scriptSources.map(([file, content]) => {
    const code = `// ${file}\n${content}`.replace(/<\/script/gi, '<\\/script');
    new vm.Script(code, {filename:file});
    hashes.push(`'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`);
    return `<script>${code}</script>`;
  }).join('\n');
  html = html.replace(/<script src="[^"]+"><\/script>/g, '');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)"\/>/g, (_, file) => `<style>/* ${file} */\n${read(`public/${file}`).replace(/<\/style/gi, '<\\/style')}</style>`);
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: blob: https: http:; media-src data: blob: https: http:; connect-src https: http: wss: ws:; font-src data:; frame-src https://www.youtube-nocookie.com; worker-src blob:"/>`);
  html = html.replace('<title>VoiceUP</title>', '<title>VoiceUP SelfWeb</title>')
    .replace('<body>', '<body class="selfweb">')
    .replace('<meta name="viewport"', '<meta name="referrer" content="no-referrer"/><meta name="viewport"')
    .replace('</head>', `<link rel="icon" href="${logoUrl}"/><style>\n${read('selfweb/browser.css')}</style></head>`)
    .replace('</body>', `<noscript>Ative o JavaScript do navegador para usar o VoiceUP SelfWeb.</noscript>\n<!-- Licenças de componentes distribuídos neste arquivo:\n${licenses.replaceAll('--','—')}\n-->\n${scripts}\n</body>`);
  const out = path.join(__dirname, 'dist');
  fs.mkdirSync(out, {recursive:true});
  fs.writeFileSync(path.join(out, 'VoiceUP-SelfWeb.html'), html);
  // Stage the identical standalone file for the website; this never deploys it.
  const siteDownloads = path.join(root, 'deploy/shardcloud/downloads');
  fs.mkdirSync(siteDownloads, {recursive:true});
  fs.writeFileSync(path.join(siteDownloads, 'VoiceUP-SelfWeb.html'), html);
  fs.copyFileSync(path.join(__dirname, 'README.md'), path.join(out, 'LEIA-ME.md'));
  fs.writeFileSync(path.join(out, 'THIRD-PARTY-LICENSES.txt'), licenses);
  const result = {version:manifest.version, sourceVersion, file:'VoiceUP-SelfWeb.html', bytes:Buffer.byteLength(html), sha256:sha256(html), inputs};
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(result,null,2)+'\n');
  console.log(`VoiceUP SelfWeb ${result.version}: ${(result.bytes/1024/1024).toFixed(2)} MB\n${path.join(out,result.file)}\nSHA-256 ${result.sha256}`);
  return result;
}
if (require.main === module) build();
module.exports = {build, adaptScript};
