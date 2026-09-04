import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  getOrCreateIdentity,
  resetIdentityCacheForTests,
  signIdentityChallenge
} from '../src/identity-utils.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) || null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function fromBase64Url(value) {
  return Buffer.from(String(value), 'base64url');
}

test('cria, persiste e reutiliza a identidade protegida do aparelho', async () => {
  const storage = new MemoryStorage();
  resetIdentityCacheForTests();
  const first = await getOrCreateIdentity(storage, webcrypto);
  assert.equal(first.publicKey.kty, 'EC');
  assert.equal(first.publicKey.crv, 'P-256');
  assert.match(storage.getItem('voiceup-mobile-identity-key-v1'), /"privateKey"/);

  resetIdentityCacheForTests();
  const restored = await getOrCreateIdentity(storage, webcrypto);
  assert.equal(restored.publicKey.x, first.publicKey.x);
  assert.equal(restored.publicKey.y, first.publicKey.y);
});

test('assina o desafio no formato aceito pelo ServerHost', async () => {
  const storage = new MemoryStorage();
  resetIdentityCacheForTests();
  const values = { challenge: 'challenge-123', socketId: 'socket-9', roomId: 'ggk', clientId: 'mobile-client' };
  const proof = await signIdentityChallenge(values, { storage, cryptoApi: webcrypto });
  const publicKey = await webcrypto.subtle.importKey(
    'jwk', proof.identityPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
  );
  const payload = new TextEncoder().encode(
    `voiceup-identity-v1\n${values.challenge}\n${values.socketId}\n${values.roomId}\n${values.clientId}`
  );
  const valid = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(proof.identityProof), payload
  );
  assert.equal(valid, true);
  assert.equal(fromBase64Url(proof.identityProof).length, 64);
});
