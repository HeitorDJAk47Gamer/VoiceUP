/* Channel status only: never capture media, change subscriptions or negotiate WebRTC. */
(() => {
  'use strict';
  const panel = document.querySelector('#room-channels');
  if (!panel) return;
  const cameraIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 5-3v10l-5-3z"/></svg>';
  const liveTrack = (stream) => Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live' && track.enabled !== false));
  const localState = () => ({ screen: Boolean(activeVoiceChannel) && liveTrack(screenStream), camera: Boolean(activeVoiceChannel) && liveTrack(cameraStream) });
  const stateFor = (id) => {
    if (id === 'self' || id === hostedSocket?.id) return localState();
    const member = serverMembers.get(id);
    const participant = id === 'manual-peer' ? peer : hostedPeers.get(id);
    // Sender-reported presence also covers other voice channels. Legacy
    // clients still work through the already-existing video-state messages.
    const reported = member?.voiceupMediaState;
    if (reported && typeof reported === 'object') return { screen: reported.screen === true, camera: reported.camera === true };
    if (!participant || participant.left || (member && member.voiceChannel !== activeVoiceChannel)) return { screen: false, camera: false };
    return { screen: participant.videoExpectedKinds?.screen === true, camera: participant.videoExpectedKinds?.camera === true };
  };
  const badges = (state) => [
    state.screen ? '<span class="channel-live-status" data-media-status="screen" title="Ao vivo · compartilhando tela" aria-label="Ao vivo · compartilhando tela"><span class="channel-live-dot" aria-hidden="true"></span><span>Ao vivo</span></span>' : '',
    state.camera ? `<span class="channel-media-badge" data-media-status="camera" title="Câmera ligada" aria-label="Câmera ligada">${cameraIcon}</span>` : ''
  ].join('');
  const sockets = new WeakSet();
  let lastSocket = null;
  let published = '';
  const publish = () => {
    const socket = hostedSocket;
    if (currentMode !== 'hosted' || !socket) return;
    if (!sockets.has(socket)) {
      sockets.add(socket);
      socket.on('room-joined', () => {
        if (socket !== hostedSocket) return;
        published = '';
        refresh();
      });
    }
    if (!socket.connected) return;
    const state = localState();
    const key = `${socket.id}:${state.screen}:${state.camera}`;
    if (lastSocket === socket && published === key) return;
    lastSocket = socket; published = key;
    // An optional event, ignored by older hosts. It carries no video/audio.
    socket.emit('media-state-update', state);
  };
  const refresh = () => {
    publish();
    for (const row of panel.querySelectorAll('.channel-member[data-member-id]')) {
      const slot = row.querySelector('.channel-member-media-slot');
      if (!slot) continue;
      const state = stateFor(row.dataset.memberId);
      const key = `${state.screen}:${state.camera}`;
      if (slot.dataset.mediaState === key) continue;
      slot.dataset.mediaState = key;
      slot.innerHTML = badges(state);
    }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh(); });
  };
  new MutationObserver(schedule).observe(panel, { childList: true, subtree: true });
  // Also notice local track end/start and legacy peer metadata that change
  // without rebuilding the roster. Stable state never recreates the icons.
  setInterval(() => {
    // Presence must still update when the app is minimized and Chromium
    // pauses animation frames; only the visual refresh waits for a frame.
    publish();
    schedule();
  }, 420);
  schedule();
})();
