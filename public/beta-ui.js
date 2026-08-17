(() => {
  const afterReady = (callback) => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', callback, { once: true }) : callback();
  afterReady(() => {
    const panels = [...document.querySelectorAll('.panel-tab')];
    const show = (name) => {
      panels.forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
      document.querySelectorAll('.side-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}-panel`));
      if (name === 'chat') {
        unreadChannels.delete(activeTextChannel);
        mentionChannels.delete(activeTextChannel);
        document.querySelector('#chat-unread')?.classList.add('hidden');
        renderRoomChannels();
        refreshChatUnreadIndicator();
      }
    };
    panels.forEach((button) => button.addEventListener('click', () => show(button.dataset.panel)));
    const source = document.querySelector('#participants'); const clone = document.querySelector('#members-clone');
    // Hosted rooms render the full server roster themselves. Do not let this
    // legacy mirror overwrite it whenever the call participant list changes.
    const syncMembers = () => { if (currentMode !== 'hosted' && source && clone) clone.innerHTML = source.innerHTML || '<p class="system-message">Nenhuma pessoa conectada.</p>'; };
    syncMembers(); if (source) new MutationObserver(syncMembers).observe(source, { childList: true, subtree: true, characterData: true });
    const messages = document.querySelector('#messages'); if (messages) new MutationObserver(() => { if (!document.querySelector('.panel-tab[data-panel="chat"]')?.classList.contains('active')) document.querySelector('#chat-unread')?.classList.remove('hidden'); }).observe(messages, { childList: true });
  });
})();

// Media fixes kept separately during the beta so they can be reviewed and reverted safely.
// The signaling server remains only the coordinator: audio, camera and screen stay WebRTC P2P.
function showHostedVideo(p, label = 'Video recebido') {
  if (!p) return;
  p.videoLabel = label;
  activeRemoteId ||= p.id;
  displayRemoteVideo(p.videoStream, `${p.name} - ${label}`, p.id);
}

function currentVideoKind() { return screenStream ? 'screen' : cameraStream ? 'camera' : ''; }

const betaVideoRevision = { camera: 0, screen: 0 };
const betaActiveVideoTrack = (kind = currentVideoKind()) => (kind === 'screen' ? screenStream : cameraStream)?.getVideoTracks?.()[0] || null;
const betaVideoSender = (p, kind) => p?.[`${kind}Sender`] || (kind === 'camera' ? p?.videoSender : null);
const betaVideoSlotCount = (participant) => participant?.pc?.getTransceivers?.()
  .filter((item) => item?.receiver?.track?.kind === 'video' || item?.sender?.track?.kind === 'video').length || 0;
const betaUsesLegacyVideoSlot = (participant) => participant?.singleVideoTransport === true || betaVideoSlotCount(participant) === 1;

// Chromium negotiates a far more reliable bidirectional video m-line when a
// live track already exists in the first offer.  A transceiver created only
// with the string "video" can remain muted forever after a later replaceTrack
// on some Electron/Windows builds. Keep one low-cost neutral track in each
// camera/screen slot and swap only the source behind that stable transport.
const betaPlaceholderVideos = new Map();
function betaPlaceholderVideoTrack(kind = 'camera') {
  const existing = betaPlaceholderVideos.get(kind);
  if (existing?.track?.readyState === 'live') return existing.track;
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d', { alpha: false });
  let tick = 0;
  const paint = () => {
    context.fillStyle = '#05070d'; context.fillRect(0, 0, canvas.width, canvas.height);
    // One changing, nearly black pixel keeps a real encoded frame flowing at
    // 1 fps without exposing anything or consuming meaningful CPU/bandwidth.
    context.fillStyle = tick++ % 2 ? '#06080e' : '#05070d'; context.fillRect(0, 0, 1, 1);
  };
  paint();
  const timer = setInterval(paint, 1000);
  const stream = canvas.captureStream(1);
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'detail';
  betaPlaceholderVideos.set(kind, { canvas, stream, track, timer });
  return track;
}
const betaTransportVideoTrack = (kind, realTrack = betaActiveVideoTrack(kind)) => realTrack || betaPlaceholderVideoTrack(kind);

async function betaEncodedVideoFrames(sender) {
  if (!sender?.getStats) return null;
  try {
    const reports = await sender.getStats();
    let frames = null;
    reports.forEach((report) => {
      if (report.type !== 'outbound-rtp' || report.isRemote) return;
      if (report.kind && report.kind !== 'video') return;
      if (report.mediaType && report.mediaType !== 'video') return;
      const value = Number(report.framesEncoded);
      if (Number.isFinite(value)) frames = Math.max(frames ?? 0, value);
    });
    return frames;
  } catch { return null; }
}

// replaceTrack resolves before the encoder necessarily emits the first frame
// from the new source. Announcing the live during that tiny interval lets a
// slow receiver display one or two frames from the neutral placeholder. Wait
// for two newly encoded frames when Chromium exposes that counter; unsupported
// drivers simply continue immediately.
async function betaWaitForEncodedVideo(sender, minimumFrames = 2, timeoutMs = 650) {
  const initial = await betaEncodedVideoFrames(sender);
  if (initial === null) return false;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 35));
    const current = await betaEncodedVideoFrames(sender);
    if (current === null) return false;
    if (current >= initial + minimumFrames) return true;
  }
  return false;
}

function setHostedOutgoingVideoTrack(p, kind, track) {
  const stream = p?.[`${kind}OutgoingStream`];
  if (!stream) return;
  for (const current of stream.getVideoTracks()) stream.removeTrack(current);
  if (track) stream.addTrack(track);
}

// Calls to replaceTrack on the same sender must be serialized.  Starting a
// live, receiving a late data-channel open, and clicking "Assistir live" can
// otherwise overlap and Chromium occasionally leaves the receiver muted.
// This was especially visible when two people began a screen share in quick
// succession: each side had a valid sender, but one of the concurrent swaps
// won only halfway through.
async function syncHostedVideoForPeerNow(p, kind = 'camera', track = betaActiveVideoTrack(kind), forceRefresh = false) {
  const sender = betaVideoSender(p, kind);
  if (!sender) return false;
  try {
    // Retrying a live must re-announce its state, but must *not* detach and
    // reattach the exact same track. Electron/Chromium can briefly mute that
    // receiver every time replaceTrack receives the same object, producing
    // the visible flashing reported when two people stream at once.
    const transportTrack = betaTransportVideoTrack(kind, track);
    const needsTrackSwap = sender.track !== transportTrack;
    if (needsTrackSwap) {
      setHostedOutgoingVideoTrack(p, kind, transportTrack);
      await sender.replaceTrack(transportTrack);
      if (track) await tuneVideoSender(sender, kind);
      if (track) await betaWaitForEncodedVideo(sender);
    }
    if (p.channel?.readyState === 'open') {
      p.channel.send(JSON.stringify(track
        ? { type: 'video-on', description: kind, revision: betaVideoRevision[kind] }
        : { type: 'video-off', description: kind, revision: betaVideoRevision[kind] }));
    }
    // The media remains direct P2P. This tiny state copy through the host only
    // prevents a late/opening data channel from losing the live notification.
    if (hostedSocket?.connected) hostedSocket.emit('signal', { target: p.id, data: { videoState: { active: Boolean(track), description: kind, kind, revision: betaVideoRevision[kind] } } });
    return true;
  } catch { return false; }
}

function syncHostedVideoForPeer(p, kind = 'camera', track = betaActiveVideoTrack(kind), forceRefresh = false) {
  if (!p || p.left) return Promise.resolve(false);
  p.videoSyncQueues ||= {};
  const previous = p.videoSyncQueues[kind] || Promise.resolve();
  const queued = previous.catch(() => {}).then(() => syncHostedVideoForPeerNow(p, kind, track, forceRefresh));
  p.videoSyncQueues[kind] = queued;
  queued.finally(() => {
    if (p.videoSyncQueues?.[kind] === queued) delete p.videoSyncQueues[kind];
  }).catch(() => {});
  return queued;
}

const scheduleHostedVideoSync = (p, kind = 'camera') => {
  if (!p || p.left) return;
  p.videoSyncTimers ||= {};
  clearTimeout(p.videoSyncTimers[kind]);
  const revision = betaVideoRevision[kind];
  const delays = [0, 260, 900, 2300];
  const retry = (index) => {
    if (p.left || revision !== betaVideoRevision[kind] || index >= delays.length) return;
    p.videoSyncTimers[kind] = setTimeout(async () => {
      await syncHostedVideoForPeer(p, kind);
      retry(index + 1);
    }, delays[index]);
  };
  retry(0);
};

function bindHostedChannel(p, channel) {
  p.channel = channel;
  channel.onmessage = ({ data }) => receiveHostedData(p, data);
  channel.onopen = () => {
    channel.send(JSON.stringify({ type: 'intro', name: myName, color: myColor, avatar: myAvatar }));
    scheduleHostedVideoSync(p, 'camera');
    scheduleHostedVideoSync(p, 'screen');
    markHostedConnected(p);
  };
  channel.onclose = () => { if (!p.left) { p.connected = false; renderHostedParticipants(); } };
}

function attachHostedTrack(p, track, streams) {
  const stream = track.kind === 'video' ? new MediaStream([track]) : (streams[0] || new MediaStream([track]));
  if (track.kind === 'audio') {
    p.audio?.pause();
    p.audio = new Audio();
    p.audio.srcObject = stream;
    p.audio.autoplay = true;
    p.audio.muted = p.muted;
    if (audioOutputId && typeof p.audio.setSinkId === 'function') p.audio.setSinkId(audioOutputId).catch(() => {});
    p.audio.play().catch(() => {});
    return;
  }
  p.videoStream = stream;
  const reveal = () => showHostedVideo(p, p.videoLabel || 'Video recebido');
  track.onunmute = reveal;
  track.onended = () => hideVideoTile(p.id);
  if (track.readyState === 'live') reveal();
  setTimeout(reveal, 250);
  setTimeout(reveal, 900);
}

const hostedIncomingVideoKind = (p, transceiver, track) => {
  if (transceiver === p?.screenTransceiver
    || transceiver?.receiver === p?.screenReceiver
    || track === p?.screenReceiver?.track) return 'screen';
  if (transceiver === p?.cameraTransceiver
    || transceiver?.receiver === p?.cameraReceiver
    || track === p?.cameraReceiver?.track) return 'camera';
  // The responder receives these m-lines before its sender/receiver fields are
  // assigned. VoiceUP always offers camera first and screen second.
  const negotiatedVideos = p?.pc?.getTransceivers?.().filter((item) => item.receiver?.track?.kind === 'video') || [];
  const negotiatedIndex = negotiatedVideos.indexOf(transceiver);
  if (negotiatedIndex === 1) return 'screen';
  if (negotiatedIndex === 0) return 'camera';
  // This fallback only applies to Chromium builds that omit the transceiver
  // from ontrack. It uses the stream state announced by the broadcaster.
  if (p?.videoExpectedKinds?.screen && !p?.videoStreams?.screen) return 'screen';
  return 'camera';
};

function addHostedOfferMedia(p, pc) {
  const audioTrack = outgoingAudioTrack();
  p.audioStream = new MediaStream(audioTrack ? [audioTrack] : []);
  const audioTransceiver = audioTrack
    ? pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [p.audioStream] })
    : pc.addTransceiver('audio', { direction: 'sendrecv', streams: [p.audioStream] });
  p.audioTransceiver = audioTransceiver; p.audioSender = audioTransceiver.sender; p.audioReceiver = audioTransceiver.receiver;

  const cameraTrack = betaTransportVideoTrack('camera');
  const screenTrack = betaTransportVideoTrack('screen');
  p.cameraOutgoingStream = new MediaStream([cameraTrack]);
  p.screenOutgoingStream = new MediaStream([screenTrack]);
  const cameraTransceiver = pc.addTransceiver(cameraTrack, { direction: 'sendrecv', streams: [p.cameraOutgoingStream] });
  const screenTransceiver = pc.addTransceiver(screenTrack, { direction: 'sendrecv', streams: [p.screenOutgoingStream] });
  p.cameraTransceiver = cameraTransceiver; p.screenTransceiver = screenTransceiver;
  p.cameraSender = cameraTransceiver.sender; p.cameraReceiver = cameraTransceiver.receiver;
  p.screenSender = screenTransceiver.sender; p.screenReceiver = screenTransceiver.receiver;
  p.videoSender = p.cameraSender;
}

async function bindHostedAnswerMedia(p) {
  const pc = p?.pc;
  if (!pc) return;
  const transceivers = pc.getTransceivers();
  const audioTransceiver = transceivers.find((item) => item.receiver?.track?.kind === 'audio');
  const videoTransceivers = transceivers.filter((item) => item.receiver?.track?.kind === 'video');
  const cameraTransceiver = videoTransceivers[0];
  const screenTransceiver = videoTransceivers[1];
  const replacements = [];

  if (audioTransceiver) {
    const audioTrack = outgoingAudioTrack();
    p.audioStream = new MediaStream(audioTrack ? [audioTrack] : []);
    p.audioTransceiver = audioTransceiver; p.audioSender = audioTransceiver.sender; p.audioReceiver = audioTransceiver.receiver;
    if (audioTransceiver.direction !== 'stopped') audioTransceiver.direction = 'sendrecv';
    if (typeof audioTransceiver.sender.setStreams === 'function') audioTransceiver.sender.setStreams(p.audioStream);
    replacements.push(audioTransceiver.sender.replaceTrack(audioTrack || null));
  }

  if (cameraTransceiver) {
    const cameraTrack = betaTransportVideoTrack('camera');
    p.cameraOutgoingStream = new MediaStream([cameraTrack]);
    p.cameraTransceiver = cameraTransceiver; p.cameraSender = cameraTransceiver.sender; p.cameraReceiver = cameraTransceiver.receiver; p.videoSender = cameraTransceiver.sender;
    if (cameraTransceiver.direction !== 'stopped') cameraTransceiver.direction = 'sendrecv';
    if (typeof cameraTransceiver.sender.setStreams === 'function') cameraTransceiver.sender.setStreams(p.cameraOutgoingStream);
    replacements.push(cameraTransceiver.sender.replaceTrack(cameraTrack));
  }

  if (screenTransceiver) {
    const screenTrack = betaTransportVideoTrack('screen');
    p.screenOutgoingStream = new MediaStream([screenTrack]);
    p.screenTransceiver = screenTransceiver; p.screenSender = screenTransceiver.sender; p.screenReceiver = screenTransceiver.receiver;
    if (screenTransceiver.direction !== 'stopped') screenTransceiver.direction = 'sendrecv';
    if (typeof screenTransceiver.sender.setStreams === 'function') screenTransceiver.sender.setStreams(p.screenOutgoingStream);
    replacements.push(screenTransceiver.sender.replaceTrack(screenTrack));
  } else if (cameraTransceiver) {
    // Older releases only offered one video transport. They retain camera OR
    // screen compatibility; current releases use both independent slots.
    p.singleVideoTransport = true;
    p.screenSender = p.cameraSender; p.screenReceiver = p.cameraReceiver;
  }

  await Promise.allSettled(replacements);
  if (betaActiveVideoTrack('camera') && p.cameraSender) await tuneVideoSender(p.cameraSender, 'camera').catch(() => {});
  if (betaActiveVideoTrack('screen') && p.screenSender && p.screenSender !== p.cameraSender) await tuneVideoSender(p.screenSender, 'screen').catch(() => {});
}

function makeHostedConnection(p, initiator = false) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }], iceCandidatePoolSize: 2 });
  p.pc = pc;
  // Only the offerer creates media m-lines. The answerer binds its tracks to
  // those exact transceivers after receiving the offer. Creating a second set
  // here was the root cause of unnegotiated senders and black remote video.
  if (initiator) addHostedOfferMedia(p, pc);
  if (initiator && betaActiveVideoTrack('camera')) tuneVideoSender(p.cameraSender, 'camera').catch(() => {});
  if (initiator && betaActiveVideoTrack('screen')) tuneVideoSender(p.screenSender, 'screen').catch(() => {});
  pc.ontrack = ({ track, streams, transceiver }) => attachHostedTrack(p, track, streams, hostedIncomingVideoKind(p, transceiver, track));
  pc.ondatachannel = ({ channel }) => bindHostedChannel(p, channel);
  pc.onicecandidate = ({ candidate }) => { if (candidate) hostedSocket?.emit('signal', { target: p.id, data: { candidate: candidate.toJSON() } }); };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') { p.connected = false; renderHostedParticipants(); } };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      if (p.channel?.readyState === 'open') markHostedConnected(p);
      // Each direction owns independent senders. Reannounce both tracks after
      // the connection settles, without creating another SDP offer: the two
      // video m-lines were negotiated before the call started.
      scheduleHostedVideoSync(p, 'camera');
      scheduleHostedVideoSync(p, 'screen');
      // On some Electron/Windows combinations a pre-created recvonly slot
      // does not fire ontrack after the initial offer. Its receiver still
      // exists, though; register it here so a later video-state can reveal
      // the live instead of leaving one side permanently without a stream.
      for (const transceiver of pc.getTransceivers()) {
        const receiverTrack = transceiver.receiver?.track;
        if (receiverTrack?.kind !== 'video') continue;
        const receivedKind = hostedIncomingVideoKind(p, transceiver, receiverTrack);
        if (!p.videoStreams?.[receivedKind]) attachHostedTrack(p, receiverTrack, [], receivedKind);
      }
    }
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !p.left && pc.connectionState !== 'closed') { p.connected = false; renderHostedParticipants(); }
  };
  pc.onnegotiationneeded = async () => {
    if (!p.channel || p.channel.readyState !== 'open' || p.makingOffer || p.left) return;
    p.makingOffer = true;
    try { await pc.setLocalDescription(await pc.createOffer()); hostedSocket?.emit('signal', { target: p.id, data: { description: pc.localDescription } }); }
    finally { p.makingOffer = false; }
  };
  return pc;
}

const betaAudioSenders = audioSenders;
audioSenders = function betaAudioSendersForHostedRooms() {
  if (currentMode !== 'hosted') return [peer?.audioSender, ...betaAudioSenders()].filter(Boolean);
  return readyHostedPeers().map((participant) => participant.audioSender || participant.pc?.getSenders().find((sender) => sender.track?.kind === 'audio')).filter(Boolean);
};

// A participant can have a valid WebRTC sender a few milliseconds before its
// data channel is marked as ready. Publishing to every existing sender avoids
// randomly skipping exactly that participant when a live starts.
const betaVideoSenders = videoSenders;
videoSenders = function betaVideoSendersForHostedRooms() {
  if (currentMode !== 'hosted') return betaVideoSenders();
  return [...hostedPeers.values()].filter((participant) => !participant.left).flatMap((participant) => [participant.cameraSender || participant.videoSender, participant.screenSender]).filter(Boolean);
};

const betaPublishVideo = publishVideo;
publishVideo = async function publishVideoBeta(track, kind) {
  betaVideoRevision[kind] += 1;
  if (currentMode !== 'hosted') {
    const sender = peer?.[`${kind}Sender`] || (kind === 'camera' ? peer?.videoSender : null);
    if (!sender) return true;
    const needsTrackSwap = sender.track !== track;
    if (needsTrackSwap) await sender.replaceTrack(track);
    if (track) await tuneVideoSender(sender, kind);
    if (track && needsTrackSwap) await betaWaitForEncodedVideo(sender);
    if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'video-on', description: kind, revision: betaVideoRevision[kind] }));
    return true;
  }
  const peers = [...hostedPeers.values()].filter((participant) => !participant.left);
  const results = await Promise.allSettled(peers.map((participant) => syncHostedVideoForPeer(participant, kind, track)));
  if (peers.length && !results.some((result) => result.status === 'fulfilled' && result.value)) throw new Error('Nenhum participante estava pronto para receber video.');
  peers.forEach((participant) => scheduleHostedVideoSync(participant, kind));
};

const betaStopVideo = stopVideo;
stopVideo = async function stopVideoBeta() {
  betaVideoRevision.camera += 1; betaVideoRevision.screen += 1;
  const result = await betaStopVideo();
  if (currentMode === 'hosted') [...hostedPeers.values()].filter((participant) => !participant.left).forEach((participant) => { scheduleHostedVideoSync(participant, 'camera'); scheduleHostedVideoSync(participant, 'screen'); });
  else {
    await Promise.allSettled([
      peer?.cameraSender?.replaceTrack(betaPlaceholderVideoTrack('camera')),
      peer?.screenSender?.replaceTrack(betaPlaceholderVideoTrack('screen'))
    ].filter(Boolean));
  }
  return result;
};

function refreshLocalVideoPreview() {
  const preview = document.querySelector('#local-video');
  if (!preview) return;
  const stream = screenStream || cameraStream || null;
  preview.srcObject = stream;
  preview.classList.toggle('visible', Boolean(stream));
  if (stream) preview.play().catch(() => {});
}

async function stopCamera() {
  const track = cameraStream?.getVideoTracks?.()[0];
  if (!track) return;
  cameraStream.getTracks().forEach((item) => item.stop()); cameraStream = null;
  betaVideoRevision.camera += 1;
  if (currentMode === 'hosted') {
    const peers = [...hostedPeers.values()].filter((participant) => !participant.left);
    await Promise.allSettled(peers.map((participant) => syncHostedVideoForPeer(participant, 'camera', null)));
    peers.forEach((participant) => scheduleHostedVideoSync(participant, 'camera'));
  } else {
    await peer?.cameraSender?.replaceTrack(betaPlaceholderVideoTrack('camera')).catch(() => {});
    if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'video-off', description: 'camera', revision: betaVideoRevision.camera }));
  }
  document.querySelector('#cam-button')?.classList.remove('on'); refreshLocalVideoPreview(); refreshVideoButtons();
}

async function stopScreenShare() {
  const track = screenStream?.getVideoTracks?.()[0];
  if (!track) return;
  track.onended = null;
  screenStream.getTracks().forEach((item) => item.stop()); screenStream = null;
  await stopSharedSystemAudio(); betaVideoRevision.screen += 1;
  if (currentMode === 'hosted') {
    const peers = [...hostedPeers.values()].filter((participant) => !participant.left);
    await Promise.allSettled(peers.map((participant) => syncHostedVideoForPeer(participant, 'screen', null)));
    peers.forEach((participant) => scheduleHostedVideoSync(participant, 'screen'));
  } else {
    await peer?.screenSender?.replaceTrack(betaPlaceholderVideoTrack('screen')).catch(() => {});
    if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'video-off', description: 'screen', revision: betaVideoRevision.screen }));
  }
  document.querySelector('#screen-button')?.classList.remove('share-on'); refreshLocalVideoPreview(); refreshVideoButtons();
}

// Reserve an audio sender for manual P2P too. The offer can be created while
// Windows still displays the microphone permission prompt.
const betaMakePeer = makePeer;
makePeer = function makePeerBeta(role = 'offerer') {
  const pc = betaMakePeer(role);
  peer.videoStreams = {}; peer.videoExpectedKinds = {}; peer.mediaViewKinds = { camera: true, screen: false };
  if (role !== 'answerer') {
    if (!peer.audioSender) {
      const existing = pc.getSenders().find((sender) => sender.track?.kind === 'audio');
      peer.audioSender = existing || pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    }
    const cameraTransceiver = pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'video');
    const initialCameraTrack = betaTransportVideoTrack('camera');
    const initialScreenTrack = betaTransportVideoTrack('screen');
    peer.cameraOutgoingStream = new MediaStream([initialCameraTrack]);
    peer.screenOutgoingStream = new MediaStream([initialScreenTrack]);
    const screenTransceiver = pc.addTransceiver(initialScreenTrack, { direction: 'sendrecv', streams: [peer.screenOutgoingStream] });
    peer.cameraSender = cameraTransceiver?.sender; peer.cameraReceiver = cameraTransceiver?.receiver; peer.videoSender = peer.cameraSender;
    peer.screenSender = screenTransceiver.sender; peer.screenReceiver = screenTransceiver.receiver;
    if (peer.cameraSender) peer.cameraSender.replaceTrack(initialCameraTrack).catch(() => {});
    if (betaActiveVideoTrack('camera') && peer.cameraSender) tuneVideoSender(peer.cameraSender, 'camera').catch(() => {});
    if (betaActiveVideoTrack('screen')) tuneVideoSender(peer.screenSender, 'screen').catch(() => {});
  }
  const originalTrackHandler = pc.ontrack;
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') { originalTrackHandler?.(event); setupManualAudioGain(event.streams?.[0] || new MediaStream([event.track])); setTimeout(applyOutputMute, 0); setTimeout(applyOutputMute, 250); return; }
    const videoTransceivers = pc.getTransceivers().filter((transceiver) => transceiver.receiver?.track?.kind === 'video');
    const videoIndex = videoTransceivers.indexOf(event.transceiver);
    const kind = event.transceiver?.receiver === peer.screenReceiver || videoIndex === 1 ? 'screen' : 'camera';
    const stream = new MediaStream([event.track]); peer.videoStreams[kind] = stream; peer.videoExpectedKinds ||= {}; peer.mediaViewKinds ||= { camera: true, screen: false };
    const reveal = () => {
      if (event.track.readyState !== 'live' || !peer.videoExpectedKinds[kind]) return;
      if (kind === 'screen') renderIncomingMediaOffers(); else showManualMedia('camera');
    };
    event.track.onunmute = reveal;
    event.track.onended = () => {
      peer.videoExpectedKinds[kind] = false;
      if (kind === 'screen') peer.mediaViewKinds.screen = false;
      hideVideoTile(`manual-${kind}`); renderIncomingMediaOffers();
    };
    reveal();
  };
  window.voiceupBindManualAnswerMedia = async () => {
    if (peer?.pc !== pc) return;
    await bindHostedAnswerMedia(peer);
  };
  return pc;
};

