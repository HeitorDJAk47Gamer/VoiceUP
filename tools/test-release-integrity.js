'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const trust = require('../public/release-trust');
const realVerifier = require('../public/release-integrity');
const { classify } = require('./release-artifacts');
const pair = crypto.generateKeyPairSync('ed25519');
const testTrust = { keyId: trust.keyId, publicKey: pair.publicKey.export({ format: 'jwk' }) };
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/release-integrity.js'), 'utf8');
const context = vm.createContext({ module: { exports: {} }, Buffer, TextDecoder, require: id => id === './release-trust.js' ? testTrust : require(id) });
vm.runInContext(source, context);
const verifier = context.module.exports;
const payload = { schema: 1, repository: realVerifier.repository, version: '1.2.0', artifacts: [{name:'VoiceUP.Setup.1.2.0.exe',product:'client',platform:'windows',arch:'x64',size:1024,sha256:'a'.repeat(64),url:realVerifier.assetUrl('1.2.0','VoiceUP.Setup.1.2.0.exe')}] };
function signed(value = payload, privateKey = pair.privateKey) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { schema: 1, keyId: testTrust.keyId, payload: bytes.toString('base64'), signature: crypto.sign(null, bytes, privateKey).toString('base64') };
}
test('signature verifies in Node and WebCrypto using identical bytes', async () => {
  assert.equal(verifier.verifySync(signed(), '1.2.0').version, '1.2.0');
  const browser = vm.createContext({ voiceupReleaseTrust: testTrust, crypto: crypto.webcrypto, TextDecoder, Uint8Array, atob });
  vm.runInContext(source, browser);
  assert.equal((await browser.voiceupReleaseIntegrity.verify(signed(), '1.2.0')).version, '1.2.0');
});
test('production key does not trust the ephemeral test key', () => assert.throws(() => realVerifier.verifySync(signed()), /assinatura/));
test('modified payload and signature are rejected', () => {
  const envelope = signed(); envelope.payload = Buffer.from(JSON.stringify({...payload,version:'1.2.1'})).toString('base64');
  assert.throws(() => verifier.verifySync(envelope), /assinatura/);
  assert.throws(() => verifier.verifySync({...signed(),signature:Buffer.alloc(64).toString('base64')}), /assinatura/);
});
test('another key or unexpected release version cannot be substituted', () => {
  assert.throws(() => verifier.verifySync(signed(payload,crypto.generateKeyPairSync('ed25519').privateKey)), /assinatura/);
  assert.throws(() => verifier.verifySync(signed(),'1.2.1'), /versão/);
  assert.throws(() => verifier.verifySync({...signed(),keyId:'other'}), /Assinatura/);
});
test('signed but unsafe repositories, paths, URLs and sizes are rejected', () => {
  for (const patch of [{repository:'other/repo'},{version:'../../a'},{artifacts:[]},{artifacts:[payload.artifacts[0],payload.artifacts[0]]}]) assert.throws(() => verifier.verifySync(signed({...payload,...patch})));
  for (const patch of [{name:'../p.exe'},{url:'http://evil.example/a.exe'},{size:0},{size:2**31},{sha256:'b'},{platform:'freeform'}]) assert.throws(() => verifier.verifySync(signed({...payload,artifacts:[{...payload.artifacts[0],...patch}]})));
});
test('selecting a different product, architecture or OS fails closed', () => {
  const verified = verifier.verifySync(signed());
  assert.equal(verifier.select(verified,'client','windows','x64').name,payload.artifacts[0].name);
  for (const tuple of [['serverhost','windows','x64'],['client','linux','x64'],['client','windows','arm64']]) assert.throws(() => verifier.select(verified,...tuple));
});
test('strict artifact naming preserves Windows legacy updater URLs', () => {
  assert.deepEqual(classify('VoiceUP.Setup.1.2.0.exe','1.2.0'),['client','windows','x64']);
  assert.deepEqual(classify('VoiceUPServer.Setup.1.2.0.exe','1.2.0'),['serverhost','windows','x64']);
  assert.equal(classify('VoiceUP Setup 1.2.0.exe','1.2.0'),null);
  assert.equal(classify('VoiceUP.Setup.1.1.2.exe','1.2.0'),null);
});
