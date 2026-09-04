/* Optional presence metadata only. Never changes media or connection state. */
(() => {
  'use strict';
  const platform = globalThis.voiceupPlatform;
  const metadata = (raw) => {
    try {
      const packet = JSON.parse(raw);
      return packet && ['intro', 'presence-state'].includes(packet.type) ? packet : null;
    } catch { return null; }
  };
  const applyMetadata = (participant, packet, previousStatus) => {
    participant.platform = platform.merge(packet.platform, participant.platform);
    participant.status = platform.status(packet.status ?? previousStatus);
  };
  const paintManualPresence = () => {
    if (currentMode !== 'manual') return;
    for (const row of document.querySelectorAll('#participants .participant, #members-clone .participant')) {
      const remote = row.id === 'peer-other';
      const badge = row.querySelector('.platform-presence');
      const markup = platform.badge(remote ? peer?.platform : platform.local(), remote ? peer?.status : effectivePresenceStatus);
      const kind = remote ? peer?.platform : platform.local();
      const state = platform.status(remote ? peer?.status : effectivePresenceStatus);
      if (badge && (badge.dataset.platform !== (platform.normalize(kind) || 'unknown') || !badge.classList.contains(`status-${state}`))) badge.outerHTML = markup;
    }
  };
  const refresh = () => {
    paintManualPresence();
    renderRoomChannels();
    renderCentralCallMembers();
  };
  const previousManualReceive = receiveData;
  receiveData = async function receivePlatformData(raw) {
    const participant = peer;
    const previousStatus = participant?.status;
    const packet = metadata(raw);
    await previousManualReceive(raw);
    if (!packet || !participant || participant !== peer) return;
    applyMetadata(participant, packet, previousStatus);
    refresh();
  };
  const previousHostedReceive = receiveHostedData;
  receiveHostedData = async function receiveHostedPlatformData(participant, raw) {
    const previousStatus = participant?.status ?? serverMembers.get(participant?.id)?.status;
    if (participant) participant.platform = platform.merge(participant.platform, serverMembers.get(participant.id)?.platform);
    const packet = metadata(raw);
    await previousHostedReceive(participant, raw);
    if (!packet || !participant || participant.left) return;
    applyMetadata(participant, packet, previousStatus);
    rememberHostedMember({ id: participant.id, name: participant.name, color: participant.color, avatar: participant.avatar, clientId: participant.clientId, status: participant.status, platform: participant.platform });
    refresh();
  };
  window.addEventListener('voiceup-presence-changed', refresh);
})();
