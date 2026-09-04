const IDENTITY_KEY_STORAGE = 'voiceup-mobile-identity-key-v1';

let identityKeyPromise = null;

export function bytesToBase64Url(value) {
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function getOrCreateIdentity(storage = globalThis.localStorage, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Criptografia segura indisponível neste aparelho.');
  if (identityKeyPromise) return identityKeyPromise;
  identityKeyPromise = (async () => {
    try {
      const stored = JSON.parse(storage?.getItem?.(IDENTITY_KEY_STORAGE) || '{}');
      if (stored.privateKey?.kty === 'EC' && stored.publicKey?.kty === 'EC') {
        const privateKey = await cryptoApi.subtle.importKey(
          'jwk', stored.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
        );
        return { privateKey, publicKey: stored.publicKey };
      }
    } catch {
      // A corrupted or legacy key is safely replaced on this device.
    }
    const pair = await cryptoApi.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
    );
    const privateKey = await cryptoApi.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = await cryptoApi.subtle.exportKey('jwk', pair.publicKey);
    try {
      storage?.setItem?.(IDENTITY_KEY_STORAGE, JSON.stringify({ version: 1, privateKey, publicKey }));
    } catch {
      // The current session can still be protected when persistent storage is full.
    }
    return { privateKey: pair.privateKey, publicKey };
  })();
  return identityKeyPromise;
}

export async function signIdentityChallenge({ challenge, socketId, roomId, clientId }, options = {}) {
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const identity = await getOrCreateIdentity(options.storage || globalThis.localStorage, cryptoApi);
  const payload = new TextEncoder().encode(
    `voiceup-identity-v1\n${String(challenge || '')}\n${String(socketId || '')}\n${String(roomId || '')}\n${String(clientId || '')}`
  );
  const signature = await cryptoApi.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, payload
  );
  return {
    identityChallenge: String(challenge || ''),
    identityPublicKey: identity.publicKey,
    identityProof: bytesToBase64Url(signature)
  };
}

export function resetIdentityCacheForTests() {
  identityKeyPromise = null;
}