const betaBindChannel = bindChannel;
bindChannel = function bindChannelBeta(channel) {
  betaBindChannel(channel);
  const originalOpen = channel.onopen;
  channel.onopen = async (...args) => {
    originalOpen?.apply(channel, args);
    for (const kind of ['camera', 'screen']) {
      const track = betaActiveVideoTrack(kind); const sender = peer?.[`${kind}Sender`];
      if (track && sender) {
        if (sender.track !== track) await sender.replaceTrack(track).catch(() => {});
        await tuneVideoSender(sender, kind).catch(() => {});
        await betaWaitForEncodedVideo(sender).catch(() => {});
        if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'video-on', description: kind, revision: betaVideoRevision[kind] }));
      }
    }
  };
};

async function createHostedPeer(id, name, initiator, color, avatarPhoto = '') {
  if (hostedPeers.has(id)) return hostedPeers.get(id);
  const p = { id, name: name || 'Visitante', color: safeColor(color), avatar: safeAvatar(avatarPhoto), channel: null, pc: null, pendingCandidates: [], connected: false, muted: false, speaking: false, left: false, videoStream: null, videoLabel: 'Video recebido', makingOffer: false, ignoreOffer: false, isPolite: String(hostedSocket?.id || '').localeCompare(String(id)) > 0 };
  hostedPeers.set(id, p);
  makeHostedConnection(p, initiator);
  renderHostedParticipants();
  showHostedStage(p, false);
  if (initiator) {
    bindHostedChannel(p, p.pc.createDataChannel('voiceup-chat'));
    p.makingOffer = true;
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      hostedSocket.emit('signal', { target: id, data: { description: p.pc.localDescription } });
    } finally { p.makingOffer = false; }
  }
  return p;
}

function applyHostedSpeaking(p, speaking) {
  if (!p) return;
  p.speaking = Boolean(speaking);
  clearTimeout(p.speakingTimeout);
  if (p.speaking) {
    // A periodic sender refreshes this before it expires. The timeout only
    // prevents a frozen aura after abrupt disconnects or suspended clients.
    p.speakingTimeout = setTimeout(() => {
      p.speaking = false;
      renderHostedParticipants();
      renderCentralCallMembers?.();
    }, 2600);
  }
  renderHostedParticipants();
  renderCentralCallMembers?.();
}

const betaTypingPeople = new Map();
let betaLocalTyping = false;
let betaTypingHeartbeat = null;
let betaTypingIdle = null;
const betaTypingIndicator = document.createElement('div');
betaTypingIndicator.id = 'typing-indicator';
betaTypingIndicator.className = 'typing-indicator hidden';
document.querySelector('#message-form')?.before(betaTypingIndicator);

function renderTypingIndicator() {
  const now = Date.now();
  for (const [id, person] of betaTypingPeople) if (!person.active || person.expiresAt <= now) betaTypingPeople.delete(id);
  const people = [...betaTypingPeople.values()].filter((person) => person.channel === activeTextChannel).slice(0, 3);
  betaTypingIndicator.classList.toggle('hidden', !people.length);
  betaTypingIndicator.innerHTML = people.map((person) => {
    const photo = safeAvatar(person.avatar);
    const avatarStyle = `background:${safeColor(person.color)}${photo ? `;background-image:url('${photo}');background-size:cover;background-position:center` : ''}`;
    return `<div class="typing-person"><span class="typing-avatar" style="${avatarStyle}">${photo ? '' : initials(person.name)}</span><span><b>${escapeHtml(person.name)}</b> está digitando</span><i class="typing-dots" aria-label="digitando"><em></em><em></em><em></em></i></div>`;
  }).join('');
}

function applyRemoteTyping(id, state, fallback = {}) {
  if (!id || id === hostedSocket?.id) return;
  clearTimeout(betaTypingPeople.get(id)?.timer);
  if (!state?.active) betaTypingPeople.delete(id);
  else {
    const person = {
      active: true,
      name: state.name || fallback.name || 'Participante',
      color: state.color || fallback.color || AVATAR_COLORS[0],
      avatar: state.avatar || fallback.avatar || '',
      channel: ROOM_CHANNELS.text.includes(state.channel) ? state.channel : 'geral',
      expiresAt: Date.now() + 3600
    };
    person.timer = setTimeout(() => { betaTypingPeople.delete(id); renderTypingIndicator(); }, 3700);
    betaTypingPeople.set(id, person);
  }
  renderTypingIndicator();
}

function broadcastTypingState(active) {
  const state = { active: Boolean(active), channel: activeTextChannel, name: myName, color: myColor, avatar: myAvatar };
  if (currentMode === 'hosted' && hostedSocket?.connected) {
    const targets = new Set([...serverMembers.keys(), ...hostedPeers.keys()]);
    for (const id of targets) if (id && id !== hostedSocket.id) hostedSocket.emit('signal', { target: id, data: { typingState: state } });
  } else if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'typing-state', ...state }));
}

function stopLocalTyping() {
  clearInterval(betaTypingHeartbeat); clearTimeout(betaTypingIdle);
  betaTypingHeartbeat = null; betaTypingIdle = null;
  if (betaLocalTyping) { betaLocalTyping = false; broadcastTypingState(false); }
}

function refreshLocalTyping() {
  const active = Boolean(document.querySelector('#message-input')?.value.trim());
  if (!active) return stopLocalTyping();
  if (!betaLocalTyping) {
    betaLocalTyping = true; broadcastTypingState(true);
    betaTypingHeartbeat = setInterval(() => betaLocalTyping && broadcastTypingState(true), 1500);
  }
  clearTimeout(betaTypingIdle);
  betaTypingIdle = setTimeout(stopLocalTyping, 2400);
}

document.querySelector('#message-input')?.addEventListener('input', refreshLocalTyping);
document.querySelector('#message-input')?.addEventListener('blur', stopLocalTyping);
document.querySelector('#message-form')?.addEventListener('submit', () => setTimeout(stopLocalTyping));
setInterval(renderTypingIndicator, 1000);

// Mention autocomplete stays entirely inside the current server. The server
// receives stable socket IDs, so only the intended recipient highlights it.
const mentionForm = document.querySelector('#message-form');
const mentionInput = document.querySelector('#message-input');
const mentionPopup = document.createElement('div');
mentionPopup.id = 'mention-suggestions'; mentionPopup.className = 'mention-suggestions hidden'; mentionPopup.setAttribute('role', 'listbox');
mentionForm?.append(mentionPopup);
let mentionSelection = 0;
let visibleMentionMembers = [];
const mentionMatchAtCaret = () => {
  const caret = mentionInput?.selectionStart ?? 0;
  const before = mentionInput?.value.slice(0, caret) || '';
  const match = before.match(/(?:^|\s)@([^\s@]*)$/u);
  return match ? { query: match[1], start: caret - match[1].length - 1, end: caret } : null;
};
const mentionCandidates = (query) => {
  const normalized = String(query || '').toLocaleLowerCase();
  const values = currentMode === 'hosted'
    ? [...serverMembers.values()].filter((member) => member.id && member.id !== hostedSocket?.id)
    : (peer?.name ? [{ id: peer.clientId || 'manual-peer', name: peer.name, color: peer.color, avatar: peer.avatar, status: peer.status || 'online' }] : []);
  return values.filter((member) => String(member.name || '').toLocaleLowerCase().includes(normalized)).slice(0, 3);
};
const closeMentionPopup = () => { mentionPopup.classList.add('hidden'); mentionPopup.innerHTML = ''; visibleMentionMembers = []; mentionSelection = 0; };
const chooseMention = (index = mentionSelection) => {
  const match = mentionMatchAtCaret(); const member = visibleMentionMembers[index];
  if (!match || !member || !mentionInput) return closeMentionPopup();
  mentionInput.value = `${mentionInput.value.slice(0, match.start)}@${member.name} ${mentionInput.value.slice(match.end)}`;
  const caret = match.start + member.name.length + 2;
  mentionInput.setSelectionRange(caret, caret); mentionInput.focus(); closeMentionPopup(); refreshLocalTyping();
};
const renderMentionPopup = () => {
  const match = mentionMatchAtCaret();
  if (!match) return closeMentionPopup();
  visibleMentionMembers = mentionCandidates(match.query); mentionSelection = Math.min(mentionSelection, Math.max(0, visibleMentionMembers.length - 1));
  if (!visibleMentionMembers.length) return closeMentionPopup();
  mentionPopup.innerHTML = visibleMentionMembers.map((member, index) => `<button type="button" role="option" aria-selected="${index === mentionSelection}" class="mention-option${index === mentionSelection ? ' active' : ''}" data-mention-index="${index}">${betaMemberAvatar(member)}<span><strong>@${escapeHtml(member.name)}</strong><small>${escapeHtml(betaChannelName(member.voiceChannel || '', 'voice') || (betaT('state.outside') || 'Fora da call'))}</small></span></button>`).join('');
  mentionPopup.classList.remove('hidden');
  mentionPopup.querySelectorAll('[data-mention-index]').forEach((button) => button.addEventListener('mousedown', (event) => { event.preventDefault(); chooseMention(Number(button.dataset.mentionIndex)); }));
};
mentionInput?.addEventListener('input', renderMentionPopup);
mentionInput?.addEventListener('click', renderMentionPopup);
mentionInput?.addEventListener('keydown', (event) => {
  if (mentionPopup.classList.contains('hidden')) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); mentionSelection = (mentionSelection + (event.key === 'ArrowDown' ? 1 : -1) + visibleMentionMembers.length) % visibleMentionMembers.length; renderMentionPopup(); }
  else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); chooseMention(); }
  else if (event.key === 'Escape') { event.preventDefault(); closeMentionPopup(); }
});
mentionInput?.addEventListener('blur', () => setTimeout(closeMentionPopup, 120));

// Built-in emoji/GIF picker. It does not require an account or API key. GIFs
// are loaded from their public origin and the server stores only the URL.
const betaEmojiGroups = [
  ['Mais usados', ['😀','😂','🥰','😍','🤔','😭','😎','🥳','😅','😊','🙃','😴','🤯','🫡','🫠','👀']],
  ['Gestos', ['👍','👎','👏','🙌','🙏','🤝','💪','✌️','🤟','👌','🫶','👋','🤦','🤷','💅','🫂']],
  ['Símbolos', ['❤️','💙','💜','💚','🧡','💛','🔥','✨','⭐','🎉','✅','❌','⚠️','💯','🚀','🎮']],
  ['RPG e diversão', ['🎲','🐉','⚔️','🛡️','🏹','🧙','👑','💎','🗺️','🧪','🎵','🎧','🍕','☕','🌙','☀️']]
];
const betaEmojiKeywords = {
  '😀':'feliz sorriso alegria', '😂':'rindo risada choro', '🥰':'amor carinho apaixonado', '😍':'amor olhos coração', '🤔':'pensando dúvida', '😭':'chorando triste', '😎':'legal óculos', '🥳':'festa parabéns', '😴':'sono dormindo', '🤯':'chocado cabeça explodindo', '👀':'olhando olhos',
  '👍':'sim gostei positivo', '👎':'não negativo', '👏':'palmas aplausos', '🙏':'obrigado por favor', '💪':'força', '👋':'oi tchau aceno', '🤷':'não sei', '❤️':'amor coração vermelho', '🔥':'fogo quente', '✨':'brilho estrelas', '🎉':'festa comemoração', '✅':'certo confirmado', '❌':'errado cancelar', '⚠️':'aviso atenção', '🚀':'foguete rápido', '🎮':'jogo gamer', '🎲':'dado rpg', '🐉':'dragão rpg', '⚔️':'espada luta rpg', '🛡️':'escudo rpg', '🎵':'música', '🎧':'fone música'
};
const betaGifCatalog = [
  { title: 'Digitando rápido', tags: 'digitando teclado gato trabalho', url: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif' },
  { title: 'Rindo muito', tags: 'rindo risada feliz', url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif' },
  { title: 'Mente explodindo', tags: 'chocado surpresa mente explodindo', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
  { title: 'Comemorando', tags: 'festa comemorar feliz vitória', url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif' },
  { title: 'Aplausos', tags: 'palmas parabéns aplausos', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif' },
  { title: 'Carregando', tags: 'espera carregando pensando', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif' },
  { title: 'Olá', tags: 'oi olá aceno hello', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif' },
  { title: 'Não acredito', tags: 'não acredito surpresa', url: 'https://media.giphy.com/media/12XMGIWtrHBl5e/giphy.gif' },
  { title: 'Boa ideia', tags: 'sim certo boa ideia gostei', url: 'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif' },
  { title: 'Vitória', tags: 'vitória ganhar jogo gamer', url: 'https://media.giphy.com/media/lnlAifQdenMxW/giphy.gif' },
  { title: 'Obrigado', tags: 'obrigado valeu gratidão', url: 'https://media.giphy.com/media/3oz8xIsloV7zOmt81G/giphy.gif' },
  { title: 'Vamos jogar', tags: 'jogo gamer jogar controle', url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif' }
];
const betaMessageForm = document.querySelector('#message-form');
const betaMessageInput = document.querySelector('#message-input');
const betaSendButton = betaMessageForm?.querySelector('button[type="submit"], button:not([type])');
const betaEmojiButton = document.createElement('button');
betaEmojiButton.type = 'button'; betaEmojiButton.id = 'emoji-button'; betaEmojiButton.className = 'emoji-button';
betaEmojiButton.title = 'Escolher emoji · no Windows também use Win + .'; betaEmojiButton.setAttribute('aria-label', 'Escolher emoji');
betaEmojiButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9h.01M15 9h.01"/></svg>';
const betaEmojiPicker = document.createElement('section');
betaEmojiPicker.id = 'emoji-picker'; betaEmojiPicker.className = 'emoji-picker hidden'; betaEmojiPicker.setAttribute('aria-label', 'Emojis e GIFs');
betaEmojiPicker.innerHTML = '<header><strong>Emojis e GIFs</strong><small>Win + . também funciona</small></header><nav class="emoji-tabs"><button type="button" class="active" data-picker-tab="emoji">Emojis</button><button type="button" data-picker-tab="gif">GIFs</button></nav><label class="emoji-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="emoji-search-input" type="search" placeholder="Pesquisar emojis" autocomplete="off"/></label><div id="emoji-picker-results"></div><footer><span>Formatação:</span> <code>**negrito**</code> <code>*itálico*</code> <code>`código`</code></footer>';
if (betaMessageForm && betaMessageInput && betaSendButton) { betaMessageForm.insertBefore(betaEmojiButton, betaSendButton); document.body.append(betaEmojiPicker); }
let betaPickerTab = 'emoji';
const normalizePickerSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const renderPickerResults = () => {
  const query = normalizePickerSearch(document.querySelector('#emoji-search-input')?.value);
  const results = betaEmojiPicker.querySelector('#emoji-picker-results');
  if (betaPickerTab === 'gif') {
    const gifs = betaGifCatalog.filter((gif) => !query || normalizePickerSearch(`${gif.title} ${gif.tags}`).includes(query));
    results.innerHTML = gifs.length ? `<div class="gif-grid">${gifs.map((gif) => `<button type="button" data-gif="${gif.url}" title="${gif.title}"><img src="${gif.url}" alt="${gif.title}" loading="lazy"/><span>${gif.title}</span></button>`).join('')}</div>` : '<p class="picker-empty">Nenhum GIF encontrado.</p>';
  } else {
    results.innerHTML = betaEmojiGroups.map(([name, emojis]) => {
      const filtered = emojis.filter((emoji) => !query || normalizePickerSearch(`${emoji} ${name} ${betaEmojiKeywords[emoji] || ''}`).includes(query));
      return filtered.length ? `<div class="emoji-group"><h4>${name}</h4><div>${filtered.map((emoji) => `<button type="button" data-emoji="${emoji}" title="${betaEmojiKeywords[emoji] || emoji}">${emoji}</button>`).join('')}</div></div>` : '';
    }).join('') || '<p class="picker-empty">Nenhum emoji encontrado.</p>';
  }
};
const closeEmojiPicker = () => { betaEmojiPicker.classList.add('hidden'); betaEmojiButton.setAttribute('aria-expanded', 'false'); };
const placeEmojiPicker = () => {
  const anchor = betaEmojiButton.getBoundingClientRect(); const width = Math.min(340, innerWidth - 20); const height = Math.min(390, innerHeight - 20);
  betaEmojiPicker.style.width = `${width}px`; betaEmojiPicker.style.maxHeight = `${height}px`;
  betaEmojiPicker.style.left = `${Math.max(10, Math.min(innerWidth - width - 10, anchor.right - width))}px`;
  betaEmojiPicker.style.top = `${Math.max(10, anchor.top - Math.min(height, betaEmojiPicker.scrollHeight || height) - 8)}px`;
};
betaEmojiButton.addEventListener('click', (event) => { event.stopPropagation(); betaEmojiPicker.classList.toggle('hidden'); const open = !betaEmojiPicker.classList.contains('hidden'); betaEmojiButton.setAttribute('aria-expanded', String(open)); if (open) { renderPickerResults(); requestAnimationFrame(() => { placeEmojiPicker(); document.querySelector('#emoji-search-input')?.focus(); }); } });
betaEmojiPicker.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-picker-tab]');
  if (tab) { betaPickerTab = tab.dataset.pickerTab; betaEmojiPicker.querySelectorAll('[data-picker-tab]').forEach((button) => button.classList.toggle('active', button === tab)); const search = document.querySelector('#emoji-search-input'); search.placeholder = betaPickerTab === 'gif' ? 'Pesquisar GIFs' : 'Pesquisar emojis'; search.value = ''; renderPickerResults(); return; }
  const button = event.target.closest('[data-emoji],[data-gif]'); if (!button || !betaMessageInput) return;
  const content = button.dataset.emoji || button.dataset.gif; const start = betaMessageInput.selectionStart ?? betaMessageInput.value.length; const end = betaMessageInput.selectionEnd ?? start;
  const available = Math.max(0, Number(betaMessageInput.maxLength || 500) - (betaMessageInput.value.length - (end - start)));
  betaMessageInput.setRangeText(content.slice(0, available), start, end, 'end'); betaMessageInput.dispatchEvent(new Event('input', { bubbles: true })); betaMessageInput.focus();
  if (button.dataset.gif) { closeEmojiPicker(); betaMessageForm?.requestSubmit(); }
});
betaEmojiPicker.querySelector('#emoji-search-input')?.addEventListener('input', renderPickerResults);
document.addEventListener('click', (event) => { if (!betaEmojiPicker.contains(event.target) && event.target !== betaEmojiButton) closeEmojiPicker(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeEmojiPicker(); });
addEventListener('resize', () => { if (!betaEmojiPicker.classList.contains('hidden')) placeEmojiPicker(); });

const betaSelectTextChannel = selectTextChannel;
selectTextChannel = function selectTextChannelBeta(channel) {
  stopLocalTyping();
  const result = betaSelectTextChannel(channel);
  renderTypingIndicator();
  if (typeof syncHostedLobbyLayout === 'function') syncHostedLobbyLayout();
  return result;
};

const betaReceiveDataForTyping = receiveData;
receiveData = async function receiveDataBetaTyping(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'typing-state') { applyRemoteTyping('manual-peer', msg, peer || {}); return; }
    if (msg.type === 'media-view-request' && ['camera', 'screen'].includes(msg.kind)) {
      const track = betaActiveVideoTrack(msg.kind);
      const sender = peer?.[`${msg.kind}Sender`] || (msg.kind === 'camera' ? peer?.videoSender : null);
      if (track && sender) {
        if (sender.track !== track) await sender.replaceTrack(track).catch(() => {});
        await tuneVideoSender(sender, msg.kind).catch(() => {});
        await betaWaitForEncodedVideo(sender).catch(() => {});
        if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'video-on', description: msg.kind, revision: betaVideoRevision[msg.kind] }));
      }
      return;
    }
    if (msg.type === 'video-on' && ['camera', 'screen'].includes(msg.description)) {
      const kind = msg.description;
      peer.videoExpectedKinds ||= {}; peer.mediaViewKinds ||= { camera: true, screen: false };
      peer.videoExpectedKinds[kind] = true;
      if (kind === 'camera' && peer.videoStreams?.camera) showManualMedia('camera');
      renderIncomingMediaOffers();
      return;
    }
    if (msg.type === 'video-off' && ['camera', 'screen'].includes(msg.description)) {
      peer.videoExpectedKinds ||= {}; peer.mediaViewKinds ||= { camera: true, screen: false };
      peer.videoExpectedKinds[msg.description] = false;
      if (msg.description === 'screen') peer.mediaViewKinds.screen = false;
      hideVideoTile(`manual-${msg.description}`); renderIncomingMediaOffers(); return;
    }
  } catch { /* normal receiver reports malformed connection data */ }
  return betaReceiveDataForTyping(raw);
};

const mediaViewState = (participant) => {
  participant.mediaViewKinds ||= { camera: true, screen: false };
  return participant.mediaViewKinds;
};

const mediaStreamFor = (participant, kind) => participant?.videoStreams?.[kind]
  || (kind === 'camera'
    ? participant?.videoStream
    : (betaUsesLegacyVideoSlot(participant) && !participant?.videoExpectedKinds?.camera
      ? (participant?.videoStreams?.camera || participant?.videoStream)
      : null));

function setMediaParticipantVolume(participant, value) {
  const safe = Math.max(0, Math.min(200, Number(value) || 0));
  if (participant === peer) manualParticipantVolume = safe;
  else if (participant) participant.volume = safe;
  applyOutputMute();
  return safe;
}

function decorateRemoteMediaTile(id, kind, participant) {
  const tile = videoGallery.querySelector(`[data-video-peer="${videoTileId(id)}"]`);
  if (!tile) return;
  tile.dataset.mediaKind = kind;
  tile.dataset.mediaOwner = participant === peer ? 'manual-peer' : String(participant?.id || '');
  tile.querySelector('.media-tile-controls')?.remove();
  const volume = participant === peer ? Number(manualParticipantVolume || 100) : Number(participant?.volume ?? 100);
  const controls = document.createElement('div');
  controls.className = 'media-tile-controls';
  controls.innerHTML = `${kind === 'screen' ? `<label title="Volume da transmissão"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg><input data-media-volume type="range" min="0" max="200" step="1" value="${Math.round(volume)}"/><b>${Math.round(volume)}%</b></label>` : ''}<button type="button" data-media-view-close title="${kind === 'screen' ? 'Sair da transmissão' : 'Ocultar esta câmera'}" aria-label="${kind === 'screen' ? 'Sair da transmissão' : 'Ocultar esta câmera'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M10.7 10.7a2 2 0 0 0 2.6 2.6M9.9 4.2A10.8 10.8 0 0 1 21 12a12.7 12.7 0 0 1-3.1 4.4M6.2 6.2A12.8 12.8 0 0 0 3 12a11.7 11.7 0 0 0 7.6 6.6"/></svg></button>`;
  tile.append(controls);
}

function showManualMedia(kind = 'camera') {
  if (!peer) return false;
  const view = mediaViewState(peer);
  if ((kind === 'screen' && !view.screen) || (kind === 'camera' && view.camera === false)) { renderIncomingMediaOffers(); return false; }
  const stream = mediaStreamFor(peer, kind);
  const track = stream?.getVideoTracks?.()[0];
  if (!track || track.readyState === 'ended') return false;
  const id = `manual-${kind}`;
  const shown = displayRemoteVideo(stream, `${peer.name || 'Participante'} - ${kind === 'screen' ? 'Tela compartilhada' : 'Câmera'}`, id);
  if (shown) decorateRemoteMediaTile(id, kind, peer);
  return shown;
}

function renderIncomingMediaOffers() {
  // A live is discovered from the person who owns it. Re-rendering exposes a
  // compact badge on their avatar rather than showing a floating alert.
  document.querySelector('#incoming-media-offers')?.remove();
  if (currentMode === 'hosted') renderRoomChannels();
  renderBetaMembers();
  renderCentralCallMembers();
}

function mediaParticipantByOwner(owner) {
  return owner === 'manual-peer' ? peer : hostedPeers.get(owner);
}

document.addEventListener('click', (event) => {
  const offer = event.target.closest?.('[data-media-offer-owner]');
  if (offer) {
    event.preventDefault(); event.stopPropagation();
    const participant = mediaParticipantByOwner(offer.dataset.mediaOfferOwner); if (!participant) return;
    const kind = offer.dataset.mediaOfferKind; mediaViewState(participant)[kind] = true;
    if (participant === peer) showManualMedia(kind); else showHostedVideo(participant, kind === 'screen' ? 'Tela compartilhada' : 'Câmera', kind);
    renderIncomingMediaOffers(); return;
  }
  const close = event.target.closest?.('[data-media-view-close]');
  if (close) {
    const tile = close.closest('.video-tile'); const participant = mediaParticipantByOwner(tile?.dataset.mediaOwner); const kind = tile?.dataset.mediaKind;
    if (!participant || !kind) return;
    mediaViewState(participant)[kind] = false;
    hideVideoTile(participant === peer ? `manual-${kind}` : `${participant.id}-${kind}`);
    renderIncomingMediaOffers(); return;
  }
});

document.addEventListener('input', (event) => {
  const input = event.target.closest?.('[data-media-volume]'); if (!input) return;
  const tile = input.closest('.video-tile'); const participant = mediaParticipantByOwner(tile?.dataset.mediaOwner); if (!participant) return;
  const value = setMediaParticipantVolume(participant, input.value); input.nextElementSibling.textContent = `${Math.round(value)}%`;
});

function applyHostedVideoState(p, active, description, revision) {
  if (!p) return;
  const kind = description === 'screen' ? 'screen' : 'camera';
  p.videoRevisions ||= {}; p.videoExpectedKinds ||= {}; p.videoStreams ||= {}; p.videoLabels ||= {}; p.videoMuteTimers ||= {};
  if (Number.isFinite(revision) && Number.isFinite(p.videoRevisions[kind]) && revision < p.videoRevisions[kind]) return;
  if (Number.isFinite(revision)) p.videoRevisions[kind] = revision;
  p.videoExpectedKinds[kind] = Boolean(active);
  mediaViewState(p);
  if (!p.videoExpectedKinds[kind]) {
    if (kind === 'screen') p.mediaViewKinds.screen = false;
    clearTimeout(p.videoMuteTimers[kind]); hideVideoTile(`${p.id}-${kind}`); renderIncomingMediaOffers(); return;
  }
  // Some Windows WebRTC builds dispatch the incoming video track before the
  // corresponding video-state signal and omit its transceiver. If it landed in
  // the other slot while that slot is inactive, recover it instead of leaving
  // the viewer with a permanently unavailable "Assistir live" button.
  const otherKind = kind === 'screen' ? 'camera' : 'screen';
  if (betaUsesLegacyVideoSlot(p) && !p.videoStreams[kind] && p.videoStreams[otherKind] && !p.videoExpectedKinds[otherKind]) {
    p.videoStreams[kind] = p.videoStreams[otherKind];
    delete p.videoStreams[otherKind];
  }
  p.videoLabels[kind] = kind === 'screen' ? 'Tela compartilhada' : 'Camera';
  const reveal = () => p.videoExpectedKinds[kind] && p.videoStreams[kind] && showHostedVideo(p, p.videoLabels[kind], kind);
  reveal(); renderIncomingMediaOffers(); setTimeout(reveal, 180); setTimeout(reveal, 700);
  // State messages can beat the actual WebRTC track on Windows. Request one
  // targeted re-announcement only when no usable receiver exists. A muted
  // static receiver is normal while WebRTC starts; resetting it there causes
  // a feedback loop and flickering when two people share simultaneously.
  const videoTrack = p.videoStreams[kind]?.getVideoTracks?.()[0];
  if (!videoTrack || videoTrack.readyState === 'ended') {
    p.mediaRecoveryRevisions ||= {};
    const recoveryKey = `${revision ?? 'current'}:${kind}`;
    if (p.mediaRecoveryRevisions[kind] !== recoveryKey && hostedSocket?.connected && p.id) {
      p.mediaRecoveryRevisions[kind] = recoveryKey;
      setTimeout(() => {
        if (p.left || !p.videoExpectedKinds?.[kind] || p.mediaRecoveryRevisions?.[kind] !== recoveryKey) return;
        hostedSocket.emit('signal', { target: p.id, data: { mediaViewRequest: { kind, requestedAt: Date.now(), automatic: true } } });
      }, 220);
    }
  }
}

async function receiveHostedSignal({ from, name, color, avatar, data }) {
  try {
    if (data?.typingState) {
      applyRemoteTyping(from, data.typingState, serverMembers.get(from) || { name, color, avatar });
      return;
    }
    const p = hostedPeers.get(from) || await createHostedPeer(from, name, false, color, avatar);
    if (data?.mediaViewRequest && ['camera', 'screen'].includes(data.mediaViewRequest.kind)) {
      const kind = data.mediaViewRequest.kind;
      const resync = () => syncHostedVideoForPeer(p, kind, betaActiveVideoTrack(kind), true);
      await resync();
      setTimeout(resync, 260);
      setTimeout(resync, 900);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'voiceState')) {
      applyHostedSpeaking(p, data.voiceState);
      return;
    }
    if (data?.videoState) {
      applyHostedVideoState(p, data.videoState.active, data.videoState.kind || data.videoState.description, data.videoState.revision);
      return;
    }
    if (data.description) {
      const description = data.description;
      const offerCollision = description.type === 'offer' && (p.makingOffer || p.pc.signalingState !== 'stable');
      p.ignoreOffer = !p.isPolite && offerCollision;
      if (p.ignoreOffer) return;
      if (offerCollision && p.pc.signalingState !== 'stable') await p.pc.setLocalDescription({ type: 'rollback' });
      await p.pc.setRemoteDescription(description);
      if (description.type === 'offer') await bindHostedAnswerMedia(p);
      if (p.pendingCandidates.length) await Promise.all(p.pendingCandidates.splice(0).map((candidate) => p.pc.addIceCandidate(candidate)));
      if (description.type === 'offer') {
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        hostedSocket.emit('signal', { target: from, data: { description: p.pc.localDescription } });
      }
    }
    if (data.candidate) {
      if (p.ignoreOffer) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate);
      else p.pendingCandidates.push(data.candidate);
    }
  } catch { toast('Erro ao negociar uma conexao da sala.'); }
}

