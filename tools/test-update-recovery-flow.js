'use strict';
// Exercise the real IPC download/recovery flow with deterministic transport
// and signature boundaries; never download or launch a real installer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-update-flow-'));
const bytes = Buffer.alloc(1024 * 1024, 42);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const asset = { name: 'VoiceUP.Setup.1.2.3.exe', browser_download_url: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/download/v1.2.3/VoiceUP.Setup.1.2.3.exe', digest: `sha256:${hash}`, size: bytes.length };
const entry = { url: asset.browser_download_url, sha256: hash, size: bytes.length };
const handlers = {}, progress = [];
let downloads = 0, launches = 0, failLaunch = true, signatureValid = true, version = '1.2.1';
const electron = { app: { getPath: () => directory, getVersion: () => version, quit() {} }, shell: {} };
const integrity = { verifySync() { if (!signatureValid) throw Error('Invalid signature'); return {}; }, select: () => entry };
const context = vm.createContext({ Buffer, console, process, setTimeout: () => 0, module: { exports: {} },
  require(name) { if (name === 'electron') return electron; if (name === './public/release-integrity') return integrity; if (name === './update-recovery') return require('../update-recovery'); return require(name); },
  metadata: { version: '1.2.3', assets: [asset] },
  fakeDownload: async (_url, target) => { downloads++; fs.writeFileSync(target, bytes); },
  fakeLaunch: async () => { launches++; if (failLaunch) throw Error('Launch failed'); return ''; }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../update-helper.js'), 'utf8') + `
latestReleaseMetadata = async () => metadata;
signedReleaseEnvelope = async () => ({keyId:'test'});
download = fakeDownload;
launchVerifiedUpdate = fakeLaunch;`, context);
context.module.exports.registerUpdateHandlers({ handle: (key, callback) => { handlers[key] = callback; } }, 'VoiceUP Setup ', event => event.trusted);
const event = { trusted: true, sender: { send: (_key, value) => progress.push(value), isDestroyed: () => false } };
(async () => {
  fs.writeFileSync(path.join(directory, 'profile.json'), 'profile-sentinel');
  assert.equal((await handlers['update:download']({ trusted: false })).ok, false);
  assert.equal(downloads, 0);
  assert.equal((await handlers['update:download'](event)).ok, false);
  assert.equal(downloads, 1); assert.equal(launches, 1);
  assert.equal((await handlers['update:recovery'](event)).pending, true);
  failLaunch = false;
  assert.equal((await handlers['update:download'](event)).ok, true);
  assert.equal(downloads, 1, 'valid cache must be reused only after verification');
  assert.equal(launches, 2);
  const candidate = path.join(directory, 'update-recovery-client', hash + '.exe');
  fs.writeFileSync(candidate, 'corrupted');
  assert.equal((await handlers['update:download'](event)).ok, true);
  assert.equal(downloads, 2, 'corrupt cache must be replaced, never launched');
  signatureValid = false;
  assert.equal((await handlers['update:download'](event)).ok, false);
  assert.equal(launches, 3, 'signature failure must block even an intact cached installer');
  version = '1.2.3';
  assert.equal((await handlers['update:recovery'](event)).pending, false);
  assert.equal(fs.readFileSync(path.join(directory, 'profile.json'), 'utf8'), 'profile-sentinel');
  assert.ok(progress.some(item => item.phase === 'error'));
  console.log('PASS real update IPC flow: denied sender, launch failure, verified cache reuse, corruption, signature rejection, completed version and profile preservation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
