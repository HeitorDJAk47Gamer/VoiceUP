/* Public verification key only. Never regenerate this key for routine releases. */
(function (scope) {
  const trust = Object.freeze({
    keyId: 'voiceup-release-2026-01',
    publicKey: Object.freeze({ kty: 'OKP', crv: 'Ed25519', x: 'St3RskjUQgTUFCHpUQOWZHrtoR5cld-4XRz0q0Hgeso' })
  });
  if (typeof module === 'object' && module.exports) module.exports = trust;
  else scope.voiceupReleaseTrust = trust;
})(globalThis);