function receiveHostedData(p, raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'chat') { playNotification('message'); return addMessage(msg.text, msg.name || p.name, false, msg.color || p.color, { id: msg.messageId, createdAt: msg.createdAt, avatar: msg.avatar || p.avatar }); }
    if (msg.type === 'chat-edit') { const element = document.querySelector(`[data-message-id="${CSS.escape(String(msg.messageId || ''))}"]`); if (!element) return; updateMessageText(element, msg.text); element.querySelector('.message-edited')?.classList.remove('hidden'); return; }
    if (msg.type === 'intro') { p.name = msg.name || p.name; p.color = safeColor(msg.color || p.color); p.avatar = safeAvatar(msg.avatar || p.avatar); return markHostedConnected(p); }
    if (msg.type === 'video-on') { p.videoLabel = msg.description === 'screen' ? 'Tela compartilhada' : 'Video recebido'; if (p.videoStream) showHostedVideo(p, p.videoLabel); return; }
    if (msg.type === 'video-off') return hideVideoTile(p.id);
    if (msg.type === 'voice-state') applyHostedSpeaking(p, msg.description);
  } catch { toast('Erro ao receber dados de um participante.'); }
}

// Final visual layer: it runs after the legacy dynamic styles and therefore also
// applies to every saved theme while the beta is being evaluated.
document.head.insertAdjacentHTML('beforeend', `<style id="voiceup-beta-final">
:root{--beta-button-ink:#102026}.theme-midnight,.theme-grape{--beta-button-ink:#fff}.theme-ember,.theme-forest,.theme-snow,.theme-lilac,.theme-sage,.theme-peach,.theme-mist{--beta-button-ink:var(--ink)}
.welcome{background:radial-gradient(circle at 16% 22%,color-mix(in srgb,var(--focus) 15%,transparent),transparent 28%),var(--night)!important}.join-card{background:linear-gradient(145deg,color-mix(in srgb,var(--night2) 94%,var(--focus) 7%),var(--surface))!important;border-color:var(--line)!important}.join-card h2,.join-card label,.join-card>p{color:var(--ink)!important}.join-card input,.join-card textarea{background:var(--surface)!important;border-color:var(--line)!important;color:var(--ink)!important}.join-card form>button,#join-host{background:var(--focus)!important;color:var(--beta-button-ink)!important}.join-card form>button span{color:inherit!important}.join-card #profile-photo{color:var(--ink)!important}.join-card #profile-photo::file-selector-button{border:0;border-radius:6px;background:var(--surface-2);color:var(--ink);padding:6px 9px;margin-right:8px}
#right-panel,#right-panel.chat{background:var(--night2)!important}.panel-tabs,.chat form{background:color-mix(in srgb,var(--night2) 92%,var(--night))!important}.message{background:color-mix(in srgb,var(--night) 68%,var(--night2))!important}.message.mine{background:color-mix(in srgb,var(--focus) 22%,var(--night2))!important}
#settings-button{display:grid!important;place-items:center;flex:0 0 37px!important;font-size:0!important;overflow:hidden;padding:0!important;line-height:1!important}#settings-button::before{content:none!important}#settings-button[aria-label]{margin:0!important}.sidebar-actions{align-items:center}.self-card{margin-bottom:0!important}
.local-video:not(.visible){display:none!important}.local-video.visible{display:block!important;object-fit:cover}.round-control.muted,#output-button.muted{background:#542b34!important;color:#ffaaa0!important}
</style>`);

// Compact connection-quality display kept beside the local profile.  The
// numeric sample still updates the legacy participant row when it exists.
const betaLegacyUpdatePingBadge = updatePingBadge;
let betaLatestPing = Number.NaN;
const betaPingQuality = (value) => {
  const ping = Number(value);
  if (!Number.isFinite(ping) || ping < 0) return { level: 0, label: 'Medindo ping…' };
  if (ping <= 60) return { level: 4, label: `Ping ${Math.round(ping)} ms · excelente` };
  if (ping <= 120) return { level: 3, label: `Ping ${Math.round(ping)} ms · bom` };
  if (ping <= 220) return { level: 2, label: `Ping ${Math.round(ping)} ms · moderado` };
  return { level: 1, label: `Ping ${Math.round(ping)} ms · alto` };
};
const paintBetaProfilePing = () => {
  const profileCopy = document.querySelector('.self-profile-copy');
  const statusLabel = document.querySelector('#presence-status-label');
  if (!profileCopy || !statusLabel) return;
  const quality = betaPingQuality(betaLatestPing);
  let statusRow = document.querySelector('#self-presence-row');
  if (!statusRow) {
    statusRow = document.createElement('span');
    statusRow.id = 'self-presence-row';
    statusRow.className = 'self-presence-row';
    statusLabel.before(statusRow);
    statusRow.append(statusLabel);
  }
  let indicator = document.querySelector('#self-ping-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.id = 'self-ping-indicator';
    indicator.className = 'self-ping-indicator';
    indicator.innerHTML = '<i></i><i></i><i></i><i></i>';
    statusRow.append(indicator);
  }
  indicator.dataset.level = String(quality.level);
  indicator.dataset.tooltip = quality.label;
  indicator.title = quality.label;
  indicator.setAttribute('aria-label', quality.label);
};
updatePingBadge = function updatePingBadgeBeta(value) {
  betaLatestPing = Number(value);
  betaLegacyUpdatePingBadge(value);
  paintBetaProfilePing();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintBetaProfilePing, { once: true });
else paintBetaProfilePing();

let betaOutputMuted = storedProfile.outputMuted === true;
let betaInputVolume = Math.max(0, Math.min(200, Number(storedProfile.inputVolume ?? 100) || 0));
let betaOutputVolume = Math.max(0, Math.min(200, Number(storedProfile.outputVolume ?? 100) || 0));
let betaMicGainContext = null;
let betaMicGainNode = null;
let betaMicGainTrack = null;
let betaMicGainSourceTrack = null;
let betaSharedMicGainNode = null;
let manualAudioGainContext = null;
let manualAudioGainNode = null;
let manualParticipantVolume = 100;
const outputButton = document.querySelector('#output-button');
const outputIcon = (muted) => muted
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM19 9l-6 6M13 9l6 6"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg>';
const refreshOutputButton = () => {
  if (!outputButton) return;
  outputButton.innerHTML = outputIcon(betaOutputMuted);
  outputButton.classList.toggle('muted', betaOutputMuted);
  outputButton.title = betaOutputMuted ? 'Ativar áudio recebido' : 'Silenciar todo o áudio recebido';
  outputButton.setAttribute('aria-label', outputButton.title);
};
const applyOutputMute = () => {
  const manualLevel = betaOutputMuted || remoteMuted ? 0 : (betaOutputVolume / 100) * (manualParticipantVolume / 100);
  if (manualAudioGainNode) manualAudioGainNode.gain.value = manualLevel;
  if (remoteAudio) { remoteAudio.muted = Boolean(manualAudioGainNode) || betaOutputMuted || remoteMuted; remoteAudio.volume = Math.min(1, manualLevel); }
  hostedPeers.forEach((item) => {
    const level = betaOutputMuted || item.muted ? 0 : (betaOutputVolume / 100) * (Number(item.volume ?? 100) / 100);
    if (item.audioGainNode) item.audioGainNode.gain.value = level;
    if (item.audio) { item.audio.muted = Boolean(item.audioGainNode) || betaOutputMuted || item.muted; item.audio.volume = Math.min(1, level); }
  });
};
const persistOutputMute = () => {
  try { const profile = JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}'); profile.outputMuted = betaOutputMuted; localStorage.setItem('voiceup-profile-v1', JSON.stringify(profile)); } catch { /* optional local preference */ }
};
outputButton?.addEventListener('click', () => { betaOutputMuted = !betaOutputMuted; applyOutputMute(); refreshOutputButton(); persistOutputMute(); toast(betaOutputMuted ? 'Áudio recebido silenciado.' : 'Áudio recebido ativado.'); });
refreshOutputButton();
applyOutputMute();

const closeMicGain = () => {
  betaMicGainTrack?.stop?.();
  betaMicGainContext?.close?.().catch(() => {});
  betaMicGainContext = null; betaMicGainNode = null; betaMicGainTrack = null; betaMicGainSourceTrack = null;
};
const gainedMicrophoneTrack = () => {
  const rawTrack = localStream?.getAudioTracks?.()[0];
  if (!rawTrack) return null;
  // At the default gain, publish the physical track directly. Besides avoiding
  // needless processing, this preserves one-way audio compatibility with old
  // VoiceUP builds that expect the original getUserMedia stream.
  if (Math.abs(betaInputVolume - 100) < 0.01) {
    closeMicGain();
    return rawTrack;
  }
  if (betaMicGainSourceTrack === rawTrack && betaMicGainTrack?.readyState === 'live') return betaMicGainTrack;
  closeMicGain();
  try {
    betaMicGainContext = new AudioContext();
    const destination = betaMicGainContext.createMediaStreamDestination();
    betaMicGainNode = betaMicGainContext.createGain();
    betaMicGainNode.gain.value = betaInputVolume / 100;
    betaMicGainContext.createMediaStreamSource(new MediaStream([rawTrack])).connect(betaMicGainNode).connect(destination);
    betaMicGainSourceTrack = rawTrack;
    betaMicGainTrack = destination.stream.getAudioTracks()[0];
    betaMicGainContext.resume().catch(() => {});
    return betaMicGainTrack;
  } catch { closeMicGain(); return rawTrack; }
};
const betaRawOutgoingAudioTrack = outgoingAudioTrack;
outgoingAudioTrack = function outgoingAudioTrackBetaGain() { return sharedAudioTrack || gainedMicrophoneTrack() || betaRawOutgoingAudioTrack(); };
const refreshOutgoingMicrophone = async () => {
  closeMicGain();
  const track = outgoingAudioTrack();
  if (track && !sharedAudioTrack) await Promise.allSettled(audioSenders().map((sender) => sender.replaceTrack(track)));
};
const betaRequestAudioForGain = requestAudio;
requestAudio = async function requestAudioBetaGain(...args) { const result = await betaRequestAudioForGain(...args); await refreshOutgoingMicrophone(); return result; };
const betaReplaceMicrophoneForGain = replaceMicrophone;
replaceMicrophone = async function replaceMicrophoneBetaGain(...args) { const result = await betaReplaceMicrophoneForGain(...args); await refreshOutgoingMicrophone(); return result; };
const betaStopSharedSystemAudioForGain = stopSharedSystemAudio;
stopSharedSystemAudio = async function stopSharedSystemAudioBetaGain(...args) { betaSharedMicGainNode = null; return betaStopSharedSystemAudioForGain(...args); };
startSharedSystemAudio = async function startSharedSystemAudioBetaGain() {
  const systemTrack = screenStream?.getAudioTracks?.()[0];
  if (!systemTrack) { if (shareSystemAudio) toast('O sistema não disponibilizou áudio para esta tela ou janela.'); return; }
  try {
    sharedAudioContext = new AudioContext();
    const destination = sharedAudioContext.createMediaStreamDestination();
    const micTrack = localStream?.getAudioTracks?.()[0];
    if (micTrack) {
      betaSharedMicGainNode = sharedAudioContext.createGain();
      betaSharedMicGainNode.gain.value = betaInputVolume / 100;
      sharedAudioContext.createMediaStreamSource(new MediaStream([micTrack])).connect(betaSharedMicGainNode).connect(destination);
    }
    sharedAudioContext.createMediaStreamSource(new MediaStream([systemTrack])).connect(destination);
    sharedAudioTrack = destination.stream.getAudioTracks()[0];
    await Promise.allSettled(audioSenders().map((sender) => sender.replaceTrack(sharedAudioTrack)));
  } catch { toast('Não foi possível misturar o áudio do sistema com o microfone.'); }
};
const setAudioContextSink = async (context) => {
  if (!context || typeof context.setSinkId !== 'function') return;
  await context.setSinkId(audioOutputId || 'default').catch(() => {});
};
const closeManualAudioGain = () => { manualAudioGainContext?.close?.().catch(() => {}); manualAudioGainContext = null; manualAudioGainNode = null; };
const setupManualAudioGain = (stream) => {
  closeManualAudioGain();
  try {
    manualAudioGainContext = new AudioContext();
    manualAudioGainNode = manualAudioGainContext.createGain();
    manualAudioGainContext.createMediaStreamSource(stream).connect(manualAudioGainNode).connect(manualAudioGainContext.destination);
    setAudioContextSink(manualAudioGainContext);
    manualAudioGainContext.resume().catch(() => {});
    remoteAudio?.pause?.();
  } catch { closeManualAudioGain(); }
  applyOutputMute();
};
const setupHostedAudioGain = (participant, stream) => {
  participant.audioGainContext?.close?.().catch(() => {});
  participant.audioGainContext = null; participant.audioGainNode = null;
  try {
    participant.audioGainContext = new AudioContext();
    participant.audioGainNode = participant.audioGainContext.createGain();
    participant.audioGainContext.createMediaStreamSource(stream).connect(participant.audioGainNode).connect(participant.audioGainContext.destination);
    setAudioContextSink(participant.audioGainContext);
    participant.audioGainContext.resume().catch(() => {});
    participant.audio?.pause?.();
  } catch { participant.audioGainContext = null; participant.audioGainNode = null; }
  applyOutputMute();
};

const betaApplyAudioOutput = applyAudioOutput;
applyAudioOutput = async function applyAudioOutputBetaMuteSafe() {
  const result = await betaApplyAudioOutput();
  await Promise.allSettled([setAudioContextSink(manualAudioGainContext), ...[...hostedPeers.values()].map((item) => setAudioContextSink(item.audioGainContext))]);
  applyOutputMute();
  setTimeout(applyOutputMute, 100);
  setTimeout(applyOutputMute, 450);
  return result;
};
const betaTogglePeerMute = togglePeerMute;
togglePeerMute = function togglePeerMuteBeta() { const result = betaTogglePeerMute(); applyOutputMute(); return result; };
const betaToggleHostedMute = toggleHostedMute;
toggleHostedMute = function toggleHostedMuteBeta(id) { const result = betaToggleHostedMute(id); applyOutputMute(); return result; };

// Static receive transceivers start with a muted video track. They must not create
// a black tile until a participant actually enables camera or screen sharing.
function showHostedVideo(p, label = 'Video recebido', kind = 'camera') {
  // Clients up to 1.1.0 used a single video transceiver and replaced its
  // camera track with the screen track. Prefer the dedicated beta stream, but
  // keep that legacy path whenever no separate camera is being announced.
  const legacyScreenStream = kind === 'screen' && betaUsesLegacyVideoSlot(p) && !p?.videoExpectedKinds?.camera
    ? (p?.videoStreams?.camera || p?.videoStream)
    : null;
  const stream = p?.videoStreams?.[kind] || (kind === 'camera' ? p?.videoStream : legacyScreenStream);
  const track = stream?.getVideoTracks?.()[0];
  if (!p || !track || track.readyState === 'ended') return false;
  const view = mediaViewState(p);
  if ((kind === 'screen' && !view.screen) || (kind === 'camera' && view.camera === false)) { renderIncomingMediaOffers(); return false; }
  p.videoLabels ||= {}; p.videoLabels[kind] = label;
  activeRemoteId ||= p.id;
  const id = `${p.id}-${kind}`;
  const shown = displayRemoteVideo(stream, `${p.name} - ${label}`, id);
  if (shown) decorateRemoteMediaTile(id, kind, p);
  return shown;
}

function requestParticipantMediaView(participant, kind = 'screen') {
  if (!participant) return false;
  mediaViewState(participant)[kind] = true;
  // Ask the broadcaster to reattach this exact sender. This also recovers
  // when both sides start a live at the same time or one side joined late.
  if (participant === peer) {
    if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'media-view-request', kind }));
  } else if (hostedSocket?.connected && participant.id) {
    hostedSocket.emit('signal', { target: participant.id, data: { mediaViewRequest: { kind, requestedAt: Date.now() } } });
  }
  const label = kind === 'screen' ? 'Tela compartilhada' : 'Câmera';
  const startedAt = performance.now();
  const reveal = () => {
    const expected = participant.videoExpectedKinds?.[kind];
    if (expected === false || participant.left) return;
    const shown = participant === peer ? showManualMedia(kind) : showHostedVideo(participant, label, kind);
    if (!shown && performance.now() - startedAt < 8000) setTimeout(reveal, 180);
  };
  reveal();
  return true;
}

function stopRemoteVoiceDetection(p) {
  if (!p) return;
  p.remoteVoiceSession = (p.remoteVoiceSession || 0) + 1;
  p.remoteVoiceContext?.close?.().catch(() => {});
  p.remoteVoiceContext = null;
  clearTimeout(p.speakingTimeout);
}

