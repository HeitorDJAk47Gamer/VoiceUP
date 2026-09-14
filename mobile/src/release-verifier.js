const KEY_ID = 'voiceup-release-2026-01';
const PUBLIC_KEY = Object.freeze({ kty: 'OKP', crv: 'Ed25519', x: 'St3RskjUQgTUFCHpUQOWZHrtoR5cld-4XRz0q0Hgeso' });
const REPOSITORY = 'HeitorDJAk47Gamer/VoiceUP';
const MAX_MANIFEST_BYTES = 256 * 1024;

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function assetUrl(version, name) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(name)}`;
}

function validatePayload(payload) {
  if (payload?.schema !== 1 || payload.repository !== REPOSITORY || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(payload.version)) throw new Error('Manifesto de atualização inválido.');
  if (!Array.isArray(payload.artifacts) || !payload.artifacts.length || payload.artifacts.length > 40) throw new Error('Lista de arquivos de atualização inválida.');
  const names = new Set();
  for (const file of payload.artifacts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(file?.name) || names.has(file.name)) throw new Error('Nome de arquivo de atualização inválido.');
    names.add(file.name);
    if (!['client', 'serverhost', 'cloud', 'selfweb'].includes(file.product) || !['windows', 'linux', 'android', 'store', 'web', 'node'].includes(file.platform)) throw new Error('Plataforma de atualização inválida.');
    if (!['x64', 'arm64', 'universal'].includes(file.arch) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 * 1024 * 1024) throw new Error('Integridade do arquivo de atualização inválida.');
    if (file.url !== assetUrl(payload.version, file.name)) throw new Error('O arquivo não pertence à Release oficial.');
  }
  return payload;
}

export async function verifyReleaseEnvelope(envelope) {
  if (!envelope || envelope.schema !== 1 || envelope.keyId !== KEY_ID || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || envelope.payload.length > MAX_MANIFEST_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error('Assinatura da atualização ausente ou inválida.');
  if (!globalThis.crypto?.subtle) throw new Error('Este WebView não consegue verificar atualizações com segurança.');
  const data = fromBase64(envelope.payload);
  const signature = fromBase64(envelope.signature);
  const key = await globalThis.crypto.subtle.importKey('jwk', PUBLIC_KEY, { name: 'Ed25519' }, false, ['verify']);
  if (!await globalThis.crypto.subtle.verify('Ed25519', key, signature, data)) throw new Error('A assinatura da atualização foi recusada.');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(data);
  return validatePayload(JSON.parse(decoded));
}

export { KEY_ID, PUBLIC_KEY, REPOSITORY };
