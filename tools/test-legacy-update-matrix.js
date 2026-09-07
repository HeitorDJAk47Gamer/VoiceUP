'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');

const workspace = path.resolve(__dirname, '..');
const releaseVersion = require('../package.json').version;
const products = [
  ['client', 'VoiceUP Setup ', `VoiceUP.Setup.${releaseVersion}.exe`],
  ['serverhost', 'VoiceUPServer Setup ', `VoiceUPServer.Setup.${releaseVersion}.exe`]
];
const releaseAssets = products.map(([, , name]) => ({
  name,
  browser_download_url: `https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/download/v${releaseVersion}/${name}`
}));

function fakeHttps() {
  return {
    get(url, _options, callback) {
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = (error) => { if (error) queueMicrotask(() => request.emit('error', error)); };
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.resume = () => {};
        response.setEncoding = () => {};
        response.headers = {};
        if (String(url).includes('api.github.com')) {
          response.statusCode = 200;
          callback(response);
          queueMicrotask(() => {
            response.emit('data', JSON.stringify({ tag_name: `v${releaseVersion}`, draft: false, prerelease: false, assets: releaseAssets }));
            response.emit('end');
          });
          return;
        }
        response.statusCode = 302;
        response.headers.location = `https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/tag/v${releaseVersion}`;
        callback(response);
      });
      return request;
    }
  };
}

async function checkTag(tag, installedVersion, prefix) {
  const source = execFileSync('git', ['show', `${tag}:update-helper.js`], { cwd: workspace, encoding: 'utf8', windowsHide: true });
  const handlers = new Map();
  const electron = { app: { getVersion: () => installedVersion, getPath: () => workspace }, shell: { openPath: async () => '' } };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'https') return fakeHttps();
      return require(name);
    },
    module,
    console,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    queueMicrotask
  }, { filename: `${tag}-update-helper.js` });
  module.exports.registerUpdateHandlers({ handle: (name, handler) => handlers.set(name, handler) }, prefix);
  const result = await handlers.get('update:check')();
  assert.equal(result.ok, true, `${tag}: ${result.message || 'falha ao consultar'}`);
  assert.equal(result.available, true, `${tag} precisa reconhecer ${releaseVersion} como mais nova`);
  assert.equal(result.version, releaseVersion);
  return result;
}

(async () => {
  const compatible = [];
  const manualTransition = [];
  for (const tag of ['v1.0.25', 'v1.1.0', 'v1.1.1', 'v1.1.2']) {
    for (const [product, prefix, expectedName] of products) {
      const result = await checkTag(tag, tag.slice(1), prefix);
      if (['v1.1.0', 'v1.1.1'].includes(tag)) {
        assert.match(result.downloadUrl, /%20/, `${tag} deve continuar documentada como transição manual`);
        manualTransition.push(`${tag}:${product}`);
      } else {
        assert.equal(result.assetName, expectedName, `${tag}:${product} precisa manter o nome histórico`);
        assert.ok(result.downloadUrl.endsWith(`/${expectedName}`), `${tag}:${product} precisa apontar ao arquivo público exato`);
        compatible.push(`${tag}:${product}`);
      }
    }
  }
  assert.deepEqual(compatible, ['v1.0.25:client', 'v1.0.25:serverhost', 'v1.1.2:client', 'v1.1.2:serverhost']);
  assert.deepEqual(manualTransition, ['v1.1.0:client', 'v1.1.0:serverhost', 'v1.1.1:client', 'v1.1.1:serverhost']);
  console.log(`PASS atualizações antigas: 1.0.25 e 1.1.2 resolvem os nomes ${releaseVersion}; 1.1.0/1.1.1 permanecem corretamente sinalizadas como transição manual por causa da URL já embutida.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