function startRemoteVoiceDetection(p, stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!p || !track) return;
  stopRemoteVoiceDetection(p);
  try {
    const session = p.remoteVoiceSession;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .4;
    const samples = new Uint8Array(analyser.fftSize);
    context.createMediaStreamSource(stream).connect(analyser);
    context.resume().catch(() => {});
    p.remoteVoiceContext = context;
    let noiseFloorDb = -70;
    let calibrationSamples = 0;
    let aboveThresholdSince = 0;
    let lastVoiceAt = 0;
    let lastState = false;
    const sample = (now = performance.now()) => {
      if (p.left || p.remoteVoiceSession !== session || track.readyState === 'ended') {
        if (lastState) applyHostedSpeaking(p, false);
        return;
      }
      analyser.getByteTimeDomainData(samples);
      let squareSum = 0;
      for (const value of samples) { const normalized = (value - 128) / 128; squareSum += normalized * normalized; }
      const rms = Math.sqrt(squareSum / samples.length);
      const levelDb = 20 * Math.log10(Math.max(rms, 0.00001));
      if (calibrationSamples < 30) {
        noiseFloorDb = calibrationSamples ? noiseFloorDb * .82 + levelDb * .18 : levelDb;
        calibrationSamples += 1;
      }
      const dynamicThresholdDb = Math.max(-52, noiseFloorDb + 8);
      const aboveThreshold = calibrationSamples >= 30 && levelDb >= dynamicThresholdDb;
      if (!aboveThreshold) {
        aboveThresholdSince = 0;
        const learnRate = levelDb < noiseFloorDb + 5 ? .025 : .004;
        noiseFloorDb = noiseFloorDb * (1 - learnRate) + levelDb * learnRate;
      } else {
        aboveThresholdSince ||= now;
        if (now - aboveThresholdSince >= 85) lastVoiceAt = now;
      }
      const speaking = now - lastVoiceAt < 300;
      if (speaking !== lastState) {
        lastState = speaking;
        applyHostedSpeaking(p, speaking);
      }
      requestAnimationFrame(sample);
    };
    sample();
  } catch { /* old clients still keep normal audio without the aura */ }
}

function attachHostedTrack(p, track, streams, kind = 'camera') {
  const stream = track.kind === 'video' ? new MediaStream([track]) : (streams[0] || new MediaStream([track]));
  if (track.kind === 'audio') {
    p.audio?.pause(); p.audio = new Audio(); p.audio.srcObject = stream; p.audio.autoplay = true; p.audio.muted = betaOutputMuted || p.muted;
    if (audioOutputId && typeof p.audio.setSinkId === 'function') p.audio.setSinkId(audioOutputId).catch(() => {});
    p.audio.play().catch(() => {});
    setupHostedAudioGain(p, stream);
    startRemoteVoiceDetection(p, stream);
    track.addEventListener('ended', () => stopRemoteVoiceDetection(p), { once: true });
    return;
  }
  p.videoStreams ||= {}; p.videoExpectedKinds ||= {}; p.videoLabels ||= {}; p.videoMuteTimers ||= {};
  p.videoStreams[kind] = stream;
  if (kind === 'camera') p.videoStream = stream;
  const reveal = () => {
    clearTimeout(p.videoMuteTimers[kind]);
    if (p.videoExpectedKinds[kind] && track.readyState === 'live') showHostedVideo(p, p.videoLabels[kind] || (kind === 'screen' ? 'Tela compartilhada' : 'Camera'), kind);
    renderIncomingMediaOffers();
  };
  track.onunmute = reveal;
  // replaceTrack may mute the receiver momentarily while Chromium switches the
  // source. The explicit, reliable video-off message owns removal of the tile.
  track.onmute = () => { clearTimeout(p.videoMuteTimers[kind]); p.videoMuteTimers[kind] = setTimeout(reveal, 900); };
  track.onended = () => { p.videoExpectedKinds[kind] = false; if (kind === 'screen') mediaViewState(p).screen = false; hideVideoTile(`${p.id}-${kind}`); renderIncomingMediaOffers(); };
  reveal();
}

const betaRemoveHostedPeerForVoice = removeHostedPeer;
removeHostedPeer = function removeHostedPeerBetaVoice(id, name) {
  const participant = hostedPeers.get(id);
  stopRemoteVoiceDetection(participant);
  participant?.audioGainContext?.close?.().catch(() => {});
  hideVideoTile(`${id}-camera`); hideVideoTile(`${id}-screen`);
  const result = betaRemoveHostedPeerForVoice(id, name); renderIncomingMediaOffers(); return result;
};
const betaClearHostedVoiceForVoice = clearHostedVoice;
clearHostedVoice = function clearHostedVoiceBetaVoice() {
  hostedPeers.forEach((participant) => { stopRemoteVoiceDetection(participant); participant.audioGainContext?.close?.().catch(() => {}); hideVideoTile(`${participant.id}-camera`); hideVideoTile(`${participant.id}-screen`); });
  const result = betaClearHostedVoiceForVoice(); renderIncomingMediaOffers(); return result;
};
function receiveHostedData(p, raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'chat') { playNotification('message'); return addMessage(msg.text, msg.name || p.name, false, msg.color || p.color); }
    if (msg.type === 'intro') { p.name = msg.name || p.name; p.color = safeColor(msg.color || p.color); p.avatar = safeAvatar(msg.avatar || p.avatar); return markHostedConnected(p); }
    if (msg.type === 'video-on') return applyHostedVideoState(p, true, msg.description, msg.revision);
    if (msg.type === 'video-off') return applyHostedVideoState(p, false, msg.description || 'camera', msg.revision);
    if (msg.type === 'voice-state') applyHostedSpeaking(p, msg.description);
  } catch { toast('Erro ao receber dados de um participante.'); }
}

const normalizeSettingsButton = () => {
  const button = document.querySelector('#settings-button');
  if (!button || button.dataset.betaIcon === 'ready') return;
  button.dataset.betaIcon = 'ready';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>';
  button.title = 'Configurações';
  button.setAttribute('aria-label', 'Configurações');
};
normalizeSettingsButton();
const settingsButton = document.querySelector('#settings-button');
if (settingsButton) new MutationObserver(() => {
  if (settingsButton.querySelector('svg')) return;
  settingsButton.dataset.betaIcon = '';
  normalizeSettingsButton();
}).observe(settingsButton, { childList: true, characterData: true, subtree: true });
// Settings belongs beside the compact microphone/output controls, not in its
// own row underneath the profile card.
const footerMediaState = document.querySelector('.self-media-state');
if (settingsButton && footerMediaState && settingsButton.parentElement !== footerMediaState) footerMediaState.append(settingsButton);
if (footerMediaState && !document.querySelector('#disconnect-server-button')) {
  footerMediaState.insertAdjacentHTML('beforeend', '<button id="disconnect-server-button" type="button" class="footer-account-action" title="Desconectar do servidor" aria-label="Desconectar do servidor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M18 12H8"/></svg></button>');
}
const disconnectServerButton = document.querySelector('#disconnect-server-button');
const refreshDisconnectServerLabel = () => {
  if (!disconnectServerButton) return;
  const labels = {
    'pt-BR': 'Desconectar do servidor',
    'en-US': 'Disconnect from server',
    'es-ES': 'Desconectarse del servidor',
    'fr-FR': 'Se déconnecter du serveur'
  };
  disconnectServerButton.title = labels[language] || labels['pt-BR'];
  disconnectServerButton.setAttribute('aria-label', disconnectServerButton.title);
};
refreshDisconnectServerLabel();
document.querySelector('#settings-save')?.addEventListener('click', () => setTimeout(refreshDisconnectServerLabel, 0));
disconnectServerButton?.addEventListener('click', () => {
  if (currentMode !== 'hosted') return;
  playNotification('disconnect');
  clearInterval(latencyTimer);
  stopVoiceDetection();
  localStream?.getTracks?.().forEach((track) => track.stop());
  cameraStream?.getTracks?.().forEach((track) => track.stop());
  screenStream?.getTracks?.().forEach((track) => track.stop());
  clearHostedVoice();
  serverMembers.clear();
  hostedSocket?.disconnect();
  hostedSocket = null;
  location.reload();
});

// Moderation is acknowledged before returning to the welcome screen. The
// removed client cannot continue interacting with a disconnected room, and
// the reason stays visible until the user confirms it.
if (!document.querySelector('#server-removal-screen')) {
  document.body.insertAdjacentHTML('beforeend', `<section id="server-removal-screen" class="server-removal-screen hidden" role="alertdialog" aria-modal="true" aria-labelledby="server-removal-title" aria-describedby="server-removal-message">
    <div class="server-removal-card">
      <span class="server-removal-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0z"/></svg></span>
      <p id="server-removal-eyebrow" class="server-removal-eyebrow">FORA DO SERVIDOR</p>
      <h1 id="server-removal-title">Você foi expulso do servidor</h1>
      <p id="server-removal-message">O administrador encerrou sua conexão com este servidor.</p>
      <button id="server-removal-confirm" type="button">Voltar ao início</button>
    </div>
  </section>`);
}
let serverRemovalActive = false;
const serverRemovalScreen = document.querySelector('#server-removal-screen');
const serverRemovalConfirm = document.querySelector('#server-removal-confirm');
const stopHostedSessionForRemoval = () => {
  clearInterval(latencyTimer);
  stopVoiceDetection();
  localStream?.getTracks?.().forEach((track) => track.stop());
  cameraStream?.getTracks?.().forEach((track) => track.stop());
  screenStream?.getTracks?.().forEach((track) => track.stop());
  localStream = null;
  cameraStream = null;
  screenStream = null;
  clearHostedVoice();
  serverMembers.clear();
  hostedSocket?.disconnect();
  hostedSocket = null;
};
window.voiceupShowServerRemoval = ({ action, message } = {}) => {
  if (serverRemovalActive) return;
  serverRemovalActive = true;
  const banned = action === 'banned';
  stopHostedSessionForRemoval();
  playNotification('disconnect');
  document.querySelector('#server-removal-eyebrow').textContent = banned ? 'ACESSO BLOQUEADO' : 'FORA DO SERVIDOR';
  document.querySelector('#server-removal-title').textContent = banned ? 'Você foi banido do servidor' : 'Você foi expulso do servidor';
  document.querySelector('#server-removal-message').textContent = message || (banned
    ? 'Seu acesso foi bloqueado pelo administrador. Você poderá voltar quando o banimento for removido.'
    : 'O administrador encerrou sua conexão com este servidor.');
  serverRemovalScreen.classList.remove('hidden');
  document.body.classList.add('server-removal-open');
  requestAnimationFrame(() => serverRemovalConfirm?.focus());
};
serverRemovalConfirm?.addEventListener('click', () => location.reload());
const emptySidebarActions = document.querySelector('.sidebar-actions');
if (emptySidebarActions && !emptySidebarActions.children.length) emptySidebarActions.remove();
refreshVideoStage();

