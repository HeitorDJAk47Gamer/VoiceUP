/*
 * VoiceUP 1.1.3 beta audio/call layer.
 *
 * This file deliberately sits after the existing media stability layer.  It
 * only adds local UI and small DataChannel metadata, so it never changes the
 * WebRTC offer/answer or media-track negotiation that is already stable.
 */
(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}'); } catch { return {}; }
  })();

  let automaticSensitivity = stored.automaticSensitivity !== false;
  let decorateQueued = false;

  const muteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8M4 4l16 16"/></svg>';
  const outputMuteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM19 9l-6 6M13 9l6 6"/></svg>';
  const zoomIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.4 4.4M10.8 7.7v6.2M7.7 10.8h6.2"/></svg>';

  document.head.insertAdjacentHTML('beforeend', `<style id="voiceup-audio-call-polish-style">
    .voiceup-mute-badges{display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle}
    .voiceup-mute-badge{display:grid;place-items:center;width:18px;height:18px;border:1px solid color-mix(in srgb,var(--coral) 45%,var(--line));border-radius:6px;background:color-mix(in srgb,var(--coral) 12%,var(--surface));color:var(--coral)}
    .voiceup-mute-badge.output{border-color:color-mix(in srgb,#f4b04d 48%,var(--line));background:color-mix(in srgb,#f4b04d 12%,var(--surface));color:#f4b04d}
    .voiceup-mute-badge svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .call-member .voiceup-mute-badges{position:absolute;right:8px;top:8px;margin:0}.call-member{position:relative}
    .participant .voiceup-mute-badges{flex:0 0 auto}.member-status-line .voiceup-mute-badges{margin-left:4px}
    .voiceup-media-zoom{display:grid!important;place-items:center!important;width:31px!important;height:31px!important;padding:0!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:8px!important;background:rgba(8,14,24,.86)!important;color:#f4f8ff!important}
    .voiceup-media-zoom:hover{border-color:var(--focus)!important;background:var(--focus)!important;color:var(--focus-contrast,#08101a)!important}.voiceup-media-zoom svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .video-tile[data-voiceup-zoom] video{transform:scale(var(--voiceup-media-zoom,1));transform-origin:center;transition:transform .16s ease;cursor:zoom-out}.video-tile:not([data-voiceup-zoom]) video{cursor:zoom-in}.video-tile{isolation:isolate}
    .auto-sensitivity-option{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:start!important;gap:9px!important;margin:4px 0 10px!important;color:var(--ink)!important;font-size:12px!important;font-weight:700!important}.auto-sensitivity-option input{margin-top:2px}.auto-sensitivity-option small{grid-column:2;color:var(--muted);font-size:10px;font-weight:500;line-height:1.35}.mic-threshold-manual{opacity:.52}
  </style>`);

  const normalizeAudioState = (value) => ({
    micMuted: Boolean(value?.micMuted),
    outputMuted: Boolean(value?.outputMuted)
  });
  const ownAudioState = () => normalizeAudioState({ micMuted: !micEnabled, outputMuted: Boolean(betaOutputMuted) });
  const sameAudioState = (left, right) => Boolean(left) && Boolean(right)
    && Boolean(left.micMuted) === Boolean(right.micMuted)
    && Boolean(left.outputMuted) === Boolean(right.outputMuted);

  const persistAudioPreferences = () => {
    try {
      const profile = JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}');
      profile.automaticSensitivity = automaticSensitivity;
      localStorage.setItem('voiceup-profile-v1', JSON.stringify(profile));
    } catch { /* Preferences are optional. */ }
  };

  const originalSaveProfileForAudioPolish = saveProfile;
  saveProfile = function saveProfileAudioPolish(...args) {
    const result = originalSaveProfileForAudioPolish.apply(this, args);
    persistAudioPreferences();
    return result;
  };

  const stateForParticipant = (id) => {
    if (id === 'self' || id === hostedSocket?.id) return ownAudioState();
    if (id === 'manual-peer') return normalizeAudioState(peer?.voiceupAudioState);
    const hosted = hostedPeers?.get?.(id);
    return normalizeAudioState((!hosted?.left && hosted?.voiceupAudioState) || serverMembers?.get?.(id)?.voiceupAudioState);
  };

  const muteBadgesMarkup = (state) => {
    if (!state?.micMuted && !state?.outputMuted) return '';
    const mic = state.micMuted ? `<span class="voiceup-mute-badge" title="Microfone desligado" aria-label="Microfone desligado">${muteIcon}</span>` : '';
    const output = state.outputMuted ? `<span class="voiceup-mute-badge output" title="Áudio recebido desligado" aria-label="Áudio recebido desligado">${outputMuteIcon}</span>` : '';
    return `<span class="voiceup-mute-badges" aria-label="Estado de áudio">${mic}${output}</span>`;
  };

  const decorateMuteBadges = () => {
    decorateQueued = false;
    const rows = [
      ...document.querySelectorAll('[data-member-id]'),
      ...document.querySelectorAll('[data-hosted-peer]'),
      ...document.querySelectorAll('[data-call-member]')
    ];
    const manual = byId('peer-other');
    const self = byId('self-participant');
    if (manual) rows.push(manual);
    if (self) rows.push(self);
    const seen = new Set();
    for (const row of rows) {
      if (!row || seen.has(row)) continue;
      seen.add(row);
      const id = row.dataset.memberId || row.dataset.hostedPeer || row.dataset.callMember || (row.id === 'peer-other' ? 'manual-peer' : 'self');
      const state = stateForParticipant(id);
      const key = `${state.micMuted ? 'm' : ''}${state.outputMuted ? 'o' : ''}`;
      // O DOM dos participantes é refeito por diversos atualizadores (voz,
      // ping, presença e canal). Remova sempre as marcas antigas antes de
      // decidir se precisa desenhar novamente; assim elas não se acumulam.
      const oldBadges = [...row.querySelectorAll('.voiceup-mute-badges')];
      const target = row.querySelector('.channel-member-mute-slot') || (row.matches('[data-call-member]') ? row : (row.querySelector('.member-status-line') || row.querySelector('small') || row));
      if (row.dataset.voiceupMuteState === key && oldBadges.length === (key ? 1 : 0) && (!key || oldBadges[0].parentElement === target)) continue;
      oldBadges.forEach((badge) => badge.remove());
      row.dataset.voiceupMuteState = key;
      if (!key) continue;
      target.insertAdjacentHTML('beforeend', muteBadgesMarkup(state));
    }
  };
  const presenceAudioSockets = new WeakSet();
  let publishedPresenceAudio = '';
  const publishPresenceAudioState = () => {
    const socket = hostedSocket;
    if (currentMode !== 'hosted' || !socket) return;
    if (!presenceAudioSockets.has(socket)) {
      presenceAudioSockets.add(socket);
      socket.on('room-joined', () => {
        if (socket !== hostedSocket) return;
        publishedPresenceAudio = '';
        publishPresenceAudioState();
      });
    }
    if (!socket.connected) return;
    const state = ownAudioState();
    const key = `${socket.id}:${state.micMuted}:${state.outputMuted}`;
    if (publishedPresenceAudio === key) return;
    publishedPresenceAudio = key;
    // Optional presence metadata only. Old hosts ignore this event; the
    // existing peer-to-peer audio-state packets remain unchanged.
    socket.emit('audio-state-update', state);
  };
  const queueMuteDecorations = () => {
    publishPresenceAudioState();
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(decorateMuteBadges);
  };
  for (const root of [byId('participants'), byId('members-clone'), byId('call-members'), byId('room-channels')]) {
    if (root) new MutationObserver(queueMuteDecorations).observe(root, { childList: true, subtree: true });
  }
  setInterval(queueMuteDecorations, 420);

  const applyRemoteAudioState = (participant, value) => {
    if (!participant) return;
    const state = normalizeAudioState(value);
    if (sameAudioState(participant.voiceupAudioState, state)) return;
    participant.voiceupAudioState = state;
    const member = participant.id && serverMembers?.get?.(participant.id);
    if (member) {
      member.voiceupAudioState = state;
      serverMembers.set(participant.id, member);
    }
    renderHostedParticipants?.();
    renderCentralCallMembers?.();
    queueMuteDecorations();
  };

  const originalSendSignalForAudioState = sendSignal;
  sendSignal = function sendSignalAudioState(type, description) {
    originalSendSignalForAudioState.call(this, type, description);
    if (type !== 'audio-state' || currentMode !== 'hosted' || !hostedSocket?.connected) return;
    for (const participant of hostedPeers.values()) {
      if (!participant.left) hostedSocket.emit('signal', { target: participant.id, data: { audioState: normalizeAudioState(description) } });
    }
  };
  const broadcastAudioState = () => {
    publishPresenceAudioState();
    try { sendSignal('audio-state', ownAudioState()); } catch { /* The connection may still be opening. */ }
    queueMuteDecorations();
  };

  const originalReceiveDataForAudioState = receiveData;
  receiveData = async function receiveDataAudioState(raw) {
    try {
      const message = JSON.parse(raw);
      if (message?.type === 'audio-state') {
        if (peer) applyRemoteAudioState(peer, message.description || message.audioState);
        return;
      }
      if (message?.type === 'intro' && message.audioState && peer) applyRemoteAudioState(peer, message.audioState);
    } catch { /* Existing receiver owns malformed input handling. */ }
    return originalReceiveDataForAudioState.call(this, raw);
  };

  const originalReceiveHostedDataForAudioState = receiveHostedData;
  receiveHostedData = function receiveHostedDataAudioState(participant, raw) {
    try {
      const message = JSON.parse(raw);
      if (message?.type === 'audio-state') {
        applyRemoteAudioState(participant, message.description || message.audioState);
        return;
      }
      if (message?.type === 'intro' && message.audioState) applyRemoteAudioState(participant, message.audioState);
    } catch { /* Existing receiver owns malformed input handling. */ }
    return originalReceiveHostedDataForAudioState.call(this, participant, raw);
  };

  const originalReceiveHostedSignalForAudioState = receiveHostedSignal;
  receiveHostedSignal = async function receiveHostedSignalAudioState(payload) {
    const data = payload?.data;
    if (data?.audioState) {
      const participant = hostedPeers.get(payload.from) || await createHostedPeer(payload.from, payload.name, false, payload.color, payload.avatar);
      applyRemoteAudioState(participant, data.audioState);
      return;
    }
    return originalReceiveHostedSignalForAudioState.call(this, payload);
  };

  const originalBindChannelForAudioState = bindChannel;
  bindChannel = function bindChannelAudioState(channel) {
    originalBindChannelForAudioState.call(this, channel);
    const originalOpen = channel.onopen;
    channel.onopen = async (...args) => {
      await originalOpen?.apply(channel, args);
      if (channel.readyState === 'open') broadcastAudioState();
    };
  };
  const originalBindHostedChannelForAudioState = bindHostedChannel;
  bindHostedChannel = function bindHostedChannelAudioState(participant, channel) {
    originalBindHostedChannelForAudioState.call(this, participant, channel);
    const originalOpen = channel.onopen;
    channel.onopen = async (...args) => {
      await originalOpen?.apply(channel, args);
      if (channel.readyState === 'open') broadcastAudioState();
    };
  };

  byId('mic-button')?.addEventListener('click', () => setTimeout(broadcastAudioState, 0));
  byId('output-button')?.addEventListener('click', () => setTimeout(broadcastAudioState, 0));
  byId('mic-test-toggle')?.addEventListener('click', () => { setTimeout(broadcastAudioState, 80); setTimeout(broadcastAudioState, 450); });

  // Remote join/leave sounds already exist in markConnected/removeHostedPeer.
  // Warming AudioContext on the first normal user action lets those sounds be
  // heard even when the other person connects a few seconds later.
  const warmNotificationAudio = () => {
    try {
      notificationContext ||= new (window.AudioContext || window.webkitAudioContext)();
      notificationContext.resume?.().catch(() => {});
    } catch { /* Sound stays optional when the platform blocks Web Audio. */ }
  };
  addEventListener('pointerdown', warmNotificationAudio, { capture: true, passive: true });
  addEventListener('keydown', warmNotificationAudio, { capture: true });

  // Automatic sensitivity learns the current noise floor and keeps a clear
  // margin above it.  Turning it off restores the exact manual threshold.
  const noiseSelect = byId('noise-select');
  if (noiseSelect && !noiseSelect.querySelector('option[value="studio"]')) {
    noiseSelect.insertAdjacentHTML('beforeend', '<option value="studio">Estúdio — eco e ruído máximo</option>');
  }
  const thresholdLabel = byId('mic-threshold-input')?.closest('label');
  if (thresholdLabel && !byId('automatic-sensitivity-toggle')) {
    thresholdLabel.insertAdjacentHTML('beforebegin', `<label class="auto-sensitivity-option"><input id="automatic-sensitivity-toggle" type="checkbox"${automaticSensitivity ? ' checked' : ''}/><span>Sensibilidade automática</span><small>Aprende o ruído ambiente e ajusta a detecção de voz em tempo real.</small></label>`);
  }
  const automaticSensitivityToggle = byId('automatic-sensitivity-toggle');
  const syncAutomaticSensitivityUi = () => {
    if (automaticSensitivityToggle) automaticSensitivityToggle.checked = automaticSensitivity;
    thresholdLabel?.classList.toggle('mic-threshold-manual', automaticSensitivity);
    byId('mic-threshold-input')?.setAttribute('aria-label', automaticSensitivity ? 'Limite manual de voz, usado quando a sensibilidade automática está desligada' : 'Limite manual para detectar voz');
  };
  automaticSensitivityToggle?.addEventListener('change', () => {
    automaticSensitivity = Boolean(automaticSensitivityToggle.checked);
    persistAudioPreferences();
    saveProfile();
    stopVoiceDetection();
    startVoiceDetection();
    toast(automaticSensitivity ? 'Sensibilidade automática ativada.' : 'Sensibilidade manual ativada.');
    syncAutomaticSensitivityUi();
  });
  syncAutomaticSensitivityUi();

  const originalAudioConstraintsForStudio = audioConstraints;
  audioConstraints = function audioConstraintsStudio(...args) {
    const constraints = originalAudioConstraintsForStudio.apply(this, args);
    if (noiseMode !== 'studio') return constraints;
    return {
      ...constraints,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
      googEchoCancellation: true,
      googExperimentalEchoCancellation: true,
      googDAEchoCancellation: true,
      googNoiseSuppression: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true
    };
  };

  startVoiceDetection = function startVoiceDetectionAutomatic() {
    if (!localStream || voiceLoopRunning) return;
    try {
      const session = ++voiceDetectionSession;
      voiceContext = new AudioContext();
      voiceContext.resume().catch(() => {});
      voiceAnalyser = voiceContext.createAnalyser();
      voiceAnalyser.fftSize = 512;
      voiceAnalyser.smoothingTimeConstant = .35;
      voiceData = new Uint8Array(voiceAnalyser.fftSize);
      voiceContext.createMediaStreamSource(localStream).connect(voiceAnalyser);
      voiceLoopRunning = true;
      let noiseFloorDb = -70;
      let calibrationSamples = 0;
      let aboveThresholdSince = 0;
      let lastVoiceAt = 0;
      let lastSignalAt = 0;
      const noiseMargin = noiseMode === 'studio' ? 12 : noiseMode === 'enhanced' ? 10 : 8;
      const sample = (now = performance.now()) => {
        if (session !== voiceDetectionSession || !voiceAnalyser) return;
        voiceAnalyser.getByteTimeDomainData(voiceData);
        let squareSum = 0;
        for (const value of voiceData) { const normalized = (value - 128) / 128; squareSum += normalized * normalized; }
        const rms = Math.sqrt(squareSum / voiceData.length);
        const levelDb = 20 * Math.log10(Math.max(rms, 0.00001));
        if (calibrationSamples < 30) {
          noiseFloorDb = calibrationSamples ? noiseFloorDb * .82 + levelDb * .18 : levelDb;
          calibrationSamples += 1;
        }
        const learnedThreshold = clamp(noiseFloorDb + noiseMargin, -60, -18);
        const dynamicThresholdDb = automaticSensitivity ? learnedThreshold : micThresholdDb;
        const aboveThreshold = micEnabled && calibrationSamples >= 30 && levelDb >= dynamicThresholdDb;
        if (!aboveThreshold) {
          aboveThresholdSince = 0;
          const learnRate = levelDb < noiseFloorDb + 5 ? .025 : .004;
          noiseFloorDb = noiseFloorDb * (1 - learnRate) + levelDb * learnRate;
        } else {
          aboveThresholdSince ||= now;
          if (now - aboveThresholdSince >= 85) lastVoiceAt = now;
        }
        const speaking = micEnabled && now - lastVoiceAt < 260;
        if (speaking !== localSpeaking || now - lastSignalAt > 1800) {
          localSpeaking = speaking;
          lastSignalAt = now;
          byId('self-participant')?.classList.toggle('speaking', speaking);
          document.querySelector('[data-call-member="self"]')?.classList.toggle('speaking', speaking);
          sendSignal('voice-state', speaking);
        }
        requestAnimationFrame(sample);
      };
      sample();
    } catch { /* The call itself remains functional without the aura. */ }
  };

  const originalDecorateRemoteMediaTileForZoom = decorateRemoteMediaTile;
  decorateRemoteMediaTile = function decorateRemoteMediaTileZoom(id, kind, participant) {
    originalDecorateRemoteMediaTileForZoom.call(this, id, kind, participant);
    if (kind !== 'screen') return;
    const tile = videoGallery?.querySelector?.(`[data-video-peer="${videoTileId(id)}"]`);
    const controls = tile?.querySelector('.media-tile-controls');
    if (!tile || !controls || controls.querySelector('[data-media-zoom]')) return;
    controls.insertAdjacentHTML('afterbegin', `<button type="button" class="voiceup-media-zoom" data-media-zoom title="Zoom da transmissão: 100%" aria-label="Aumentar zoom da transmissão">${zoomIcon}</button>`);
  };
  const zoomLevels = [1, 1.25, 1.5, 1.75, 2];
  const setMediaZoom = (tile, next) => {
    const level = clamp(next, 1, 2);
    const visible = level > 1.01;
    tile.style.setProperty('--voiceup-media-zoom', String(level));
    tile.toggleAttribute('data-voiceup-zoom', visible);
    const button = tile.querySelector('[data-media-zoom]');
    if (button) {
      const label = `Zoom da transmissão: ${Math.round(level * 100)}%`;
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-media-zoom]');
    if (!button) return;
    const tile = button.closest('.video-tile');
    if (!tile) return;
    event.preventDefault(); event.stopPropagation();
    const current = Number(tile.style.getPropertyValue('--voiceup-media-zoom')) || 1;
    const index = zoomLevels.findIndex((level) => Math.abs(level - current) < .02);
    setMediaZoom(tile, zoomLevels[(index + 1 + zoomLevels.length) % zoomLevels.length]);
  });
  document.querySelector('#video-gallery')?.addEventListener('wheel', (event) => {
    const tile = event.target.closest?.('.video-tile[data-media-kind="screen"]');
    if (!tile) return;
    event.preventDefault();
    const current = Number(tile.style.getPropertyValue('--voiceup-media-zoom')) || 1;
    const next = current + (event.deltaY < 0 ? .1 : -.1);
    setMediaZoom(tile, next);
  }, { passive: false });

  queueMuteDecorations();
})();
