'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const integrity = require('../public/release-integrity');
const trust = require('../public/release-trust');

function classify(name, version) {
  if (name === `VoiceUP.Setup.${version}.exe`) return ['client', 'windows', 'x64'];
  if (name === `VoiceUPServer.Setup.${version}.exe`) return ['serverhost', 'windows', 'x64'];
  if (name === `VoiceUP.${version}.appx`) return ['client', 'store', 'x64'];
  if (name === `VoiceUP-${version}-android.apk`) return ['client', 'android', 'universal'];
  if (name === 'VoiceUP-SelfWeb.html') return ['selfweb', 'web', 'universal'];
  if (name === `VoiceUP-Server-Cloud-${version}.zip`) return ['cloud', 'node', 'universal'];
  for (const [prefix, product] of [['VoiceUP', 'client'], ['VoiceUPServer', 'serverhost']]) {
    for (const arch of ['x64', 'arm64']) for (const ext of ['AppImage', 'deb', 'tar.gz']) {
      if (name === `${prefix}-${version}-linux-${arch}.${ext}`) return [product, 'linux', arch];
    }
  }
  return null;
}
function signDirectory(directory, version, encodedKey) {
  const key = crypto.createPrivateKey({ key: Buffer.from(encodedKey || '', 'base64'), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(key).export({ format: 'jwk' });
  if (pub.x !== trust.publicKey.x || pub.crv !== 'Ed25519') throw new Error('A chave privada não corresponde à chave pública fixada nos aplicativos.');
  const artifacts = fs.readdirSync(directory).sort().flatMap(name => {
    const type = classify(name, version); if (!type) return [];
    const [product, platform, arch] = type;
    const file = fs.readFileSync(path.join(directory, name));
    return [{ name, product, platform, arch, size: file.length, sha256: crypto.createHash('sha256').update(file).digest('hex'), url: integrity.assetUrl(version, name) }];
  });
  const data = Buffer.from(JSON.stringify({ schema: 1, repository: integrity.repository, version, createdAt: new Date().toISOString(), artifacts }));
  const envelope = { schema: 1, keyId: trust.keyId, payload: data.toString('base64'), signature: crypto.sign(null, data, key).toString('base64') };
  integrity.verifySync(envelope, version);
  return envelope;
}
function verifyDirectory(directory, envelope) {
  const payload = integrity.verifySync(envelope);
  for (const entry of payload.artifacts) {
    const file = fs.readFileSync(path.join(directory, entry.name));
    if (file.length !== entry.size || crypto.createHash('sha256').update(file).digest('hex') !== entry.sha256) throw new Error(`Arquivo alterado: ${entry.name}`);
  }
  return payload;
}
if (require.main === module) {
  const [command, directory, value, output] = process.argv.slice(2);
  if (command === 'sign') {
    const envelope = signDirectory(directory, value, process.env.VOICEUP_RELEASE_PRIVATE_KEY);
    fs.writeFileSync(output || path.join(directory, `VoiceUP-Release-${value}.json`), JSON.stringify(envelope, null, 2) + '\n');
    console.log(`Manifesto ${value} assinado; chave privada não incluída.`);
  } else if (command === 'verify') {
    const payload = verifyDirectory(directory, JSON.parse(fs.readFileSync(value, 'utf8')));
    console.log(`${payload.version}: ${payload.artifacts.length} arquivos verificados com Ed25519 e SHA-256.`);
  } else throw new Error('Uso: release-artifacts.js sign <pasta> <versão> [manifesto] | verify <pasta> <manifesto>');
}
module.exports = { classify, signDirectory, verifyDirectory };
