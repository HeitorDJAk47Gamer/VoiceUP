import '../../public/platform-presence.js';

export const platformPresence = globalThis.voiceupPlatform;

// Older hosts omit platform metadata. Preserve the value learned over P2P.
export function mergePresenceMember(previous = {}, incoming = {}) {
  return {
    ...previous,
    ...incoming,
    platform: platformPresence.merge(incoming.platform, previous.platform),
    status: platformPresence.status(incoming.status ?? previous.status)
  };
}
