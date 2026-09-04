'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const integrity = require('../public/release-integrity');
const current = require('../update-helper');
const version = require('../package.json').version;
async function main() {
  const response = await fetch('https://api.github.com/repos/HeitorDJAk47Gamer/VoiceUP/releases/latest', { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const release = await response.json();
  assert.equal(release.tag_name, `v${version}`);
  assert.equal(release.prerelease, false);
  assert.equal(release.draft, false);
  const envelopeResponse = await fetch(integrity.assetUrl(version, `VoiceUP-Release-${version}.json`), { signal: AbortSignal.timeout(30000) });
  assert.equal(envelopeResponse.status, 200);
  const envelope = await envelopeResponse.json();
  const payload = integrity.verifySync(envelope, version);
  for (const file of payload.artifacts) {
    const asset = release.assets.find(asset => asset.name === file.name);
    assert.ok(asset, `Arquivo público ausente: ${file.name}`);
    assert.equal(asset.digest, `sha256:${file.sha256}`);
    assert.equal(asset.size, file.size);
    assert.equal(asset.browser_download_url, file.url);
    const head = await fetch(file.url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    assert.equal(head.status, 200, `Link quebrado: ${file.name}`);
    assert.equal(Number(head.headers.get('content-length')), file.size);
  }
  const legacy = execFileSync('git', ['show', 'v1.1.2:update-helper.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', windowsHide: true });
  const folder = path.join(__dirname, '../.release-tools/public-updater-check');
  fs.mkdirSync(folder, { recursive: true });
  for (const [product, prefix] of [['client', 'VoiceUP Setup '], ['serverhost', 'VoiceUPServer Setup ']]) {
    const handlers = new Map();
    let downloaded;
    const electron = {
      app: { getVersion: () => '1.1.2', getPath: () => folder },
      // Do not launch/install anything. Test the download and verification only.
      shell: { openPath: async file => { downloaded = file; return ''; } }
    };
    const module = { exports: {} };
    vm.runInNewContext(legacy, { require: name => name === 'electron' ? electron : require(name), module, console }, { filename: 'updater-v1.1.2.js' });
    module.exports.registerUpdateHandlers({ handle: (name, handler) => handlers.set(name, handler) }, prefix);
    const check = await handlers.get('update:check')();
    assert.equal(check.ok, true, check.message);
    assert.equal(check.available, true);
    assert.equal(check.version, version);
    const entry = integrity.select(payload, product, 'windows', 'x64');
    assert.equal(check.downloadUrl, entry.url);
    const result = await handlers.get('update:download')();
    assert.equal(result.ok, true, result.message);
    const verified = await current.verifyDownloadedUpdate(downloaded, { assetName: entry.name, downloadUrl: entry.url, digest: `sha256:${entry.sha256}`, size: entry.size, version, envelope, platform: 'win32', arch: 'x64', product });
    assert.equal(verified.digest, entry.sha256);
    console.log(`${product}: atualizador real 1.1.2 localizou e baixou a versão ${version}; assinatura e bytes conferidos. Nenhum instalador foi executado.`);
  }
  console.log(`${payload.artifacts.length} links públicos validados, sem 404.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