// Keep the small account indicators and bottom controls in sync, like the
// reference application's footer, without duplicating the actual media controls.
const selfStateIcon = (type, muted) => type === 'mic'
  ? (muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-5.2-2M5 5l14 14M6 10v1a6 6 0 0 0 9.8 4.6M12 17v4M8 21h8"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8"/></svg>')
  : (muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM19 9l-6 6M13 9l6 6"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg>');
const refreshSelfMediaState = () => {
  const micState = document.querySelector('#self-mic-state');
  const outputState = document.querySelector('#self-output-state');
  if (micState) { micState.innerHTML = selfStateIcon('mic', !micEnabled); micState.classList.toggle('muted', !micEnabled); micState.title = micEnabled ? 'Silenciar microfone' : 'Ativar microfone'; micState.setAttribute('aria-label', micState.title); }
  if (outputState) { outputState.innerHTML = selfStateIcon('output', betaOutputMuted); outputState.classList.toggle('muted', betaOutputMuted); outputState.title = betaOutputMuted ? 'Ativar áudio recebido' : 'Silenciar áudio recebido'; outputState.setAttribute('aria-label', outputState.title); }
};
document.querySelector('#mic-button')?.addEventListener('click', () => setTimeout(refreshSelfMediaState, 0));
document.querySelector('#output-button')?.addEventListener('click', () => setTimeout(refreshSelfMediaState, 0));
const bindFooterAudioShortcut = (id, controlId) => {
  const shortcut = document.querySelector(id);
  const activate = () => document.querySelector(controlId)?.click();
  if (!shortcut) return;
  shortcut.setAttribute('role', 'button');
  shortcut.tabIndex = 0;
  shortcut.addEventListener('click', activate);
  shortcut.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
};
bindFooterAudioShortcut('#self-mic-state', '#mic-button');
bindFooterAudioShortcut('#self-output-state', '#output-button');
refreshSelfMediaState();

// Manual presence selector. Automatic idle reuses the orange status but does
// not overwrite the user's saved selection.
const presenceLabels = {
  'pt-BR': { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', automatic: 'Ausente automaticamente' },
  'en-US': { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', automatic: 'Automatically idle' },
  'es-ES': { online: 'En línea', idle: 'Ausente', dnd: 'No molestar', automatic: 'Ausente automáticamente' },
  'fr-FR': { online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', automatic: 'Absence automatique' }
};
const presenceText = (status = effectivePresenceStatus) => (presenceLabels[language] || presenceLabels['pt-BR'])[status] || status;
const selfCard = document.querySelector('.self-card');
if (selfCard && !document.querySelector('#presence-status-button')) {
  const button = document.createElement('button'); button.id = 'presence-status-button'; button.type = 'button'; button.innerHTML = '<i></i>';
  (selfCard.querySelector('.self-avatar-control') || selfCard).append(button);
}
if (selfCard && !document.querySelector('#presence-menu')) {
  document.body.insertAdjacentHTML('beforeend', `<aside id="presence-menu" class="presence-menu hidden" role="dialog" aria-label="Definir status">${['online', 'idle', 'dnd'].map((status) => `<button type="button" data-presence-status="${status}"><i class="presence-dot status-${status}"></i><span><strong>${presenceText(status)}</strong><small>${status === 'dnd' ? 'Silencia sons e notificações de mensagens' : status === 'idle' ? 'Mantém você como ausente' : 'Ausência automática após 10 minutos'}</small></span></button>`).join('')}</aside>`);
}
const presenceButton = document.querySelector('#presence-status-button');
const presenceMenu = document.querySelector('#presence-menu');
const paintPresenceControl = () => {
  if (!presenceButton) return;
  presenceButton.className = `status-${effectivePresenceStatus}`;
  const label = presenceAutoIdle ? (presenceLabels[language] || presenceLabels['pt-BR']).automatic : presenceText(effectivePresenceStatus);
  presenceButton.title = label; presenceButton.setAttribute('aria-label', `Status: ${label}`);
  selfCard?.setAttribute('data-presence-status', effectivePresenceStatus);
  const statusLabel = document.querySelector('#presence-status-label');
  if (statusLabel) statusLabel.textContent = presenceText(effectivePresenceStatus);
  presenceMenu?.querySelectorAll('[data-presence-status]').forEach((item) => item.classList.toggle('active', item.dataset.presenceStatus === presenceStatus));
};
const closePresenceMenu = () => presenceMenu?.classList.add('hidden');
presenceButton?.addEventListener('click', (event) => {
  event.stopPropagation(); presenceMenu.classList.toggle('hidden');
  if (!presenceMenu.classList.contains('hidden')) { const box = presenceButton.getBoundingClientRect(); presenceMenu.style.left = `${Math.max(10, box.left)}px`; presenceMenu.style.bottom = `${Math.max(10, window.innerHeight - box.top + 8)}px`; }
});
presenceMenu?.querySelectorAll('[data-presence-status]').forEach((item) => item.addEventListener('click', () => { window.voiceupSetPresenceStatus?.(item.dataset.presenceStatus); closePresenceMenu(); paintPresenceControl(); }));
document.addEventListener('pointerdown', (event) => { if (!presenceMenu?.contains(event.target) && event.target !== presenceButton) closePresenceMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePresenceMenu(); });
window.addEventListener('voiceup-presence-changed', () => { paintPresenceControl(); renderBetaMembers(); renderCentralCallMembers(); });
paintPresenceControl();

let betaChatStyle = storedProfile.chatStyle || localStorage.getItem('voiceup-chat-style') || 'modern';
if (betaChatStyle === 'voiceup') betaChatStyle = 'classic';
if (betaChatStyle === 'clean') betaChatStyle = 'modern';
const applyChatStyle = (style) => {
  betaChatStyle = style === 'classic' ? 'classic' : 'modern';
  document.body.classList.remove('chat-classic', 'chat-modern');
  document.body.classList.add(`chat-${betaChatStyle}`);
  const chatPanel = document.querySelector('#right-panel');
  const messagesPanel = document.querySelector('#messages');
  if (chatPanel) chatPanel.dataset.chatStyle = betaChatStyle;
  if (messagesPanel) messagesPanel.dataset.chatStyle = betaChatStyle;
  localStorage.setItem('voiceup-chat-style', betaChatStyle);
};
const preferences = document.querySelector('#client-preferences > div');
if (preferences && !document.querySelector('#chat-style-select')) {
  preferences.insertAdjacentHTML('beforeend', '<label style="display:grid;gap:6px">Estilo do chat<select id="chat-style-select"><option value="modern">Moderno — mensagens abertas</option><option value="classic">Clássico — balões VoiceUP</option></select><small style="color:#aeb9cc;font-weight:400">Moderno deixa o chat aberto; clássico organiza mensagens em balões.</small></label>');
  const chatStyleSelect = document.querySelector('#chat-style-select');
  chatStyleSelect.value = betaChatStyle;
  // Preview immediately. The save button still persists it in the full user
  // profile, but users can see the difference before closing Settings.
  chatStyleSelect.addEventListener('input', () => applyChatStyle(chatStyleSelect.value));
  chatStyleSelect.addEventListener('change', () => applyChatStyle(chatStyleSelect.value));
}
applyChatStyle(betaChatStyle);
const savedAppearance = storedProfile.appearance || {};
let betaInterfaceDensity = ['comfortable', 'compact'].includes(savedAppearance.density) ? savedAppearance.density : 'comfortable';
let betaFontScale = ['small', 'normal', 'large'].includes(savedAppearance.fontScale) ? savedAppearance.fontScale : 'normal';
let betaPanelWidth = ['narrow', 'normal', 'wide'].includes(savedAppearance.panelWidth) ? savedAppearance.panelWidth : 'normal';
let betaMotion = savedAppearance.motion === 'reduced' ? 'reduced' : 'full';
let betaBackdropEffects = savedAppearance.effects !== false;
const applyAppearancePreferences = () => {
  document.body.dataset.interfaceDensity = betaInterfaceDensity;
  document.body.dataset.fontScale = betaFontScale;
  document.body.dataset.panelWidth = betaPanelWidth;
  document.body.dataset.motion = betaMotion;
  document.body.dataset.effects = betaBackdropEffects ? 'on' : 'off';
};
applyAppearancePreferences();
document.head.insertAdjacentHTML('beforeend', `<style>
.round-control.active:not(.muted){background:color-mix(in srgb,var(--night2) 90%,#20243a)!important;color:var(--ink)!important}.round-control.on{background:var(--focus)!important;color:var(--beta-button-ink)!important}.self-media-state{margin-left:auto;display:flex;gap:9px;align-items:center;color:var(--muted)}.self-media-state span{display:grid;place-items:center;width:24px;height:24px;border-radius:6px;cursor:pointer}.self-media-state span:hover,.self-media-state span:focus-visible{background:color-mix(in srgb,var(--focus) 15%,transparent);color:var(--ink);outline:none}.self-media-state svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.self-media-state span.muted{color:#ff6963}.self-media-state span.muted:hover,.self-media-state span.muted:focus-visible{background:rgba(255,105,99,.13);color:#ff6963}.self-media-state #settings-button{display:grid!important;place-items:center;flex:0 0 24px!important;width:24px!important;height:24px!important;padding:0!important;border:0!important;border-radius:6px!important;background:transparent!important;color:var(--muted)!important}.self-media-state #settings-button::before{font-size:17px!important}.self-media-state #settings-button:hover,.self-media-state #settings-button:focus-visible{background:color-mix(in srgb,var(--focus) 15%,transparent)!important;color:var(--ink)!important;outline:none}
body.chat-modern #messages,[data-chat-style="modern"]#messages{gap:2px;padding:13px 15px}body.chat-modern #messages>.message,[data-chat-style="modern"]#messages>.message{width:100%;max-width:100%;background:transparent!important;border:0!important;border-radius:7px!important;padding:7px 5px;align-self:stretch!important;box-shadow:none!important}body.chat-modern #messages>.message.mine,[data-chat-style="modern"]#messages>.message.mine{background:transparent!important;align-self:stretch!important}body.chat-modern #messages>.message .author,[data-chat-style="modern"]#messages>.message .author{margin-bottom:1px}body.chat-modern #right-panel form,[data-chat-style="modern"]#right-panel form{background:transparent!important}body.chat-classic #messages>.message,[data-chat-style="classic"]#messages>.message{width:auto;min-width:92px;max-width:92%;padding:9px 12px;align-self:flex-start!important;border-radius:11px!important;background:color-mix(in srgb,var(--night) 68%,var(--night2))!important}body.chat-classic #messages>.message.mine,[data-chat-style="classic"]#messages>.message.mine{align-self:flex-end!important;border-bottom-right-radius:4px!important;background:color-mix(in srgb,var(--focus) 22%,var(--night2))!important}body.chat-classic #messages>.message:not(.mine),[data-chat-style="classic"]#messages>.message:not(.mine){border-bottom-left-radius:4px!important}
</style>`);

// Hosted rooms have two different lists: the call only includes people in the
// selected voice channel, while the Members tab shows everybody in the room.
const betaSetCallMode = setCallMode;
setCallMode = function setCallModeBeta(mode) {
  betaSetCallMode(mode);
  const hosted = mode === 'hosted';
  document.body.classList.toggle('beta-hosted', hosted);
  if (hosted) $('pair-panel')?.classList.add('hidden');
};

// Do not make joining a hosted room depend on the microphone prompt. On some
// Windows machines getUserMedia can remain pending for a long time, which used
// to leave the whole interface at "Preparando audio" without opening a socket.
enterApp = async function enterAppBeta(mode = 'manual') {
  $('welcome').classList.add('hidden');
  $('app').classList.remove('hidden');
  setCallMode(mode);
  setStatus(mode === 'hosted' ? 'Abrindo conexao com o servidor host...' : 'Preparando conexao P2P...');
  $('self-name').textContent = myName;
  paintAvatar($('self-avatar'), myName, myColor, myAvatar);
  paintAvatar($('stage-avatar'), myName, myColor, myAvatar);
  $('stage-name').textContent = 'Você está pronto';
  $('participants').innerHTML = `<div id="self-participant" class="participant">${selfParticipant()}</div>`;
  $('connection-state').textContent = mode === 'hosted' ? 'Fora da call' : 'Solicitando microfone…';
  if (mode === 'hosted') return;
  void requestAudio().then(() => {
    const track = outgoingAudioTrack();
    if (!track) return;
    if (currentMode === 'hosted') {
      for (const participant of hostedPeers.values()) participant.audioSender?.replaceTrack(track).catch(() => {});
    } else {
      peer?.audioSender?.replaceTrack(track).catch(() => {});
    }
  }).catch(() => {});
};
const betaRenderRoomChannels = renderRoomChannels;
const betaLiveIcon = (kind) => kind === 'screen'
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"></rect><path d="m15 10 5-3v10l-5-3z"></path></svg>';
function mediaOfferBadge(member) {
  const owner = member?.id === 'manual-peer' ? 'manual-peer' : String(member?.id || '');
  const participant = mediaParticipantByOwner(owner);
  if (!owner || !participant || participant.left || owner === hostedSocket?.id || owner === 'self') return '';
  const view = mediaViewState(participant);
  const kind = participant.videoExpectedKinds?.screen && !view.screen ? 'screen'
    : participant.videoExpectedKinds?.camera && view.camera === false ? 'camera' : '';
  if (!kind) return '';
  const label = kind === 'screen' ? `${participant.name || 'Participante'} está transmitindo. Clique para assistir.` : `Mostrar câmera de ${participant.name || 'participante'}`;
  return `<span class="media-live-badge" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${betaLiveIcon(kind)}</span>`;
}
function channelAvatar(member) {
  const photo = safeAvatar(member.avatar);
  const nickname = escapeHtml(member.name || 'Visitante');
  const initialsText = initials(member.name);
  return `<span class="channel-avatar" data-nickname="${nickname}" data-member-id="${escapeHtml(member.id)}" aria-label="${nickname}" style="background:${safeColor(member.color)}${photo ? `;background-image:url('${photo}');background-size:cover;background-position:center` : ''}">${photo ? '' : initialsText}${mediaOfferBadge(member)}</span>`;
}
const betaMemberAvatar = (member) => avatar(member.name, member.color, member.avatar);
const betaT = (key, values = {}) => globalThis.voiceupI18n?.t(key, values);
const betaChannelName = (name, type) => globalThis.voiceupI18n?.channel(name, type) || name;
let betaWritingMembers = false;
let betaMembersMarkup = '';
const commitBetaMembersMarkup = (target, markup) => {
  // Presence snapshots arrive periodically even when no visible member data
  // changed. Replacing identical DOM made the status text visibly blink and
  // also discarded hover/focus state. Keep the current nodes in that case.
  if (markup === betaMembersMarkup && target.childNodes.length) return false;
  betaMembersMarkup = markup;
  target.innerHTML = markup;
  return true;
};
const renderBetaMembers = () => {
  const target = document.querySelector('#members-clone');
  if (!target) return;
  if (currentMode !== 'hosted') {
    const source = document.querySelector('#participants');
    commitBetaMembersMarkup(target, source?.innerHTML || `<p class="system-message">${betaT('state.noMembers') || 'Nenhuma pessoa conectada.'}</p>`);
    return;
  }
  const members = [...serverMembers.values()].map((member) => member.id === hostedSocket?.id
    ? { ...member, name: myName, color: myColor, avatar: myAvatar, status: effectivePresenceStatus, voiceChannel: activeVoiceChannel }
    : member);
  if (!members.some((member) => member.id === hostedSocket?.id)) members.unshift({ id: hostedSocket?.id || 'self', name: myName, color: myColor, avatar: myAvatar, status: effectivePresenceStatus, voiceChannel: activeVoiceChannel });
  const markup = members.length ? members.map((member) => {
    const isSelf = member.id === hostedSocket?.id || member.id === 'self';
    const peerItem = hostedPeers.get(member.id);
    const inCall = Boolean(member.voiceChannel) && member.voiceChannel === activeVoiceChannel;
    const visibleChannel = member.voiceChannel ? betaChannelName(member.voiceChannel, 'voice') : (betaT('state.outside') || 'Fora da call');
    const status = normalizedPresenceStatus(member.status);
    return `<div class="participant server-member${inCall ? ' in-active-call' : ''}${peerItem?.speaking ? ' speaking' : ''}" data-member-id="${escapeHtml(member.id)}"><span class="member-presence-avatar">${betaMemberAvatar(member)}<i class="presence-dot status-${status}" title="${escapeHtml(presenceText(status))}"></i>${mediaOfferBadge(member)}</span><div style="min-width:0;flex:1"><strong>${escapeHtml(member.name)}${isSelf ? ` (${escapeHtml(betaT('state.self') || 'você')})` : ''}</strong><small class="member-status-line"><b class="status-${status}">${escapeHtml(presenceText(status))}</b><span>· ${escapeHtml(visibleChannel)}</span></small></div>${peerItem ? `<button class="hosted-mute" data-peer-id="${escapeHtml(member.id)}" type="button" title="Silenciar somente para você">${audioIcon(Boolean(peerItem.muted))}</button>` : ''}</div>`;
  }).join('') : `<p class="system-message">${betaT('state.noMembers') || 'Nenhuma pessoa no servidor.'}</p>`;
  betaWritingMembers = true;
  if (!commitBetaMembersMarkup(target, markup)) {
    betaWritingMembers = false;
    return;
  }
  target.querySelectorAll('.hosted-mute').forEach((button) => button.addEventListener('click', () => toggleHostedMute(button.dataset.peerId)));
  setTimeout(() => { betaWritingMembers = false; }, 0);
};
renderRoomChannels = function renderRoomChannelsBeta() {
  betaRenderRoomChannels();
  document.body.classList.toggle('beta-hosted', currentMode === 'hosted');
  renderBetaMembers();
};
const betaRenderHostedParticipants = renderHostedParticipants;
renderHostedParticipants = function renderHostedParticipantsBeta() {
  betaRenderHostedParticipants();
  renderBetaMembers();
  renderCentralCallMembers();
  setTimeout(renderBetaMembers, 0);
};
new MutationObserver(() => setTimeout(renderBetaMembers, 0)).observe(document.querySelector('#participants'), { childList: true, subtree: true });
const membersClone = document.querySelector('#members-clone');
if (membersClone) new MutationObserver(() => {
  if (currentMode === 'hosted' && !betaWritingMembers) setTimeout(renderBetaMembers, 0);
}).observe(membersClone, { childList: true, subtree: true });
setInterval(() => {
  if (currentMode === 'hosted' && hostedSocket?.connected) hostedSocket.emit('request-room-presence');
}, 4000);

// Presence in the centre is scoped to the current call/channel, unlike the
// Members tab which shows the entire server.
const callIdentity = document.querySelector('#identity-stage');
if (callIdentity && !document.querySelector('#call-members')) {
  const list = document.createElement('div');
  list.id = 'call-members';
  // Keep the legacy stage avatar in the DOM. enterApp, channel changes and
  // older protocol paths still update it while the beta member grid is used.
  // Removing it aborted hosted-room entry before Socket.IO was even created.
  const wave = callIdentity.querySelector('.wave-wrap');
  if (wave) wave.insertAdjacentElement('afterend', list);
  else callIdentity.prepend(list);
}
const rightPanel = document.querySelector('#right-panel');
const membersPanel = document.querySelector('#members-panel');
const chatPanel = document.querySelector('#chat-panel');
const stage = document.querySelector('.stage');
if (stage && !document.querySelector('#server-lobby')) {
  stage.insertAdjacentHTML('afterbegin', '<section id="server-lobby" aria-label="Chat do servidor"><header><div><p class="eyebrow">CANAL DE TEXTO</p><h2 id="server-lobby-channel"># geral</h2></div><small>Fora da call · você continua conectado ao servidor</small></header><div id="server-lobby-chat-slot"></div></section>');
}
const syncHostedLobbyLayout = () => {
  const lobby = document.querySelector('#server-lobby');
  const slot = document.querySelector('#server-lobby-chat-slot');
  if (!lobby || !rightPanel || !chatPanel || !membersPanel) return;
  const inLobby = currentMode === 'hosted' && !activeVoiceChannel && !document.querySelector('#app')?.classList.contains('hidden');
  document.body.classList.toggle('server-lobby-mode', inLobby);
  const lobbyChannel = document.querySelector('#server-lobby-channel');
  if (lobbyChannel) lobbyChannel.textContent = `# ${betaChannelName(activeTextChannel, 'text')}`;
  if (inLobby) {
    if (chatPanel.parentElement !== slot) slot.append(chatPanel);
    chatPanel.classList.add('active');
    membersPanel.classList.add('active');
    rightPanel.querySelector('[data-panel="members"]')?.classList.add('active');
    rightPanel.querySelector('[data-panel="chat"]')?.classList.remove('active');
  } else if (chatPanel.parentElement !== rightPanel) {
    rightPanel.append(chatPanel);
    chatPanel.classList.remove('active');
    membersPanel.classList.add('active');
    rightPanel.querySelector('[data-panel="members"]')?.classList.add('active');
    rightPanel.querySelector('[data-panel="chat"]')?.classList.remove('active');
  }
};
const renderCentralCallMembers = () => {
  syncHostedLobbyLayout();
  const list = document.querySelector('#call-members');
  if (!list || document.querySelector('#video-frame')?.classList.contains('hidden') === false) return;
  if (currentMode === 'hosted' && !activeVoiceChannel) {
    list.innerHTML = '';
    delete list.dataset.structureKey;
    callIdentity.classList.remove('group-call');
    $('stage-name').textContent = betaT('lobby.title') || 'Você entrou no servidor';
    $('stage-message').textContent = betaT('lobby.subtitle') || 'Escolha um canal de voz para entrar na chamada.';
    return;
  }
  // Manual P2P still needs its invitation step. Do not show a fake one-person
  // call card before the other side has actually been paired.
  if (currentMode !== 'hosted' && !peer?.name) {
    list.innerHTML = '';
    callIdentity.classList.remove('group-call');
    return;
  }
  let hostedMembers = [];
  if (currentMode === 'hosted') {
    const visible = new Map();
    // Server presence is available before WebRTC finishes, so users remain
    // visible while their direct audio/data connection is negotiating.
    for (const member of serverMembers.values()) {
      if (member.id === hostedSocket?.id || member.voiceChannel !== activeVoiceChannel) continue;
      const connection = hostedPeers.get(member.id);
      visible.set(member.id, { ...member, connected: Boolean(connection?.connected), speaking: Boolean(connection?.speaking) });
    }
    // Compatibility fallback for hosts/clients without room-presence.
    for (const member of hostedPeers.values()) {
      if (member.left || visible.has(member.id)) continue;
      visible.set(member.id, { ...member, connected: Boolean(member.connected), speaking: Boolean(member.speaking) });
    }
    hostedMembers = [...visible.values()];
  }
  const participants = currentMode === 'hosted'
    ? [{ id: 'self', name: myName, color: myColor, avatar: myAvatar, speaking: localSpeaking, connected: true }, ...hostedMembers]
    : [{ id: 'self', name: myName, color: myColor, avatar: myAvatar, speaking: localSpeaking, connected: true }, ...(peer?.name ? [{ id: 'manual-peer', name: peer.name, color: peer.color, avatar: peer.avatar, connected: peer.channel?.readyState === 'open', speaking: document.querySelector('#peer-other')?.classList.contains('speaking') }] : [])];
  const structureKey = participants.map((member) => { const media = mediaParticipantByOwner(member.id === 'self' ? '' : member.id); return [member.id, member.name, member.color, member.avatar?.length || 0, member.connected ? 1 : 0, media?.videoExpectedKinds?.screen ? 1 : 0, media?.videoExpectedKinds?.camera ? 1 : 0].join(':'); }).join('|');
  if (list.dataset.structureKey !== structureKey) {
    list.dataset.structureKey = structureKey;
    list.innerHTML = participants.map((member) => `<article class="call-member" data-call-member="${escapeHtml(member.id)}"${member.id !== 'self' ? ' tabindex="0" role="button" aria-label="Ajustar volume deste participante"' : ''}>${betaMemberAvatar(member)}${mediaOfferBadge(member)}<strong>${escapeHtml(member.name || 'Você')}${member.id === 'self' ? ` (${escapeHtml(betaT('state.self') || 'você')})` : ''}</strong><small>${member.connected ? (betaT('state.inChannel') || 'No canal') : (betaT('state.connecting') || 'Conectando...')}</small></article>`).join('');
  }
  // Toggle only the speaking state. Recreating the avatar would restart the
  // aura animation on every sample and make it look as if it never appeared.
  for (const member of participants) {
    const article = [...list.querySelectorAll('[data-call-member]')].find((item) => item.dataset.callMember === String(member.id));
    if (!article) continue;
    article.classList.toggle('speaking', Boolean(member.speaking));
    const state = article.querySelector('small');
    if (state) state.textContent = member.speaking ? (betaT('state.speaking') || 'Falando...') : member.connected ? (betaT('state.inChannel') || 'No canal') : (betaT('state.connecting') || 'Conectando...');
  }
  // Video tiles are the equivalent of the large participant cards. Give the
  // whole tile the speaking border, rather than only outlining the avatar.
  [...videoGallery.querySelectorAll('.video-tile')].forEach((tile) => {
    const rawId = tile.dataset.videoPeer || '';
    const peerId = (rawId.startsWith('peer-') ? rawId.slice(5) : rawId).replace(/-(camera|screen)$/, '');
    const participant = participants.find((member) => member.id === peerId || (peerId === 'manual' && member.id === 'manual-peer'));
    tile.classList.toggle('speaking', Boolean(participant?.speaking));
  });
  callIdentity.classList.toggle('group-call', currentMode === 'hosted' || participants.length > 1);
  if (participants.length > 1) {
    $('stage-name').textContent = betaT('state.groupCount', { count: participants.length }) || `${participants.length} pessoas na chamada`;
    $('stage-message').textContent = betaT('state.groupSubtitle') || 'Conectadas neste canal de voz.';
  }
};
const betaShowHostedStage = showHostedStage;
showHostedStage = function showHostedStageBeta(p, connected = false) { betaShowHostedStage(p, connected); renderCentralCallMembers(); };
const betaShowPeer = showPeer;
showPeer = function showPeerBeta(...args) { betaShowPeer(...args); renderCentralCallMembers(); };
document.querySelector('#mic-button')?.addEventListener('click', () => setTimeout(renderCentralCallMembers, 0));
// A short visual refresh keeps the speaking aura responsive without touching
// WebRTC negotiation or rebuilding the rest of the interface.
setInterval(renderCentralCallMembers, 180);

// Participant audio popover. These controls are local: they never mute or
// change the other user's own client. Gain goes up to 200% through Web Audio.
if (!document.querySelector('#participant-audio-popover')) {
  document.body.insertAdjacentHTML('beforeend', `<aside id="participant-audio-popover" class="participant-audio-popover hidden" role="dialog" aria-modal="false" aria-labelledby="participant-audio-name">
    <div class="participant-audio-header"><span id="participant-audio-avatar" class="avatar"></span><div><strong id="participant-audio-name">Participante</strong><small>Ajuste somente para você</small></div><button id="participant-audio-close" type="button" title="Fechar" aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="participant-media-actions"><button id="participant-watch-live" class="participant-watch-live hidden" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg><span>Assistir live</span></button><button id="participant-watch-camera" class="participant-watch-live hidden" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"></rect><path d="m16 10 5-3v10l-5-3z"></path></svg><span>Ver câmera</span></button></div>
    <label><span>Volume individual <b id="participant-volume-value">100%</b></span><input id="participant-volume-range" type="range" min="0" max="200" step="1" value="100"/></label>
    <button id="participant-mute-toggle" class="participant-audio-mute" type="button"></button>
  </aside>`);
}
const participantAudioPopover = document.querySelector('#participant-audio-popover');
const participantVolumeRange = document.querySelector('#participant-volume-range');
const participantVolumeValue = document.querySelector('#participant-volume-value');
const participantMuteToggle = document.querySelector('#participant-mute-toggle');
const participantWatchLive = document.querySelector('#participant-watch-live');
const participantWatchCamera = document.querySelector('#participant-watch-camera');
let participantAudioTarget = null;
const participantAudioState = (id) => {
  if (id === 'manual-peer') return peer?.name ? { id, name: peer.name, color: peer.color, avatar: peer.avatar, volume: manualParticipantVolume, muted: remoteMuted } : null;
  const participant = hostedPeers.get(id); if (!participant) return null;
  return { id, name: participant.name, color: participant.color, avatar: participant.avatar, volume: Number(participant.volume ?? 100), muted: Boolean(participant.muted) };
};
const closeParticipantAudio = () => { participantAudioTarget = null; participantAudioPopover?.classList.add('hidden'); };
const refreshParticipantAudioPopover = () => {
  const state = participantAudioState(participantAudioTarget); if (!state) return closeParticipantAudio();
  const participant = mediaParticipantByOwner(participantAudioTarget);
  const hasScreen = Boolean(participant?.videoExpectedKinds?.screen);
  const hasCamera = Boolean(participant?.videoExpectedKinds?.camera);
  paintAvatar(document.querySelector('#participant-audio-avatar'), state.name, state.color, state.avatar);
  document.querySelector('#participant-audio-name').textContent = state.name;
  participantVolumeRange.value = String(state.volume);
  participantVolumeValue.textContent = `${Math.round(state.volume)}%`;
  participantMuteToggle.classList.toggle('muted', state.muted);
  participantMuteToggle.innerHTML = `${outputIcon(state.muted)}<span>${state.muted ? 'Desmutar para mim' : 'Mutar para mim'}</span>`;
  participantWatchLive?.classList.toggle('hidden', !hasScreen);
  participantWatchCamera?.classList.toggle('hidden', !hasCamera);
};
const positionParticipantAudio = (anchor) => {
  const box = anchor.getBoundingClientRect();
  participantAudioPopover.classList.remove('hidden');
  const width = participantAudioPopover.offsetWidth || 280; const height = participantAudioPopover.offsetHeight || 190;
  let left = box.left + box.width / 2 - width / 2; let top = box.bottom + 9;
  if (top + height > innerHeight - 10) top = box.top - height - 9;
  left = Math.max(10, Math.min(innerWidth - width - 10, left)); top = Math.max(10, Math.min(innerHeight - height - 10, top));
  participantAudioPopover.style.left = `${left}px`; participantAudioPopover.style.top = `${top}px`;
};
const openParticipantAudio = (id, anchor) => {
  if (!id || id === 'self' || id === hostedSocket?.id || !participantAudioState(id)) return;
  participantAudioTarget = id; refreshParticipantAudioPopover(); positionParticipantAudio(anchor);
};
document.addEventListener('click', (event) => {
  const central = event.target.closest?.('[data-call-member]');
  const serverMember = event.target.closest?.('[data-member-id]');
  const anchor = central || serverMember;
  if (anchor && !event.target.closest('.hosted-mute')) return openParticipantAudio(central?.dataset.callMember || serverMember?.dataset.memberId, anchor);
  if (!participantAudioPopover?.classList.contains('hidden') && !event.target.closest('#participant-audio-popover')) closeParticipantAudio();
});
document.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-call-member]:not([data-call-member="self"])')) { event.preventDefault(); openParticipantAudio(event.target.dataset.callMember, event.target); }
  if (event.key === 'Escape') closeParticipantAudio();
});
document.querySelector('#participant-audio-close')?.addEventListener('click', closeParticipantAudio);
participantVolumeRange?.addEventListener('input', () => {
  const value = Math.max(0, Math.min(200, Number(participantVolumeRange.value)));
  if (participantAudioTarget === 'manual-peer') manualParticipantVolume = value;
  else { const participant = hostedPeers.get(participantAudioTarget); if (participant) participant.volume = value; }
  applyOutputMute(); refreshParticipantAudioPopover();
});
participantMuteToggle?.addEventListener('click', () => {
  if (participantAudioTarget === 'manual-peer') remoteMuted = !remoteMuted;
  else { const participant = hostedPeers.get(participantAudioTarget); if (participant) participant.muted = !participant.muted; }
  applyOutputMute(); refreshParticipantAudioPopover(); renderHostedParticipants();
});
participantWatchLive?.addEventListener('click', () => {
  const participant = mediaParticipantByOwner(participantAudioTarget);
  if (!participant) return closeParticipantAudio();
  requestParticipantMediaView(participant, 'screen');
  closeParticipantAudio();
  renderIncomingMediaOffers();
});
participantWatchCamera?.addEventListener('click', () => {
  const participant = mediaParticipantByOwner(participantAudioTarget);
  if (!participant) return closeParticipantAudio();
  requestParticipantMediaView(participant, 'camera');
  closeParticipantAudio();
  renderIncomingMediaOffers();
});
window.addEventListener('resize', closeParticipantAudio);
document.querySelector('#accept-offer').textContent = 'Entrar com convite';
// Saved servers are local shortcuts. Credentials and room traffic never pass
// through this list; it only remembers the address, room and friendly name.
const savedServersStorageKey = 'voiceup-saved-servers-v1';
const hostConnect = document.querySelector('#host-connect');
const readSavedServers = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedServersStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((server) => server?.url && server?.roomId).slice(0, 12) : [];
  } catch { return []; }
};
let savedServers = readSavedServers();
let selectedSavedServerId = '';
const defaultServerName = (url, roomId) => {
  try { return `${new URL(url).hostname} · ${roomId}`; } catch { return `Servidor · ${roomId}`; }
};
if (hostConnect && !document.querySelector('#saved-servers')) {
  const firstHostLabel = hostConnect.querySelector('label');
  firstHostLabel?.insertAdjacentHTML('beforebegin', '<label class="host-name-label">Nome do servidor <input id="host-name" maxlength="36" placeholder="Ex.: VoiceUP dos amigos" autocomplete="off"/></label>');
  hostConnect.querySelector('small')?.insertAdjacentHTML('beforebegin', `<section id="saved-servers" class="saved-servers"><div class="saved-servers-heading"><div><strong>Meus servidores</strong><small>Salvos somente neste computador.</small></div><div class="saved-servers-actions"><button id="new-saved-server" type="button">Novo</button><button id="save-current-server" type="button">Salvar atual</button></div></div><div id="saved-servers-list" class="saved-servers-list"></div></section>`);
}
const hostNameInput = document.querySelector('#host-name');
const savedServersList = document.querySelector('#saved-servers-list');
const persistSavedServers = () => localStorage.setItem(savedServersStorageKey, JSON.stringify(savedServers.slice(0, 12)));
const renderSavedServers = () => {
  if (!savedServersList) return;
  const roomWord = betaT('saved.room') || 'sala';
  const removeLabel = betaT('saved.remove') || 'Remover servidor salvo';
  savedServersList.innerHTML = savedServers.length ? savedServers.map((server) => `<article class="saved-server${server.id === selectedSavedServerId ? ' selected' : ''}" data-saved-server="${escapeHtml(server.id)}"><button class="saved-server-open" type="button"><span class="saved-server-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h4M12 17h4"/></svg></span><span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.url)} · ${escapeHtml(roomWord)} ${escapeHtml(server.roomId)}</small></span></button><button class="saved-server-remove" type="button" title="${escapeHtml(removeLabel)}" aria-label="${escapeHtml(removeLabel)}: ${escapeHtml(server.name)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></article>`).join('') : `<p>${betaT('saved.empty') || 'Nenhum servidor salvo ainda. Preencha os dados acima e clique em “Salvar atual”.'}</p>`;
};
const selectSavedServer = (server) => {
  if (!server) return;
  selectedSavedServerId = server.id;
  document.querySelector('#host-url').value = server.url;
  document.querySelector('#host-room').value = server.roomId;
  if (hostNameInput) hostNameInput.value = server.name;
  renderSavedServers();
};
const saveCurrentServer = ({ silent = false } = {}) => {
  const url = document.querySelector('#host-url')?.value.trim();
  const roomId = document.querySelector('#host-room')?.value.trim();
  if (!url || !roomId) { if (!silent) toast('Informe o endereço e o código da sala antes de salvar.'); return false; }
  // The endpoint identifies a saved server. Editing the address or room after
  // selecting a card creates another entry instead of overwriting that card.
  const existing = savedServers.find((server) => server.url === url && server.roomId === roomId);
  const id = existing?.id || `server-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const name = hostNameInput?.value.trim() || existing?.name || defaultServerName(url, roomId);
  const next = { id, name, url, roomId, lastUsedAt: Date.now() };
  savedServers = [next, ...savedServers.filter((server) => server.id !== id)].slice(0, 12);
  selectedSavedServerId = id;
  if (hostNameInput) hostNameInput.value = name;
  persistSavedServers();
  renderSavedServers();
  if (!silent) toast('Servidor salvo neste computador.');
  return true;
};
document.querySelector('#save-current-server')?.addEventListener('click', () => saveCurrentServer());
document.querySelector('#new-saved-server')?.addEventListener('click', () => {
  selectedSavedServerId = '';
  if (hostNameInput) hostNameInput.value = '';
  const roomInput = document.querySelector('#host-room');
  if (roomInput) roomInput.value = '';
  renderSavedServers();
  hostNameInput?.focus();
});
const markSavedServerFormState = () => {
  const selected = savedServers.find((server) => server.id === selectedSavedServerId);
  if (!selected) return;
  const url = document.querySelector('#host-url')?.value.trim();
  const roomId = document.querySelector('#host-room')?.value.trim();
  if (selected.url !== url || selected.roomId !== roomId) {
    selectedSavedServerId = '';
    renderSavedServers();
  }
};
document.querySelector('#host-url')?.addEventListener('input', markSavedServerFormState);
document.querySelector('#host-room')?.addEventListener('input', markSavedServerFormState);
savedServersList?.addEventListener('click', (event) => {
  const item = event.target.closest('[data-saved-server]');
  if (!item) return;
  const server = savedServers.find((entry) => entry.id === item.dataset.savedServer);
  if (event.target.closest('.saved-server-remove')) {
    savedServers = savedServers.filter((entry) => entry.id !== item.dataset.savedServer);
    if (selectedSavedServerId === item.dataset.savedServer) selectedSavedServerId = '';
    persistSavedServers(); renderSavedServers(); return;
  }
  selectSavedServer(server);
});
document.querySelector('#join-host')?.addEventListener('click', () => saveCurrentServer({ silent: true }), true);
const initialSavedServer = savedServers.find((server) => server.url === document.querySelector('#host-url')?.value.trim() && server.roomId === document.querySelector('#host-room')?.value.trim());
if (initialSavedServer) selectSavedServer(initialSavedServer);
else renderSavedServers();
document.head.insertAdjacentHTML('beforeend', `<style>
#accept-offer{display:flex!important;align-items:center!important;justify-content:center!important;min-height:48px!important;background:var(--focus)!important;color:var(--beta-button-ink)!important;border:0!important;font-weight:700!important}#accept-offer::before{content:'↗';margin-right:8px;font-size:16px}.beta-hosted #pair-panel{display:none!important}.beta-hosted .participant-heading,.beta-hosted #participants{display:none!important}.beta-hosted .self-card{margin-top:auto!important}.members-clone .server-member{margin:2px 0;border-radius:9px}.members-clone .server-member.in-active-call{background:color-mix(in srgb,var(--focus) 10%,transparent)}.members-clone .server-member small{color:var(--muted)}.members-clone .hosted-mute{width:31px;height:31px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--ink);display:grid;place-items:center}.members-clone .hosted-mute svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#call-members{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:28px;max-width:min(760px,90vw);margin:0 auto 22px}.call-member{display:grid;justify-items:center;gap:8px;min-width:136px;padding:13px 12px;color:var(--ink);text-align:center;border:2px solid transparent;border-radius:16px}.call-member .avatar{width:88px;height:88px;font-size:28px;border-radius:28px;box-shadow:var(--shadow);transition:outline-color .14s,box-shadow .14s,transform .14s}.call-member strong{font-size:14px;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.call-member small{color:var(--muted);font-size:11px}.call-member.speaking{border-color:transparent;background:transparent;box-shadow:none}.call-member.speaking .avatar{outline:3px solid var(--focus);outline-offset:5px;box-shadow:0 0 0 7px color-mix(in srgb,var(--focus) 20%,transparent),0 0 24px 7px color-mix(in srgb,var(--focus) 55%,transparent),var(--shadow);transform:scale(1.035);animation:voiceup-speaking-aura 1.15s ease-in-out infinite}.call-member.speaking small{color:var(--focus);font-weight:700}.video-tile.speaking{border:2px solid var(--focus)!important;box-shadow:0 0 19px color-mix(in srgb,var(--focus) 36%,transparent)}.video-frame:has(.video-tile.speaking){border-color:var(--focus)!important;box-shadow:0 0 21px color-mix(in srgb,var(--focus) 28%,transparent),var(--shadow)!important}@keyframes voiceup-speaking-aura{0%,100%{box-shadow:0 0 0 6px color-mix(in srgb,var(--focus) 17%,transparent),0 0 18px 5px color-mix(in srgb,var(--focus) 42%,transparent),var(--shadow)}50%{box-shadow:0 0 0 9px color-mix(in srgb,var(--focus) 23%,transparent),0 0 30px 9px color-mix(in srgb,var(--focus) 62%,transparent),var(--shadow)}}@media(prefers-reduced-motion:reduce){.call-member.speaking .avatar{animation:none}}@media(max-width:700px){#call-members{gap:17px}.call-member .avatar{width:68px;height:68px;border-radius:22px;font-size:22px}.call-member{min-width:94px;padding:9px}.call-member strong{font-size:12px}}
#identity-stage:not(.group-call) #call-members:empty{display:none}#identity-stage.group-call>.wave-wrap,#identity-stage.group-call>#stage-name,#identity-stage.group-call>#stage-message{display:none}.pair-panel{position:relative!important;z-index:2}.pair-panel textarea{width:100%!important}.pair-panel .share-button{display:inline-flex!important;align-items:center;justify-content:center;min-width:138px}.pair-panel .answer-box{display:grid;gap:8px}.pair-panel .answer-box .share-button{justify-self:end;float:none!important}
.channel-avatars{overflow:visible!important}.channel-avatar{position:relative;cursor:default}.channel-avatar::after{content:attr(data-nickname);position:absolute;z-index:20;right:0;bottom:calc(100% + 8px);width:max-content;max-width:150px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--ink);font:600 11px/1.2 'DM Sans',sans-serif;box-shadow:var(--shadow);opacity:0;pointer-events:none;transform:translateY(3px);transition:opacity .14s,transform .14s}.channel-avatar:hover::after,.channel-avatar:focus-visible::after{opacity:1;transform:translateY(0)}
</style>`);

// The legacy source list changes after WebRTC events. It must never replace the
// full server presence list displayed in the Members tab.
const betaWelcome = document.querySelector('#welcome');
let betaWelcomeWasOpen = !betaWelcome?.classList.contains('hidden');
const syncWelcomeScroll = () => {
  const welcomeOpen = !betaWelcome?.classList.contains('hidden');
  document.body.classList.toggle('beta-welcome-open', welcomeOpen);
  if (betaWelcomeWasOpen && !welcomeOpen) {
    // The welcome page can be scrolled on small windows. Do not carry that
    // document offset into the fixed-height call interface.
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  betaWelcomeWasOpen = welcomeOpen;
};
syncWelcomeScroll();
if (betaWelcome) new MutationObserver(syncWelcomeScroll).observe(betaWelcome, { attributes: true, attributeFilter: ['class'] });
const betaSaveProfile = saveProfile;
saveProfile = function saveProfileBeta() {
  betaSaveProfile();
  try {
    const profile = JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}');
    profile.chatStyle = betaChatStyle;
    profile.appearance = { density: betaInterfaceDensity, fontScale: betaFontScale, panelWidth: betaPanelWidth, motion: betaMotion, effects: betaBackdropEffects };
    profile.outputMuted = betaOutputMuted;
    profile.inputVolume = betaInputVolume;
    profile.outputVolume = betaOutputVolume;
    profile.previewSize = previewSize;
    if (Number.isFinite(previewPosition?.x) && Number.isFinite(previewPosition?.y)) {
      profile.previewPosition = previewPosition;
      profile.previewSpace = 'window';
      delete profile.previewCorner;
    }
    localStorage.setItem('voiceup-profile-v1', JSON.stringify(profile));
  } catch { /* local preferences remain optional */ }
};
document.querySelector('#settings-save')?.addEventListener('click', () => {
  applyChatStyle(document.querySelector('#chat-style-select')?.value);
  // The selected body theme owns --focus. Keeping it off <html> lets every
  // aura and highlighted control adopt the current palette immediately.
  document.documentElement.style.removeProperty('--focus');
  document.querySelectorAll('.speaking').forEach((element) => { element.style.animation = 'none'; void element.offsetWidth; element.style.animation = ''; });
  applyOutputMute();
  setTimeout(applyOutputMute, 150);
  saveProfile();
});
// Discord-like local preview: it floats above the whole application and stays
// exactly where the user releases it. The viewport is the only boundary.
const localPreview = document.querySelector('#local-video');
let previewPosition = storedProfile.previewSpace === 'window' && storedProfile.previewPosition
  ? storedProfile.previewPosition
  : { x: null, y: null };
const previewMinSize = 120;
const previewMaxSize = 640;
let previewSize = Math.max(previewMinSize, Math.min(previewMaxSize, Number(storedProfile.previewSize) || 220));
const previewMargin = 14;
const clampPreview = (x, y) => {
  if (!localPreview) return { x: 0, y: 0 };
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const maxX = Math.max(previewMargin, viewportWidth - localPreview.offsetWidth - previewMargin);
  const maxY = Math.max(previewMargin, viewportHeight - localPreview.offsetHeight - previewMargin);
  return { x: Math.min(Math.max(previewMargin, x), maxX), y: Math.min(Math.max(previewMargin, y), maxY) };
};
const applyPreviewPosition = (position) => {
  const maxWidth = Math.max(120, (document.documentElement.clientWidth || window.innerWidth) - previewMargin * 2);
  previewSize = Math.min(previewSize, maxWidth);
  localPreview.style.setProperty('width', `${previewSize}px`, 'important');
  localPreview.style.setProperty('height', 'auto', 'important');
  localPreview.style.setProperty('aspect-ratio', '16 / 9');
  localPreview.style.setProperty('--preview-left', `${position.x}px`);
  localPreview.style.setProperty('--preview-top', `${position.y}px`);
  localPreview.style.setProperty('position', 'fixed', 'important');
  localPreview.style.setProperty('left', `${position.x}px`, 'important');
  localPreview.style.setProperty('top', `${position.y}px`, 'important');
  localPreview.style.setProperty('right', 'auto', 'important');
  localPreview.style.setProperty('bottom', 'auto', 'important');
};
const placePreview = () => {
  if (!localPreview) return;
  const fallback = {
    x: (document.documentElement.clientWidth || window.innerWidth) - localPreview.offsetWidth - previewMargin,
    y: 76
  };
  const next = clampPreview(
    Number.isFinite(previewPosition.x) ? previewPosition.x : fallback.x,
    Number.isFinite(previewPosition.y) ? previewPosition.y : fallback.y
  );
  previewPosition = next;
  applyPreviewPosition(next);
};
const savePreviewPosition = () => {
  try {
    const profile = JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}');
    profile.previewPosition = previewPosition;
    profile.previewSize = previewSize;
    profile.previewSpace = 'window';
    delete profile.previewCorner;
    localStorage.setItem('voiceup-profile-v1', JSON.stringify(profile));
  } catch { /* optional visual preference */ }
};
if (localPreview) {
  // Moving it outside .stage avoids clipping and stacking contexts, allowing
  // the preview to cross the sidebar, call, members and chat panels.
  document.body.append(localPreview);
  let drag = null;
  const previewEdge = (event, box = localPreview.getBoundingClientRect()) => {
    const threshold = Math.min(14, Math.max(8, box.width * 0.06));
    const horizontal = event.clientX - box.left <= threshold ? 'w' : box.right - event.clientX <= threshold ? 'e' : '';
    const vertical = event.clientY - box.top <= threshold ? 'n' : box.bottom - event.clientY <= threshold ? 's' : '';
    return `${vertical}${horizontal}`;
  };
  const resizeCursor = (edge) => ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[edge] || 'grab');
  localPreview.addEventListener('pointermove', (event) => {
    if (drag || !localPreview.classList.contains('visible')) return;
    localPreview.style.cursor = resizeCursor(previewEdge(event));
  });
  localPreview.addEventListener('pointerleave', () => { if (!drag) localPreview.style.cursor = 'grab'; });
  localPreview.addEventListener('pointerdown', (event) => {
    if (!localPreview.classList.contains('visible') || event.button !== 0) return;
    const box = localPreview.getBoundingClientRect();
    const edge = previewEdge(event, box);
    drag = edge
      ? { mode: 'resize', edge, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startSize: box.width, startPosition: { ...previewPosition } }
      : { mode: 'move', pointerId: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    localPreview.setPointerCapture?.(event.pointerId);
    localPreview.classList.add(drag.mode === 'resize' ? 'resizing' : 'dragging');
    localPreview.style.cursor = edge ? resizeCursor(edge) : 'grabbing';
    event.preventDefault();
  });
  const movePreview = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.mode === 'resize') {
      const horizontalDelta = drag.edge.includes('e') ? event.clientX - drag.startX : drag.edge.includes('w') ? drag.startX - event.clientX : 0;
      const verticalDelta = drag.edge.includes('s') ? (event.clientY - drag.startY) * 16 / 9 : drag.edge.includes('n') ? (drag.startY - event.clientY) * 16 / 9 : 0;
      const delta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta;
      const viewportLimit = Math.max(previewMinSize, (document.documentElement.clientWidth || window.innerWidth) - previewMargin * 2);
      previewSize = Math.max(previewMinSize, Math.min(Math.min(previewMaxSize, viewportLimit), drag.startSize + delta));
      let x = drag.startPosition.x; let y = drag.startPosition.y;
      if (drag.edge.includes('w')) x += drag.startSize - previewSize;
      if (drag.edge.includes('n')) y += (drag.startSize - previewSize) * 9 / 16;
      applyPreviewPosition({ x, y });
      previewPosition = clampPreview(x, y);
    } else previewPosition = clampPreview(event.clientX - drag.dx, event.clientY - drag.dy);
    applyPreviewPosition(previewPosition);
    event.preventDefault();
  };
  const endDrag = (event) => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const pointerId = drag.pointerId;
    drag = null;
    if (localPreview.hasPointerCapture?.(pointerId)) localPreview.releasePointerCapture(pointerId);
    localPreview.classList.remove('dragging', 'resizing');
    localPreview.style.cursor = 'grab';
    savePreviewPosition();
  };
  // Window listeners preserve the drag even when the cursor leaves the small
  // preview, which is essential when moving it across the entire app window.
  window.addEventListener('pointermove', movePreview, { capture: true, passive: false });
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', endDrag, true);
  window.addEventListener('resize', placePreview);
  new MutationObserver(placePreview).observe(localPreview, { attributes: true, attributeFilter: ['class'] });
  placePreview();
}

// A hosted room is usable as soon as Socket.IO confirms the room, even while
// WebRTC is still looking for peers. Older cloud hosts may not answer the new
// presence request, so we merge every valid presence event instead of wiping
// people that were already announced by room-joined / peer-joined.
const betaWebrtcPrevious = new WeakMap();
const betaCollectPeerStats = async (peerId, participant) => {
  const pc = participant?.pc;
  if (!pc || pc.signalingState === 'closed' || typeof pc.getStats !== 'function') return null;
  const report = await pc.getStats();
  const items = new Map(); report.forEach((item) => items.set(item.id, item));
  let selectedPair = null; let inboundBytes = 0; let outboundBytes = 0; let jitterMs = null; let packetsLost = 0; let codec = '';
  for (const item of items.values()) {
    if (item.type === 'transport' && item.selectedCandidatePairId) selectedPair = items.get(item.selectedCandidatePairId) || selectedPair;
    if (item.type === 'candidate-pair' && (item.selected || (item.nominated && item.state === 'succeeded'))) selectedPair ||= item;
    if (item.type === 'inbound-rtp' && !item.isRemote) {
      inboundBytes += Number(item.bytesReceived || 0); packetsLost += Math.max(0, Number(item.packetsLost || 0));
      if (Number.isFinite(Number(item.jitter))) jitterMs = Math.max(jitterMs || 0, Number(item.jitter) * 1000);
      codec ||= items.get(item.codecId)?.mimeType || '';
    }
    if (item.type === 'outbound-rtp' && !item.isRemote) { outboundBytes += Number(item.bytesSent || 0); codec ||= items.get(item.codecId)?.mimeType || ''; }
  }
  const now = Date.now(); const previous = betaWebrtcPrevious.get(pc); const elapsed = previous ? Math.max(250, now - previous.sampledAt) : 0;
  betaWebrtcPrevious.set(pc, { sampledAt: now, inboundBytes, outboundBytes });
  const localCandidate = selectedPair ? items.get(selectedPair.localCandidateId) : null;
  const remoteCandidate = selectedPair ? items.get(selectedPair.remoteCandidateId) : null;
  return {
    peerId: String(peerId), connectionState: pc.connectionState || 'unknown', iceConnectionState: pc.iceConnectionState || 'unknown',
    rttMs: Number.isFinite(Number(selectedPair?.currentRoundTripTime)) ? Number(selectedPair.currentRoundTripTime) * 1000 : null,
    jitterMs, packetsLost,
    inboundKbps: elapsed ? Math.max(0, (inboundBytes - previous.inboundBytes) * 8 / elapsed) : 0,
    outboundKbps: elapsed ? Math.max(0, (outboundBytes - previous.outboundBytes) * 8 / elapsed) : 0,
    availableOutgoingKbps: Number.isFinite(Number(selectedPair?.availableOutgoingBitrate)) ? Number(selectedPair.availableOutgoingBitrate) / 1000 : null,
    localCandidateType: localCandidate?.candidateType || '', remoteCandidateType: remoteCandidate?.candidateType || '',
    protocol: localCandidate?.protocol || remoteCandidate?.protocol || '', codec
  };
};
const betaReportWebrtcStats = async () => {
  const socket = hostedSocket;
  if (!socket?.connected || currentMode !== 'hosted') return;
  const peers = (await Promise.all([...hostedPeers.entries()].map(([id, participant]) => betaCollectPeerStats(id, participant).catch(() => null)))).filter(Boolean);
  socket.emit('webrtc-stats', { sampledAt: Date.now(), peers });
};
window.setInterval(() => void betaReportWebrtcStats(), 3000);

let betaClusterAlternates = [];
let betaClusterSwitching = false;
let betaClusterFailures = 0;
const betaClusterVisited = new Set();
const betaSwitchClusterHost = (url, reason = 'Reconectando no host alternativo…') => {
  const next = String(url || '').trim().replace(/\/$/, '');
  const current = String(document.querySelector('#host-url')?.value || '').trim().replace(/\/$/, '');
  if (betaClusterSwitching || !/^https?:\/\//i.test(next) || next === current || betaClusterVisited.has(next)) return false;
  betaClusterSwitching = true; betaClusterVisited.add(current); betaClusterFailures = 0;
  window.voiceupClusterResumeChannel = activeVoiceChannel || '';
  const oldSocket = hostedSocket; hostedSocket = null; oldSocket?.disconnect?.(); clearHostedVoice();
  const field = document.querySelector('#host-url'); if (field) field.value = next;
  saveProfile(); setStatus(reason);
  window.setTimeout(async () => { betaClusterSwitching = false; await joinHostedRoom(); }, 180);
  return true;
};
const betaBoundHostedSockets = new WeakSet();
const bindHostedStatusAndPresence = (socket) => {
  if (!socket || betaBoundHostedSockets.has(socket)) return;
  betaBoundHostedSockets.add(socket);
  const mergePresence = (members) => {
    rememberCurrentMember();
    for (const member of members || []) {
      if (member?.id) rememberHostedMember(member, Object.prototype.hasOwnProperty.call(member, 'voiceChannel') ? member.voiceChannel : activeVoiceChannel);
    }
    renderRoomChannels();
    renderBetaMembers();
  };
  let connectedOnce = false;
  let reconnectTimer = 0;
  let failoverTimer = 0;
  socket.on('connect', () => {
    // Socket.IO reconnects automatically. A fresh signalling session needs
    // fresh peers as their old RTCPeerConnections belong to the prior socket.
    if (connectedOnce) {
      clearHostedVoice();
      renderRoomChannels();
    }
    clearTimeout(reconnectTimer);
    clearTimeout(failoverTimer);
    document.body.classList.remove('hosted-reconnecting');
    connectedOnce = true;
    setStatus('Entrando na sala...', true);
  });
  socket.on('room-joined', ({ peers, voiceChannel }) => {
    betaClusterFailures = 0; betaClusterVisited.clear();
    activeVoiceChannel = ROOM_CHANNELS.voice.includes(voiceChannel) ? voiceChannel : '';
    mergePresence(peers);
    setStatus(activeVoiceChannel ? `No canal ${activeVoiceChannel} · aguardando participantes` : 'No servidor · escolha um canal de voz', true);
    renderCentralCallMembers();
    socket.emit('request-room-presence');
  });
  socket.on('room-presence', ({ members }) => {
    mergePresence(members);
    renderCentralCallMembers();
  });
  socket.on('peer-joined', (member) => {
    mergePresence([member]);
    renderCentralCallMembers();
  });
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') {
      clearHostedVoice();
      renderRoomChannels();
      renderBetaMembers();
      document.body.classList.add('hosted-reconnecting');
      clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        if (socket.connected) return;
        serverMembers.clear();
        rememberCurrentMember();
        renderRoomChannels(); renderBetaMembers(); renderCentralCallMembers();
      }, 20000);
      clearTimeout(failoverTimer);
      const alternate = betaClusterAlternates.find((node) => /^https?:\/\//i.test(node?.url || '') && !betaClusterVisited.has(String(node.url).replace(/\/$/, '')));
      if (alternate) failoverTimer = window.setTimeout(() => {
        if (!socket.connected) betaSwitchClusterHost(alternate.url, 'Host indisponível · ativando failover…');
      }, 900);
    }
    setStatus(reason === 'io client disconnect' ? 'Servidor desconectado' : 'Reconectando ao servidor…');
  });
  socket.on('connect_error', (error) => {
    betaClusterFailures += 1;
    const reason = error?.message ? ` (${error.message})` : '';
    setStatus(`Não foi possível alcançar o host${reason}`);
    if (betaClusterFailures >= 3) {
      const alternate = betaClusterAlternates.find((node) => /^https?:\/\//i.test(node?.url || '') && !betaClusterVisited.has(String(node.url).replace(/\/$/, '')));
      if (alternate) betaSwitchClusterHost(alternate.url, 'Host indisponível · ativando failover…');
    }
  });
  socket.on('cluster-route', ({ alternates, failover } = {}) => { betaClusterAlternates = failover === false ? [] : (Array.isArray(alternates) ? alternates : []); });
  socket.on('cluster-redirect', ({ url, reason } = {}) => { betaSwitchClusterHost(url, reason || 'Distribuindo a conexão para o host menos carregado…'); });
  if (socket.connected) { setStatus(activeVoiceChannel ? `No canal ${activeVoiceChannel} · aguardando participantes` : 'No servidor · escolha um canal de voz', true); socket.emit('request-room-presence'); }
};
const betaJoinHostedRoom = joinHostedRoom;
joinHostedRoom = async function joinHostedRoomBeta(...args) {
  try {
    const result = await betaJoinHostedRoom(...args);
    bindHostedStatusAndPresence(hostedSocket);
    if (!hostedSocket) setStatus('Falha antes de abrir a conexao com o host');
    return result;
  } catch (error) {
    console.error('[VoiceUP] Falha ao entrar na sala hospedada', error);
    setStatus('Nao foi possivel iniciar a sala hospedada');
    toast(error?.message || 'Nao foi possivel iniciar a conexao hospedada.');
    return undefined;
  }
};
document.head.insertAdjacentHTML('beforeend', `<style>
body.beta-welcome-open{overflow:auto!important}body.beta-welcome-open .welcome{height:auto!important;min-height:100dvh;padding-bottom:42px!important}.participant.speaking{background:color-mix(in srgb,var(--focus) 8%,transparent)!important}.participant.speaking .avatar{outline:2px solid var(--focus);outline-offset:3px;box-shadow:0 0 0 4px color-mix(in srgb,var(--focus) 18%,transparent),0 0 14px color-mix(in srgb,var(--focus) 55%,transparent)}.members-clone .participant.speaking{box-shadow:none!important}.local-video.visible{position:fixed!important;z-index:80;cursor:grab;touch-action:none;transition:box-shadow .15s,transform .15s}.local-video.visible:hover{box-shadow:0 0 0 2px var(--focus),var(--shadow)!important}.local-video.dragging{cursor:grabbing;transform:scale(1.02);box-shadow:0 0 0 3px var(--focus),var(--shadow)!important;transition:none}#chat-panel{grid-template-rows:minmax(0,1fr) auto 64px!important}.typing-indicator{display:grid;gap:5px;padding:7px 14px 5px;border-top:1px solid color-mix(in srgb,var(--line) 58%,transparent);background:color-mix(in srgb,var(--night2) 94%,var(--focus) 2%);color:var(--muted);font-size:11px}.typing-person{display:flex;align-items:center;gap:7px;min-width:0}.typing-person>b,.typing-person span b{color:var(--ink)}.typing-avatar{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:0 0 22px;color:#fff;font-size:8px;font-weight:800}.typing-dots{display:inline-flex;align-items:center;gap:3px;margin-left:1px;height:12px}.typing-dots em{width:4px;height:4px;border-radius:50%;background:var(--focus);animation:voiceup-typing 1.8s ease-in-out infinite}.typing-dots em:nth-child(2){animation-delay:.25s}.typing-dots em:nth-child(3){animation-delay:.5s}@keyframes voiceup-typing{0%,65%,100%{transform:translateY(0);opacity:.35}32%{transform:translateY(-3px);opacity:1}}@media(prefers-reduced-motion:reduce){.typing-dots em{animation:none;opacity:.75}}
</style>`);

// Settings can be long on smaller screens. Move the existing save button into
// the sticky heading, preserving the original application's save handler.
const settingsDialog = document.querySelector('#settings-modal section');
const settingsSave = document.querySelector('#settings-save');
const settingsClose = document.querySelector('#settings-close');
if (settingsDialog && settingsSave && settingsClose && !document.querySelector('#settings-sticky-actions')) {
  const heading = settingsClose.parentElement;
  heading.classList.add('settings-sticky-heading');
  const actions = document.createElement('div');
  actions.id = 'settings-sticky-actions';
  actions.append(settingsSave, settingsClose);
  heading.append(actions);
}
document.head.insertAdjacentHTML('beforeend', `<style>
#settings-modal section{padding-top:0!important}#settings-modal .settings-sticky-heading{position:sticky;top:0;z-index:3;margin:0 -24px 18px!important;padding:17px 24px 15px;background:color-mix(in srgb,var(--panel) 96%,var(--night));border-bottom:1px solid var(--line);box-shadow:0 8px 16px rgba(0,0,0,.12)}#settings-sticky-actions{display:flex;align-items:center;gap:10px}#settings-save{width:auto!important;margin:0!important;padding:9px 13px!important;white-space:nowrap;background:var(--focus)!important;color:var(--beta-button-ink)!important;font-size:13px}#settings-close{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line)!important;border-radius:8px!important;font-size:20px!important}@media(max-width:520px){#settings-modal .settings-sticky-heading{padding:14px 16px;margin:0 -16px 16px!important}#settings-modal section{padding-left:16px!important;padding-right:16px!important}#settings-modal .settings-sticky-heading h2{font-size:19px!important}#settings-save{padding:8px 10px!important;font-size:12px}}
</style>`);

// Keep the settings compact: the original controls stay exactly the same, but
// are presented in short groups instead of one long scrolling form.
if (settingsDialog && !document.querySelector('#settings-tabs')) {
  const tabs = document.createElement('div');
  tabs.id = 'settings-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" class="settings-tab active" data-settings-tab="general">Geral</button><button type="button" class="settings-tab" data-settings-tab="appearance">Aparência</button><button type="button" class="settings-tab" data-settings-tab="audio">Áudio</button><button type="button" class="settings-tab" data-settings-tab="video">Vídeo e live</button>';
  const panels = document.createElement('div');
  panels.id = 'settings-tab-panels';
  panels.innerHTML = '<div class="settings-panel active" data-settings-panel="general"></div><div class="settings-panel" data-settings-panel="appearance"></div><div class="settings-panel" data-settings-panel="audio"></div><div class="settings-panel" data-settings-panel="video"></div>';
  settingsDialog.insertBefore(tabs, settingsDialog.querySelector('#client-preferences') || settingsDialog.lastElementChild);
  settingsDialog.insertBefore(panels, tabs.nextSibling);
  const panel = (name) => panels.querySelector(`[data-settings-panel="${name}"]`);
  const move = (node, destination) => { if (node) destination.append(node); };
  move(document.querySelector('#installed-version')?.parentElement, panel('general'));
  move(document.querySelector('#theme-select')?.closest('label'), panel('appearance'));
  move(document.querySelector('#client-preferences'), panel('general'));
  move(document.querySelector('#chat-style-select')?.closest('label'), panel('appearance'));
  move(document.querySelector('#noise-select')?.closest('label'), panel('audio'));
  move(document.querySelector('#audio-input-select')?.closest('label'), panel('audio'));
  move(document.querySelector('#audio-output-select')?.closest('label'), panel('audio'));
  move(document.querySelector('#camera-input-select')?.closest('label'), panel('video'));
  move(document.querySelector('#screen-source-select')?.closest('label'), panel('video'));
  move(document.querySelector('#screen-audio-toggle')?.closest('label'), panel('video'));
  move(document.querySelector('#carry-media-toggle')?.closest('label'), panel('video'));
  move(document.querySelector('#refresh-devices'), panel('video'));
  move(document.querySelector('#device-note'), panel('video'));
  // The old section is only a wrapper once its fields have moved.
  document.querySelector('#device-settings')?.remove();
  const selectTab = (name) => {
    tabs.querySelectorAll('.settings-tab').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === name));
    panels.querySelectorAll('.settings-panel').forEach((item) => item.classList.toggle('active', item.dataset.settingsPanel === name));
  };
  tabs.querySelectorAll('.settings-tab').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.settingsTab)));
}

// Camera selection and preview live entirely inside Settings. The preview
// never enters a peer connection; it only verifies the selected Windows
// device before the user enables the camera in a call.
const videoSettingsPanel = document.querySelector('[data-settings-panel="video"]');
const cameraInputSelect = document.querySelector('#camera-input-select');
if (videoSettingsPanel && cameraInputSelect && !document.querySelector('#camera-settings-preview-panel')) {
  const cameraLabel = cameraInputSelect.closest('label');
  const previewPanel = document.createElement('section');
  previewPanel.id = 'camera-settings-preview-panel';
  previewPanel.innerHTML = `<div class="camera-preview-heading"><div><strong>Prévia da câmera</strong><small>Somente você vê este teste.</small></div><button id="camera-preview-toggle" type="button">Iniciar prévia</button></div><div class="camera-preview-frame"><video id="camera-settings-preview" autoplay muted playsinline></video><div id="camera-preview-empty">Selecione uma câmera e inicie a prévia.</div></div><small id="camera-preview-status">A câmera escolhida será usada ao clicar em Ligar câmera.</small>`;
  cameraLabel?.insertAdjacentElement('afterend', previewPanel);
}
let cameraSettingsPreviewStream = null;
let cameraSettingsPreviewOwnsStream = false;
const cameraSettingsPreview = document.querySelector('#camera-settings-preview');
const cameraPreviewToggle = document.querySelector('#camera-preview-toggle');
const cameraPreviewEmpty = document.querySelector('#camera-preview-empty');
const cameraPreviewStatus = document.querySelector('#camera-preview-status');
const stopCameraSettingsPreview = async () => {
  if (cameraSettingsPreviewOwnsStream) cameraSettingsPreviewStream?.getTracks?.().forEach((track) => track.stop());
  cameraSettingsPreviewStream = null; cameraSettingsPreviewOwnsStream = false;
  if (cameraSettingsPreview) cameraSettingsPreview.srcObject = null;
  cameraPreviewEmpty?.classList.remove('hidden');
  if (cameraPreviewToggle) cameraPreviewToggle.textContent = 'Iniciar prévia';
  if (cameraPreviewStatus) cameraPreviewStatus.textContent = 'A câmera escolhida será usada ao clicar em Ligar câmera.';
};
window.voiceupStopCameraSettingsPreview = stopCameraSettingsPreview;
const startCameraSettingsPreview = async () => {
  await stopCameraSettingsPreview();
  const chosenDevice = cameraInputSelect?.value || '';
  try {
    if (cameraStream && chosenDevice === cameraInputId) {
      cameraSettingsPreviewStream = cameraStream;
      cameraSettingsPreviewOwnsStream = false;
    } else {
      const constraints = quality();
      if (chosenDevice) constraints.deviceId = { exact: chosenDevice };
      cameraSettingsPreviewStream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      cameraSettingsPreviewOwnsStream = true;
    }
    const track = cameraSettingsPreviewStream?.getVideoTracks?.()[0];
    if (!track) throw new Error('A câmera não criou uma faixa de vídeo.');
    cameraSettingsPreview.srcObject = cameraSettingsPreviewStream;
    await cameraSettingsPreview.play().catch(() => {});
    cameraPreviewEmpty?.classList.add('hidden');
    if (cameraPreviewToggle) cameraPreviewToggle.textContent = 'Parar prévia';
    const settings = track.getSettings?.() || {};
    if (cameraPreviewStatus) cameraPreviewStatus.textContent = `${track.label || 'Câmera disponível'}${settings.width && settings.height ? ` · ${settings.width} × ${settings.height}` : ''}`;
    const selectedValue = cameraInputSelect.value;
    await refreshDeviceControls();
    if ([...cameraInputSelect.options].some((option) => option.value === selectedValue)) cameraInputSelect.value = selectedValue;
  } catch (error) {
    await stopCameraSettingsPreview();
    const detail = error?.name === 'NotAllowedError'
      ? 'Permita o acesso em Configurações do Windows > Privacidade e segurança > Câmera.'
      : error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
        ? 'A câmera selecionada não está conectada ou está indisponível.'
        : error?.message || 'Feche outro programa que esteja usando a câmera e tente novamente.';
    if (cameraPreviewStatus) cameraPreviewStatus.textContent = detail;
  }
};
cameraPreviewToggle?.addEventListener('click', () => { if (cameraSettingsPreviewStream) void stopCameraSettingsPreview(); else void startCameraSettingsPreview(); });
cameraInputSelect?.addEventListener('change', () => { if (cameraSettingsPreviewStream) void startCameraSettingsPreview(); });
document.querySelector('#settings-close')?.addEventListener('click', () => void stopCameraSettingsPreview());
document.querySelector('#settings-save')?.addEventListener('click', () => void stopCameraSettingsPreview());
const settingsModalForCamera = document.querySelector('#settings-modal');
if (settingsModalForCamera) new MutationObserver(() => { if (settingsModalForCamera.classList.contains('hidden')) void stopCameraSettingsPreview(); }).observe(settingsModalForCamera, { attributes: true, attributeFilter: ['class'] });
document.head.insertAdjacentHTML('beforeend', `<style>
#camera-settings-preview-panel{display:grid;gap:10px;padding:13px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--surface) 76%,transparent)}.camera-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.camera-preview-heading>div{display:grid;gap:2px}.camera-preview-heading small,#camera-preview-status{color:var(--muted);font-size:10px;line-height:1.4}.camera-preview-heading button{padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--ink);font-weight:700}.camera-preview-frame{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#05070d}.camera-preview-frame video{width:100%;height:100%;object-fit:contain;background:#05070d}.camera-preview-frame #camera-preview-empty{position:absolute;inset:0;display:grid;place-items:center;padding:20px;color:#91a0b6;text-align:center;font-size:11px}.camera-preview-frame #camera-preview-empty.hidden{display:none}@media(max-width:520px){.camera-preview-heading{align-items:stretch;flex-direction:column}.camera-preview-heading button{width:100%}}
</style>`);

// Theme samples use the same main colors as the application. Selecting a card
// previews it immediately; closing Settings restores the previous theme while
// Save keeps the selected one through the existing profile persistence.
const themeCatalog = [
  { id: 'aurora', name: 'Aurora', detail: 'Turquesa e coral', colors: ['#0b1220', '#111b2e', '#18243a', '#56e2cf', '#ff826f'] },
  { id: 'midnight', name: 'Meia-noite', detail: 'Índigo e rosa', colors: ['#090b18', '#12172b', '#0c1020', '#8c8cff', '#f17bb7'] },
  { id: 'ember', name: 'Brasa', detail: 'Laranja e dourado', colors: ['#1a1110', '#291916', '#180e0d', '#ffc15a', '#ff7564'] },
  { id: 'forest', name: 'Floresta', detail: 'Verde e âmbar', colors: ['#0b1916', '#102821', '#091611', '#68e1ad', '#d6be74'] },
  { id: 'ocean', name: 'Oceano', detail: 'Azul profundo', colors: ['#081824', '#0d2635', '#081721', '#63d5ed', '#f29770'] },
  { id: 'grape', name: 'Uva', detail: 'Roxo e rosa', colors: ['#171025', '#24183a', '#160e22', '#c2a0ff', '#f184bd'] },
  { id: 'cyber', name: 'Cyber', detail: 'Azul e neon', colors: ['#050d1b', '#0a1930', '#071426', '#38d9ff', '#aa7cff'] },
  { id: 'crimson', name: 'Carmesim', detail: 'Vinho e rubi', colors: ['#17090e', '#281017', '#12070b', '#ff6680', '#f5a45d'] },
  { id: 'obsidian', name: 'Obsidiana', detail: 'Grafite e jade', colors: ['#101414', '#18201f', '#0c1111', '#6bd6b0', '#c8a96a'] },
  { id: 'cobalt', name: 'Cobalto', detail: 'Azul e laranja', colors: ['#081326', '#102449', '#081a35', '#6da7ff', '#ff9a61'] },
  { id: 'snow', name: 'Neve colorida', detail: 'Azul sereno fosco', light: true, colors: ['#c7d7e7', '#d9e4ef', '#b9ccdf', '#197d8c', '#c95872'] },
  { id: 'lilac', name: 'Lilás fosco', detail: 'Violeta suave', light: true, colors: ['#d7c9e8', '#e5d9f0', '#cbbadc', '#7153ad', '#c9588a'] },
  { id: 'sage', name: 'Sálvia fosca', detail: 'Verde natural', light: true, colors: ['#c8d9c8', '#d9e5d5', '#b9cfbd', '#2c765e', '#c46758'] },
  { id: 'peach', name: 'Pêssego fosco', detail: 'Coral quente', light: true, colors: ['#e4c8be', '#eed9d1', '#d9b9ae', '#a64f67', '#c96542'] },
  { id: 'mist', name: 'Névoa fosca', detail: 'Cinza azulado', light: true, colors: ['#c8d1dc', '#d9e0e8', '#bbc6d2', '#426e9d', '#aa6077'] }
];
const themeSelect = document.querySelector('#theme-select');
const themeLabel = themeSelect?.closest('label');
let themeBeforeSettings = null;
if (themeLabel && !document.querySelector('#theme-samples')) {
  const samples = document.createElement('section');
  samples.id = 'theme-samples';
  samples.setAttribute('aria-label', 'Amostras de temas');
  samples.innerHTML = `<div class="theme-samples-heading"><strong>Amostras</strong><small>Clique para visualizar antes de salvar.</small></div><div class="theme-samples-grid">${themeCatalog.map(({ id, name, detail, light, colors }) => `
    <button class="theme-sample-card${light ? ' light' : ''}" type="button" data-theme-sample="${id}" aria-label="Visualizar tema ${name}" style="--sample-base:${colors[0]};--sample-content:${colors[1]};--sample-side:${colors[2]};--sample-focus:${colors[3]};--sample-coral:${colors[4]}">
      <span class="theme-sample-window" aria-hidden="true"><i></i><b><em></em><em></em></b><u></u></span>
      <span class="theme-sample-copy"><strong>${name}</strong><small>${detail}</small></span>
      <span class="theme-sample-check" aria-hidden="true">✓</span>
    </button>`).join('')}</div>`;
  themeLabel.insertAdjacentElement('afterend', samples);
  const selectThemeSample = (nextTheme, preview = true) => {
    if (!themeCatalog.some((item) => item.id === nextTheme)) return;
    themeSelect.value = nextTheme;
    samples.querySelectorAll('[data-theme-sample]').forEach((card) => {
      const selected = card.dataset.themeSample === nextTheme;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    if (preview) applyTheme(nextTheme);
  };
  samples.querySelectorAll('[data-theme-sample]').forEach((card) => card.addEventListener('click', () => selectThemeSample(card.dataset.themeSample)));
  themeSelect.addEventListener('change', () => selectThemeSample(themeSelect.value));
  document.querySelector('#settings-button')?.addEventListener('click', () => {
    themeBeforeSettings = theme;
    selectThemeSample(theme, false);
  });
  document.querySelector('#settings-close')?.addEventListener('click', () => { themeBeforeSettings = null; }, true);
  document.querySelector('#settings-save')?.addEventListener('click', () => { themeBeforeSettings = null; }, true);
  selectThemeSample(theme, false);
}
const appearancePanel = document.querySelector('[data-settings-panel="appearance"]');
if (appearancePanel && !document.querySelector('#appearance-options')) {
  appearancePanel.insertAdjacentHTML('beforeend', `<section id="appearance-options" class="appearance-options">
    <div class="appearance-options-heading"><strong>Interface neste computador</strong><small>Essas escolhas não alteram o servidor nem outros usuários.</small></div>
    <div class="appearance-options-grid">
      <label>Densidade<select id="appearance-density"><option value="comfortable">Confortável</option><option value="compact">Compacta</option></select></label>
      <label>Tamanho do texto<select id="appearance-font-scale"><option value="small">Pequeno</option><option value="normal">Normal</option><option value="large">Grande</option></select></label>
      <label>Largura do painel lateral<select id="appearance-panel-width"><option value="narrow">Estreito</option><option value="normal">Normal</option><option value="wide">Amplo</option></select></label>
      <label>Animações<select id="appearance-motion"><option value="full">Suaves</option><option value="reduced">Reduzidas</option></select></label>
    </div>
    <label class="appearance-effects"><input id="appearance-effects" type="checkbox"/> Usar brilhos, transparências e efeitos de fundo</label>
  </section>`);
  const densityControl = document.querySelector('#appearance-density');
  const fontControl = document.querySelector('#appearance-font-scale');
  const widthControl = document.querySelector('#appearance-panel-width');
  const motionControl = document.querySelector('#appearance-motion');
  const effectsControl = document.querySelector('#appearance-effects');
  const syncAppearanceControls = () => {
    densityControl.value = betaInterfaceDensity;
    fontControl.value = betaFontScale;
    widthControl.value = betaPanelWidth;
    motionControl.value = betaMotion;
    effectsControl.checked = betaBackdropEffects;
  };
  const previewAppearance = () => {
    betaInterfaceDensity = densityControl.value;
    betaFontScale = fontControl.value;
    betaPanelWidth = widthControl.value;
    betaMotion = motionControl.value;
    betaBackdropEffects = effectsControl.checked;
    applyAppearancePreferences();
  };
  [densityControl, fontControl, widthControl, motionControl, effectsControl].forEach((control) => {
    control.addEventListener('input', previewAppearance);
    control.addEventListener('change', previewAppearance);
  });
  let appearanceBeforeSettings = null;
  document.querySelector('#settings-button')?.addEventListener('click', () => {
    appearanceBeforeSettings = { density: betaInterfaceDensity, fontScale: betaFontScale, panelWidth: betaPanelWidth, motion: betaMotion, effects: betaBackdropEffects };
    syncAppearanceControls();
  });
  document.querySelector('#settings-close')?.addEventListener('click', () => { appearanceBeforeSettings = null; }, true);
  document.querySelector('#settings-save')?.addEventListener('click', () => { previewAppearance(); appearanceBeforeSettings = null; }, true);
  syncAppearanceControls();
}
document.head.insertAdjacentHTML('beforeend', `<style>
#settings-tabs{display:flex;gap:8px;margin:0 0 18px;border-bottom:1px solid var(--line);padding:0 0 10px}.settings-tab{padding:8px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted);font-weight:700}.settings-tab:hover{color:var(--ink);background:color-mix(in srgb,var(--focus) 8%,transparent)}.settings-tab.active{color:var(--ink);border-color:var(--focus);background:color-mix(in srgb,var(--focus) 15%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--focus) 22%,transparent)}#settings-tab-panels{min-height:252px}.settings-panel{display:none;gap:13px}.settings-panel.active{display:grid}.settings-panel>label,.settings-panel #client-preferences{margin:0!important}.settings-panel #client-preferences{border-top:1px solid var(--line)!important;padding-top:15px!important}.settings-panel #client-preferences>div{gap:12px!important}.settings-panel #refresh-devices{justify-self:start}.settings-panel #device-note{display:block;margin-top:-4px;line-height:1.45}.settings-panel strong{margin-top:2px}@media(max-width:520px){#settings-tabs{gap:5px}.settings-tab{padding:8px 9px;font-size:12px}#settings-tab-panels{min-height:278px}}
</style>`);

// Beta 17: the phone leaves only the current hosted voice channel. Presence,
// text chat and the member list remain connected to the server.
async function leaveHostedVoiceChannel() {
  if (currentMode !== 'hosted' || !hostedSocket?.connected) return false;
  if (!activeVoiceChannel) { toast('Você já está fora das calls.'); return true; }
  if (!carryMediaOnChannelChange) {
    await stopCamera().catch(() => {});
    await stopScreenShare().catch(() => {});
  }
  clearHostedVoice();
  activeVoiceChannel = '';
  rememberCurrentMember();
  renderRoomChannels();
  renderCentralCallMembers();
  saveProfile();
  localStream?.getAudioTracks?.().forEach((track) => { track.enabled = false; });
  localSpeaking = false;
  document.querySelector('[data-call-member="self"]')?.classList.remove('speaking');
  hostedSocket.emit('switch-voice-channel', { voiceChannel: HOSTED_LOBBY_CHANNEL });
  hostedSocket.emit('request-room-presence');
  setStatus('No servidor · fora das calls', true);
  document.querySelector('#connection-state').textContent = 'Fora da call';
  playNotification('disconnect');
  return true;
}
const leaveCallButton = document.querySelector('#leave-button');
leaveCallButton?.addEventListener('click', (event) => {
  if (currentMode !== 'hosted') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void leaveHostedVoiceChannel();
}, true);

// Re-enable the microphone only when the user explicitly enters another call.
const betaSwitchVoiceChannel = switchVoiceChannel;
switchVoiceChannel = async function switchVoiceChannelBeta17(channel) {
  const wasOutsideCall = currentMode === 'hosted' && !activeVoiceChannel;
  const result = await betaSwitchVoiceChannel(channel);
  if (wasOutsideCall && ROOM_CHANNELS.voice.includes(channel)) {
    localStream?.getAudioTracks?.().forEach((track) => { track.enabled = micEnabled; });
  }
  return result;
};

// Microphone test: live dB meter, adjustable voice threshold and optional
// local monitoring. Its independent stream never gets published to the call.
const audioSettingsPanel = document.querySelector('[data-settings-panel="audio"]');
if (audioSettingsPanel && !document.querySelector('#mic-test-panel')) {
  audioSettingsPanel.insertAdjacentHTML('beforeend', `<section id="global-volume-panel" class="global-volume-panel">
    <div class="volume-panel-heading"><strong>Volumes globais</strong><small>Padrão: 100%</small></div>
    <label><span>Volume de entrada <b id="input-volume-value">${Math.round(betaInputVolume)}%</b></span><input id="input-volume-range" type="range" min="0" max="200" step="1" value="${Math.round(betaInputVolume)}"/></label>
    <label><span>Volume de saída <b id="output-volume-value">${Math.round(betaOutputVolume)}%</b></span><input id="output-volume-range" type="range" min="0" max="200" step="1" value="${Math.round(betaOutputVolume)}"/></label>
    <small>Entrada altera o que você envia. Saída altera todos os participantes; o ajuste individual é aplicado por cima deste valor.</small>
  </section>`);
  audioSettingsPanel.insertAdjacentHTML('beforeend', `<section id="mic-test-panel">
    <div class="mic-test-heading"><strong>Teste do microfone</strong><span id="mic-db-value">— dB</span></div>
    <div class="mic-meter" aria-label="Nível atual do microfone"><i id="mic-meter-fill"></i><b id="mic-threshold-marker"></b></div>
    <label>Limite para detectar voz <span id="mic-threshold-value">${micThresholdDb} dB</span><input id="mic-threshold-input" type="range" min="-70" max="-10" step="1" value="${micThresholdDb}"/></label>
    <label class="mic-monitor-option"><input id="mic-monitor-toggle" type="checkbox"${micMonitorEnabled ? ' checked' : ''}/> Ouvir meu microfone durante o teste</label>
    <div class="mic-test-actions"><button id="mic-test-toggle" type="button">Iniciar teste</button><small>Fale normalmente e deixe o limite acima do ruído ambiente.</small></div>
  </section>`);
}
let micTestStream = null;
let micTestContext = null;
let micTestFrame = 0;
let micTestAudio = null;
let micTestOriginalMediaState = null;
const micTestButton = document.querySelector('#mic-test-toggle');
const micThresholdInput = document.querySelector('#mic-threshold-input');
const micMonitorToggle = document.querySelector('#mic-monitor-toggle');
const inputVolumeRange = document.querySelector('#input-volume-range');
const outputVolumeRange = document.querySelector('#output-volume-range');
let volumeBeforeSettings = null;
const updateGlobalVolumeUi = () => {
  const inputLabel = document.querySelector('#input-volume-value');
  const outputLabel = document.querySelector('#output-volume-value');
  if (inputLabel) inputLabel.textContent = `${Math.round(betaInputVolume)}%`;
  if (outputLabel) outputLabel.textContent = `${Math.round(betaOutputVolume)}%`;
  if (inputVolumeRange) inputVolumeRange.value = String(betaInputVolume);
  if (outputVolumeRange) outputVolumeRange.value = String(betaOutputVolume);
};
const applyInputVolume = () => {
  const needsProcessedTrack = Math.abs(betaInputVolume - 100) >= 0.01;
  if (needsProcessedTrack !== Boolean(betaMicGainNode) && !sharedAudioTrack) void refreshOutgoingMicrophone();
  else if (betaMicGainNode) betaMicGainNode.gain.value = betaInputVolume / 100;
  if (betaSharedMicGainNode) betaSharedMicGainNode.gain.value = betaInputVolume / 100;
};
inputVolumeRange?.addEventListener('input', () => { betaInputVolume = Math.max(0, Math.min(200, Number(inputVolumeRange.value))); applyInputVolume(); updateGlobalVolumeUi(); });
outputVolumeRange?.addEventListener('input', () => { betaOutputVolume = Math.max(0, Math.min(200, Number(outputVolumeRange.value))); applyOutputMute(); updateGlobalVolumeUi(); });
document.querySelector('#settings-button')?.addEventListener('click', () => { volumeBeforeSettings = { input: betaInputVolume, output: betaOutputVolume }; updateGlobalVolumeUi(); });
document.querySelector('#settings-close')?.addEventListener('click', () => { volumeBeforeSettings = null; });
document.querySelector('#settings-save')?.addEventListener('click', () => { volumeBeforeSettings = null; saveProfile(); }, true);
updateGlobalVolumeUi();
const updateMicThresholdUi = () => {
  micThresholdDb = Math.max(-70, Math.min(-10, Number(micThresholdInput?.value ?? micThresholdDb)));
  const value = document.querySelector('#mic-threshold-value');
  const marker = document.querySelector('#mic-threshold-marker');
  if (value) value.textContent = `${micThresholdDb} dB`;
  if (marker) marker.style.left = `${((micThresholdDb + 70) / 60) * 100}%`;
};
const applyMicTestMonitoring = async () => {
  micMonitorEnabled = Boolean(micMonitorToggle?.checked);
  if (!micTestAudio || !micTestStream) return;
  micTestAudio.muted = !micMonitorEnabled;
  if (audioOutputId && typeof micTestAudio.setSinkId === 'function') await micTestAudio.setSinkId(audioOutputId).catch(() => {});
  if (micMonitorEnabled) micTestAudio.play().catch(() => {}); else micTestAudio.pause();
};
const refreshMicTestIsolationUi = () => {
  document.querySelector('#mic-button')?.classList.toggle('muted', !micEnabled);
  refreshMicButton();
  refreshOutputButton();
  refreshSelfMediaState();
};
const isolateCallDuringMicTest = () => {
  if (micTestOriginalMediaState) return;
  micTestOriginalMediaState = { micEnabled, outputMuted: betaOutputMuted };
  micEnabled = false;
  betaOutputMuted = true;
  localStream?.getAudioTracks?.().forEach((track) => { track.enabled = false; });
  localSpeaking = false;
  sendSignal('voice-state', false);
  document.querySelector('[data-call-member="self"]')?.classList.remove('speaking');
  applyOutputMute();
  refreshMicTestIsolationUi();
  document.querySelector('#mic-button')?.setAttribute('disabled', '');
  document.querySelector('#output-button')?.setAttribute('disabled', '');
  document.body.classList.add('mic-test-isolating');
  const state = document.querySelector('#connection-state');
  if (state) state.textContent = 'Teste de microfone · call silenciada';
};
const restoreCallAfterMicTest = () => {
  if (!micTestOriginalMediaState) return;
  const previous = micTestOriginalMediaState;
  micTestOriginalMediaState = null;
  micEnabled = previous.micEnabled;
  betaOutputMuted = previous.outputMuted;
  const mayTransmit = currentMode !== 'hosted' || Boolean(activeVoiceChannel);
  localStream?.getAudioTracks?.().forEach((track) => { track.enabled = micEnabled && mayTransmit; });
  applyOutputMute();
  refreshMicTestIsolationUi();
  document.querySelector('#mic-button')?.removeAttribute('disabled');
  document.querySelector('#output-button')?.removeAttribute('disabled');
  document.body.classList.remove('mic-test-isolating');
  const state = document.querySelector('#connection-state');
  if (state) state.textContent = micEnabled ? (mayTransmit ? 'Microfone ativo' : 'Fora da call') : 'Microfone desligado';
};
const stopMicTest = async () => {
  // Restore the call synchronously. Besides making the UI react immediately,
  // this prevents the temporary test mute from being persisted by Save.
  restoreCallAfterMicTest();
  cancelAnimationFrame(micTestFrame);
  micTestFrame = 0;
  micTestAudio?.pause();
  if (micTestAudio) micTestAudio.srcObject = null;
  micTestAudio = null;
  micTestStream?.getTracks().forEach((track) => track.stop());
  micTestStream = null;
  await micTestContext?.close().catch(() => {});
  micTestContext = null;
  if (micTestButton) micTestButton.textContent = betaT('audio.startTest') || 'Iniciar teste';
  const value = document.querySelector('#mic-db-value');
  const fill = document.querySelector('#mic-meter-fill');
  if (value) value.textContent = '— dB';
  if (fill) fill.style.width = '0%';
};
const startMicTest = async () => {
  await stopMicTest();
  isolateCallDuringMicTest();
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false });
    micTestContext = new AudioContext();
    await micTestContext.resume();
    const analyser = micTestContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = .55;
    const samples = new Uint8Array(analyser.fftSize);
    micTestContext.createMediaStreamSource(micTestStream).connect(analyser);
    micTestAudio = new Audio();
    micTestAudio.srcObject = micTestStream;
    await applyMicTestMonitoring();
    micTestButton.textContent = betaT('audio.stopTest') || 'Parar teste';
    let testNoiseFloorDb = -70;
    let testCalibrationSamples = 0;
    let testAboveSince = 0;
    const sample = () => {
      if (!micTestContext || !micTestStream) return;
      analyser.getByteTimeDomainData(samples);
      let squareSum = 0;
      for (const value of samples) { const normalized = (value - 128) / 128; squareSum += normalized * normalized; }
      const rms = Math.sqrt(squareSum / samples.length);
      const db = Math.max(-70, Math.min(0, 20 * Math.log10(Math.max(rms, 0.00001))));
      const percent = ((db + 70) / 70) * 100;
      if (testCalibrationSamples < 30) {
        testNoiseFloorDb = testCalibrationSamples ? testNoiseFloorDb * .82 + db * .18 : db;
        testCalibrationSamples += 1;
      }
      const dynamicThresholdDb = Math.max(micThresholdDb, testNoiseFloorDb + 8);
      const aboveThreshold = testCalibrationSamples >= 30 && db >= dynamicThresholdDb;
      if (!aboveThreshold) {
        testAboveSince = 0;
        const learnRate = db < testNoiseFloorDb + 5 ? .025 : .004;
        testNoiseFloorDb = testNoiseFloorDb * (1 - learnRate) + db * learnRate;
      } else testAboveSince ||= performance.now();
      const detectedVoice = aboveThreshold && performance.now() - testAboveSince >= 85;
      const valueLabel = document.querySelector('#mic-db-value');
      const fill = document.querySelector('#mic-meter-fill');
      if (valueLabel) valueLabel.textContent = `${db.toFixed(1)} dB`;
      if (fill) { fill.style.width = `${percent}%`; fill.classList.toggle('above-threshold', detectedVoice); }
      micTestFrame = requestAnimationFrame(sample);
    };
    sample();
  } catch (error) {
    await stopMicTest();
    toast(error?.message || 'Não foi possível iniciar o teste do microfone.');
  }
};
micTestButton?.addEventListener('click', () => { if (micTestStream) void stopMicTest(); else void startMicTest(); });
micThresholdInput?.addEventListener('input', updateMicThresholdUi);
micMonitorToggle?.addEventListener('change', () => void applyMicTestMonitoring());
document.querySelector('#settings-close')?.addEventListener('click', () => void stopMicTest());
document.querySelector('#settings-save')?.addEventListener('click', restoreCallAfterMicTest, true);
document.querySelector('#settings-save')?.addEventListener('click', () => {
  updateMicThresholdUi();
  micMonitorEnabled = Boolean(micMonitorToggle?.checked);
  void stopMicTest();
  saveProfile();
});
updateMicThresholdUi();

// Autosave entry point used by the modal shell. It persists every visual,
// audio and general preference without stopping an active microphone test or
// closing Settings.
window.voiceupAutoSaveSettings = async function voiceupAutoSaveSettings() {
  applyChatStyle(document.querySelector('#chat-style-select')?.value);
  document.documentElement.style.removeProperty('--focus');
  updateMicThresholdUi();
  micMonitorEnabled = Boolean(micMonitorToggle?.checked);
  themeBeforeSettings = null;
  volumeBeforeSettings = null;
  applyInputVolume();
  applyOutputMute();
  saveProfile();
  await window.voiceupCommitSettings?.({ close: false, notify: false });
};

// Keep visible labels text-only and draw every action/source with SVG. This
// avoids Windows fallback glyphs and emoji encoding differences.
const settingsSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>';
if (settingsButton) { settingsButton.innerHTML = settingsSvg; settingsButton.dataset.betaIcon = 'ready'; }
document.querySelectorAll('#language-select option').forEach((option) => { option.textContent = option.textContent.replace(/^\p{Regional_Indicator}{2}\s*/u, ''); });
document.head.insertAdjacentHTML('beforeend', `<style>
.inline-icon,.channel-label svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}.channel-label{display:flex;align-items:center;gap:7px}.self-media-state #settings-button::before{content:none!important}.self-media-state #settings-button svg{width:17px;height:17px}.capture-group{display:grid;gap:10px;margin:16px 0 20px}.capture-group h3{display:flex;align-items:center;gap:8px;margin:0;color:var(--ink);font-size:14px}.capture-group h3 svg,.capture-source-copy b svg,.capture-source-empty svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.capture-group h3 small{margin-left:auto;color:var(--muted);font-weight:600}.capture-group-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.capture-source-copy b{display:flex;align-items:center;gap:7px}.capture-source-empty{display:grid!important;place-items:center;align-content:center;gap:6px;color:var(--muted);font-size:11px}.capture-source.unavailable{opacity:.58;cursor:not-allowed}.capture-source.unavailable:hover{transform:none}.capture-source.unavailable .capture-source-preview{background:color-mix(in srgb,var(--night) 82%,#000)}#mic-test-panel{display:grid;gap:11px;padding:14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--night2) 88%,var(--focus) 4%)}.mic-test-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.mic-test-heading span{font:700 12px ui-monospace,monospace;color:var(--focus)}.mic-meter{height:12px;position:relative;overflow:visible;border-radius:999px;background:color-mix(in srgb,var(--night) 75%,#000);box-shadow:inset 0 0 0 1px var(--line)}.mic-meter i{display:block;width:0;height:100%;border-radius:inherit;background:color-mix(in srgb,var(--focus) 72%,var(--line));transition:width .07s linear}.mic-meter i.above-threshold{background:#54d889}.mic-meter b{position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:2px;background:var(--coral);box-shadow:0 0 5px color-mix(in srgb,var(--coral) 70%,transparent)}#mic-test-panel label{display:grid;gap:6px;margin:0!important}#mic-test-panel input[type="range"]{width:100%;padding:0!important;accent-color:var(--focus)}#mic-test-panel .mic-monitor-option{display:flex;align-items:center;grid-template-columns:auto 1fr}.mic-test-actions{display:flex;align-items:center;gap:10px}.mic-test-actions button{padding:8px 11px;background:var(--surface-2);color:var(--ink);border:1px solid var(--line)}.mic-test-actions small{color:var(--muted);line-height:1.35}.round-control>svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}@media(max-width:520px){.capture-group-grid{grid-template-columns:1fr}.mic-test-actions{align-items:flex-start;flex-direction:column}}
</style>`);

// Beta 30 appearance, saved-server and hosted-lobby presentation layer.
document.head.insertAdjacentHTML('beforeend', `<style>
body.theme-cyber{--ink:#e6f3ff;--muted:#839ab2;--night:#050d1b;--night2:#0a1930;--line:#1e4162;--cyan:#38d9ff;--coral:#aa7cff;--focus:#38d9ff;--focus-contrast:#04151d;--beta-button-ink:var(--focus-contrast)}body.theme-cyber .sidebar{background:#071426!important}body.theme-cyber #right-panel{background:#061120!important}body.theme-cyber .content{background:radial-gradient(circle at 52% 32%,#11385c 0,#0a1930 45%,#050d1b 100%)!important}
body.theme-crimson{--ink:#fae9ed;--muted:#aa8089;--night:#17090e;--night2:#281017;--line:#58303a;--cyan:#ff6680;--coral:#f5a45d;--focus:#ff6680;--focus-contrast:#2a080f;--beta-button-ink:var(--focus-contrast)}body.theme-crimson .sidebar{background:#12070b!important}body.theme-crimson #right-panel{background:#1b0a10!important}body.theme-crimson .content{background:radial-gradient(circle at 52% 32%,#55202d 0,#281017 46%,#17090e 100%)!important}
body.theme-obsidian{--ink:#e5efeb;--muted:#879992;--night:#101414;--night2:#18201f;--line:#354640;--cyan:#6bd6b0;--coral:#c8a96a;--focus:#6bd6b0;--focus-contrast:#10251e;--beta-button-ink:var(--focus-contrast)}body.theme-obsidian .sidebar{background:#0c1111!important}body.theme-obsidian #right-panel{background:#111817!important}body.theme-obsidian .content{background:radial-gradient(circle at 52% 32%,#263a35 0,#18201f 47%,#101414 100%)!important}
body.theme-cobalt{--ink:#e8efff;--muted:#8899ba;--night:#081326;--night2:#102449;--line:#294a78;--cyan:#6da7ff;--coral:#ff9a61;--focus:#6da7ff;--focus-contrast:#07162d;--beta-button-ink:var(--focus-contrast)}body.theme-cobalt .sidebar{background:#081a35!important}body.theme-cobalt #right-panel{background:#09182f!important}body.theme-cobalt .content{background:radial-gradient(circle at 52% 32%,#204d8b 0,#102449 46%,#081326 100%)!important}
body.theme-snow{--ink:#15283a;--muted:#566f86;--night:#c7d7e7;--night2:#d9e4ef;--line:#9eb5ca;--cyan:#197d8c;--coral:#c95872;--focus:#197d8c;--focus-contrast:#fff;--beta-button-ink:#fff}body.theme-snow .sidebar{background:#b9ccdf!important}body.theme-snow #right-panel{background:#c2d3e3!important}body.theme-snow .content{background:radial-gradient(circle at 52% 32%,#bfd8ea 0,#d9e4ef 54%,#c7d7e7 100%)!important}
body.theme-lilac{--ink:#2f2142;--muted:#6d5d7f;--night:#d7c9e8;--night2:#e5d9f0;--line:#b6a4ca;--cyan:#7153ad;--coral:#c9588a;--focus:#7153ad;--focus-contrast:#fff;--beta-button-ink:#fff}body.theme-lilac .sidebar{background:#cbbadc!important}body.theme-lilac #right-panel{background:#d3c4e2!important}body.theme-lilac .content{background:radial-gradient(circle at 52% 32%,#d3bfe7 0,#e5d9f0 54%,#d7c9e8 100%)!important}
body.theme-sage{--ink:#21342d;--muted:#5c7168;--night:#c8d9c8;--night2:#d9e5d5;--line:#9fb9a5;--cyan:#2c765e;--coral:#c46758;--focus:#2c765e;--focus-contrast:#fff;--beta-button-ink:#fff}body.theme-sage .sidebar{background:#b9cfbd!important}body.theme-sage #right-panel{background:#c5d8c5!important}body.theme-sage .content{background:radial-gradient(circle at 52% 32%,#c3ddc5 0,#d9e5d5 54%,#c8d9c8 100%)!important}
body.theme-peach{--ink:#422a31;--muted:#785f67;--night:#e4c8be;--night2:#eed9d1;--line:#c9a79e;--cyan:#a64f67;--coral:#c96542;--focus:#a64f67;--focus-contrast:#fff;--beta-button-ink:#fff}body.theme-peach .sidebar{background:#d9b9ae!important}body.theme-peach #right-panel{background:#e1c5ba!important}body.theme-peach .content{background:radial-gradient(circle at 52% 32%,#e8c6b9 0,#eed9d1 54%,#e4c8be 100%)!important}
body.theme-mist{--ink:#233348;--muted:#5d6e82;--night:#c8d1dc;--night2:#d9e0e8;--line:#a4b1c0;--cyan:#426e9d;--coral:#aa6077;--focus:#426e9d;--focus-contrast:#fff;--beta-button-ink:#fff}body.theme-mist .sidebar{background:#bbc6d2!important}body.theme-mist #right-panel{background:#c5cfda!important}body.theme-mist .content{background:radial-gradient(circle at 52% 32%,#c2d2e2 0,#d9e0e8 54%,#c8d1dc 100%)!important}
body.theme-snow,body.theme-lilac,body.theme-sage,body.theme-peach,body.theme-mist{--panel:color-mix(in srgb,var(--night) 88%,var(--night2));--surface:color-mix(in srgb,var(--night2) 82%,#fff 8%);--surface-2:color-mix(in srgb,var(--night) 72%,var(--night2))}body.theme-snow .video-frame,body.theme-lilac .video-frame,body.theme-sage .video-frame,body.theme-peach .video-frame,body.theme-mist .video-frame{background:#26313f!important}
#settings-tabs{flex-wrap:wrap}.appearance-options{display:grid;gap:12px;padding:14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--surface) 76%,transparent)}.appearance-options-heading{display:grid;gap:3px}.appearance-options-heading small{color:var(--muted);font-size:11px}.appearance-options-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.appearance-options-grid label{display:grid;gap:6px;font-size:12px}.appearance-effects{display:flex!important;align-items:center;gap:8px!important;font-weight:600}.appearance-effects input{width:auto!important}.settings-panel[data-settings-panel="appearance"]>#theme-samples{order:2}.settings-panel[data-settings-panel="appearance"]>#appearance-options{order:3}
body[data-interface-density="compact"] .room-channel{padding-block:6px!important}body[data-interface-density="compact"] .participant,body[data-interface-density="compact"] .members-clone .participant{padding-block:6px}body[data-interface-density="compact"] .messages{gap:3px!important;padding-block:9px!important}body[data-interface-density="compact"] .message{padding-block:5px!important}body[data-interface-density="compact"] .self-card{padding-block:10px 7px}
body[data-font-scale="small"] .room-channel,body[data-font-scale="small"] .participant,body[data-font-scale="small"] .message-text,body[data-font-scale="small"] #settings-modal label{font-size:11px!important}body[data-font-scale="large"] .room-channel,body[data-font-scale="large"] .participant,body[data-font-scale="large"] .message-text,body[data-font-scale="large"] #settings-modal label{font-size:15px!important}body[data-font-scale="large"] .message .author{font-size:11px!important}
body[data-panel-width="narrow"] .app{grid-template-columns:270px minmax(420px,1fr) 280px}body[data-panel-width="wide"] .app{grid-template-columns:270px minmax(420px,1fr) 370px}body[data-motion="reduced"] *,body[data-motion="reduced"] *::before,body[data-motion="reduced"] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}body[data-effects="off"] .welcome,body[data-effects="off"] .content{background:var(--night2)!important}body[data-effects="off"] .welcome::before,body[data-effects="off"] .card-glow{display:none!important}body[data-effects="off"] #settings-modal,body[data-effects="off"] .participant-audio-popover{backdrop-filter:none!important}body[data-effects="off"] .call-member.speaking .avatar{box-shadow:0 0 0 5px color-mix(in srgb,var(--focus) 26%,transparent)!important}
#server-lobby{display:none;min-width:0;min-height:0;text-align:left}body.server-lobby-mode .content{grid-template-rows:61px minmax(0,1fr)!important;min-height:0!important;overflow:hidden!important}body.server-lobby-mode .control-dock{display:none!important}body.server-lobby-mode .stage{align-self:stretch!important;width:100%!important;height:100%!important;min-height:0!important;padding:0!important;overflow:hidden!important}body.server-lobby-mode .stage>#identity-stage,body.server-lobby-mode .stage>#video-frame,body.server-lobby-mode .stage>#local-video,body.server-lobby-mode .stage>#pair-panel{display:none!important}body.server-lobby-mode #server-lobby{contain:layout size;width:100%!important;max-width:none!important;height:100%!important;min-height:0;margin:0!important;display:grid;grid-template-rows:62px minmax(0,1fr);overflow:hidden!important;border:0;border-radius:0;background:color-mix(in srgb,var(--night2) 92%,var(--focus) 2%);box-shadow:none}#server-lobby>header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:0 24px!important;background:color-mix(in srgb,var(--night) 55%,transparent)!important;border-bottom:1px solid var(--line)!important}#server-lobby>header .eyebrow{display:block!important;margin:0 0 2px!important;font-size:8px!important;color:var(--focus)!important}#server-lobby>header h2{margin:0!important;font-size:18px!important}#server-lobby>header>small{color:var(--muted);font-size:11px}#server-lobby-chat-slot{display:grid!important;width:100%;height:100%;min-height:0;overflow:hidden!important}#server-lobby #chat-panel{contain:layout;display:grid!important;width:100%!important;height:100%!important;max-height:100%!important;min-height:0!important;align-self:stretch!important;overflow:hidden!important;grid-template-rows:minmax(0,1fr) auto 64px!important}#server-lobby #messages{grid-row:1;width:100%!important;height:100%!important;max-height:100%!important;min-height:0!important;padding:20px 24px!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;align-content:flex-start}#server-lobby #messages>.message{flex:0 0 auto!important;min-height:min-content;max-width:min(760px,92%)!important}#server-lobby #messages>.system-message{flex:0 0 auto}#server-lobby .typing-indicator{grid-row:2;flex:none}#server-lobby #message-form{grid-row:3!important;align-self:stretch!important;min-height:64px!important;max-height:64px!important;display:flex;gap:9px;padding:10px 18px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--night) 55%,transparent)}#server-lobby #message-input{width:100%;min-width:0;padding:11px 14px;border:1px solid var(--line);border-radius:9px;outline:none;background:var(--surface);color:var(--ink)}#server-lobby #message-input:focus{border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 17%,transparent)}#server-lobby #message-form>button{flex:0 0 44px;width:44px;border-radius:9px;background:var(--focus);color:var(--focus-contrast)}body.server-lobby-mode #right-panel>.panel-tabs{grid-template-columns:1fr}body.server-lobby-mode #right-panel [data-panel="chat"]{display:none}body.server-lobby-mode #members-panel{display:grid!important}
.host-name-label{display:grid;gap:7px;font-size:12px;font-weight:600;color:var(--muted)}.saved-servers{display:grid;gap:10px;margin-top:4px;padding:12px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--surface) 70%,transparent)}.saved-servers-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.saved-servers-heading>div:first-child{display:grid;gap:2px}.saved-servers-heading small{color:var(--muted);font-size:10px}.saved-servers-actions{display:flex!important;align-items:center;gap:6px!important}.saved-servers-actions>button{min-height:34px!important;margin:0!important;padding:7px 10px!important;display:block!important;background:var(--surface-2)!important;color:var(--ink)!important;border:1px solid var(--line)!important}.saved-servers-actions>#save-current-server{background:var(--focus)!important;color:var(--focus-contrast)!important;border-color:transparent!important}.saved-servers-list{display:grid;gap:6px;max-height:186px;overflow:auto}.saved-servers-list>p{margin:3px;color:var(--muted);font-size:11px;line-height:1.45}.saved-server{display:grid;grid-template-columns:minmax(0,1fr) 31px;align-items:center;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.saved-server.selected{border-color:var(--focus);box-shadow:0 0 0 2px color-mix(in srgb,var(--focus) 14%,transparent)}.saved-server-open{min-width:0!important;min-height:50px!important;margin:0!important;padding:7px 9px!important;display:grid!important;grid-template-columns:34px minmax(0,1fr)!important;align-items:center!important;justify-content:initial!important;gap:9px!important;text-align:left!important;background:transparent!important;color:var(--ink)!important}.saved-server-open>span:last-child{display:grid;gap:2px;min-width:0}.saved-server-open strong,.saved-server-open small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.saved-server-open strong{font-size:12px}.saved-server-open small{color:var(--muted);font-size:9px}.saved-server-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--focus) 12%,var(--night2));color:var(--focus)}.saved-server-icon svg,.saved-server-remove svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.saved-server-remove{width:28px!important;height:28px!important;margin:0!important;padding:0!important;display:grid!important;place-items:center!important;background:transparent!important;color:var(--muted)!important}.saved-server-remove:hover{color:var(--coral)!important;background:color-mix(in srgb,var(--coral) 10%,transparent)!important}
@media(max-width:1280px){body[data-panel-width="narrow"] .app,body[data-panel-width="normal"] .app,body[data-panel-width="wide"] .app{grid-template-columns:224px minmax(380px,1fr) 276px}}@media(max-width:980px){body[data-panel-width] .app{grid-template-columns:218px minmax(0,1fr)}body.server-lobby-mode .content{grid-row:1!important}#server-lobby>header>small{display:none}}@media(max-width:700px){.appearance-options-grid{grid-template-columns:1fr}body.server-lobby-mode .content{grid-row:2!important}body.server-lobby-mode #right-panel{display:grid!important}body.server-lobby-mode .app{grid-template-rows:auto minmax(520px,72dvh) 250px}body.server-lobby-mode #right-panel{grid-row:3!important;height:250px!important;min-height:250px!important;max-height:250px!important}}@media(max-width:520px){#settings-tabs{display:grid;grid-template-columns:1fr 1fr;width:100%}.settings-tab{min-width:0}.saved-servers-heading{align-items:stretch;flex-direction:column}.saved-servers-actions{width:100%}.saved-servers-actions>button{flex:1}}
</style>`);
