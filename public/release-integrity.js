/* Shared release verification. No private keys, no automatic network requests. */
(function (scope) {
  'use strict';
  const isNode = typeof module === 'object' && Boolean(module.exports);
  const trust = isNode ? require('./release-trust.js') : scope.voiceupReleaseTrust;
  const repository = 'HeitorDJAk47Gamer/VoiceUP';
  const maxManifestBytes = 256 * 1024;
  const bytes = value => isNode ? Buffer.from(value, 'base64') : Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(bytes(value));
  function assetUrl(version, name) {
    return `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}`;
  }
  function validatePayload(payload, expectedVersion) {
    if (payload.schema !== 1 || payload.repository !== repository || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(payload.version)) throw new Error('Manifesto de atualização inválido.');
    if (expectedVersion && payload.version !== expectedVersion) throw new Error('A versão assinada não corresponde à Release.');
    if (!Array.isArray(payload.artifacts) || !payload.artifacts.length || payload.artifacts.length > 40) throw new Error('Lista de arquivos inválida.');
    const names = new Set();
    for (const file of payload.artifacts) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(file.name) || names.has(file.name)) throw new Error('Nome de arquivo de atualização inválido.');
      names.add(file.name);
      if (!['client', 'serverhost', 'cloud', 'selfweb'].includes(file.product) || !['windows', 'linux', 'android', 'store', 'web', 'node'].includes(file.platform)) throw new Error('Plataforma de atualização inválida.');
      if (!['x64', 'arm64', 'universal'].includes(file.arch) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 * 1024 * 1024) throw new Error('Integridade do arquivo inválida.');
      if (file.url !== assetUrl(payload.version, file.name)) throw new Error('O arquivo não pertence à Release oficial.');
    }
    return payload;
  }
  function parseEnvelope(envelope) {
    if (!envelope || envelope.schema !== 1 || envelope.keyId !== trust.keyId || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || envelope.payload.length > maxManifestBytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error('Assinatura da atualização ausente ou inválida.');
    return { data: bytes(envelope.payload), signature: bytes(envelope.signature) };
  }
  function verifySync(envelope, expectedVersion) {
    if (!isNode) throw new Error('Use a verificação assíncrona neste navegador.');
    const crypto = require('node:crypto');
    const { data, signature } = parseEnvelope(envelope);
    if (!crypto.verify(null, data, { key: trust.publicKey, format: 'jwk' }, signature)) throw new Error('A assinatura da atualização foi recusada.');
    return validatePayload(JSON.parse(decode(envelope.payload)), expectedVersion);
  }
  async function verify(envelope, expectedVersion) {
    if (isNode) return verifySync(envelope, expectedVersion);
    const { data, signature } = parseEnvelope(envelope);
    if (!scope.crypto?.subtle) throw new Error('Este navegador não consegue verificar atualizações. Use um navegador atualizado.');
    const key = await scope.crypto.subtle.importKey('jwk', trust.publicKey, { name: 'Ed25519' }, false, ['verify']);
    if (!await scope.crypto.subtle.verify('Ed25519', key, signature, data)) throw new Error('A assinatura da atualização foi recusada.');
    return validatePayload(JSON.parse(decode(envelope.payload)), expectedVersion);
  }
  function select(payload, product, platform, arch, name) {
    const file = payload.artifacts.find(file => file.product === product && file.platform === platform && file.arch === arch && (!name || file.name === name));
    if (!file) throw new Error('Não há pacote assinado para esta plataforma.');
    return file;
  }
  const api = Object.freeze({ repository, maxManifestBytes, assetUrl, verify, verifySync, select });
  if (isNode) module.exports = api;
  else scope.voiceupReleaseIntegrity = api;
})(globalThis);
