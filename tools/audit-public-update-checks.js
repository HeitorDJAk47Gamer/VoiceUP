'use strict';
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'update-helper.js'));
(async () => {
  const results = [];
  for (const tag of ['v1.0.25', 'v1.1.0', 'v1.1.1', 'v1.1.2', 'v1.2.0', 'v1.2.1']) {
    const source = execFileSync('git', ['show', `${tag}:update-helper.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
    for (const prefix of ['VoiceUP Setup ', 'VoiceUPServer Setup ']) {
      const handlers = new Map(), module = { exports: {} };
      const electron = { app: { getVersion: () => tag.slice(1), getPath: () => root }, shell: { openPath: async () => { throw Error('Install forbidden in audit'); } } };
      vm.runInNewContext(source, { require: name => name === 'electron' ? electron : localRequire(name), module, console, process, Buffer, URL, setTimeout, clearTimeout, queueMicrotask }, { filename: `${tag}/update-helper.js` });
      module.exports.registerUpdateHandlers({ handle: (name, fn) => handlers.set(name, fn) }, prefix);
      const result = await handlers.get('update:check')();
      results.push({ installed: tag, product: prefix.trim(), ok: result.ok, available: result.available, offered: result.version, asset: result.assetName, url: result.downloadUrl, message: result.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => !result.ok)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
