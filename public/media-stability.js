/*
 * Final stability layer for 1.1.2 beta.
 * It intentionally only owns media chrome, the channel list viewport and the
 * audio sender recovery path. Keeping it separate prevents UI changes from
 * touching the established hosted/manual negotiation code.
 */
(() => {
  'use strict';

  const svg = {
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/></svg>',
    screen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  };

  document.head.insertAdjacentHTML('beforeend', `<style id="media-stability-style">
    /* Fullscreen must own the entire Electron viewport. */
    body.video-theater{overflow:hidden!important;background:#05070d!important}
    body.video-theater #app.app{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;min-height:0!important;overflow:hidden!important;background:#05070d!important}
    body.video-theater .content{display:block!important;position:static!important;width:100%!important;height:100%!important;min-height:0!important;border:0!important;background:#05070d!important}
    body.video-theater .content>.control-dock,body.video-theater .control-dock{display:none!important}
    body.video-theater #video-frame{display:block!important;position:fixed!important;inset:0!important;z-index:90!important;width:100vw!important;height:100dvh!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;aspect-ratio:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#05070d!important}
    body.video-theater #video-gallery{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-height:0!important;padding:10px!important;gap:10px!important;overflow:hidden!important}
    body.video-theater .video-tile{min-width:0!important;min-height:0!important;border-radius:10px!important}
    body.video-theater .video-tile video{width:100%!important;height:100%!important;object-fit:contain!important}
    body.video-theater #local-video{position:fixed!important;z-index:102!important;right:20px!important;bottom:76px!important;top:auto!important;max-width:28vw!important;max-height:24vh!important}
    body.video-theater #fullscreen-button{display:none!important}
    #fullscreen-button{position:absolute!important;z-index:18!important;right:13px!important;bottom:13px!important;top:auto!important;display:grid!important;place-items:center!important;border:1px solid color-mix(in srgb,var(--focus) 52%,#fff)!important;border-radius:9px!important;background:rgba(7,13,23,.92)!important;color:#f7fbff!important;box-shadow:0 7px 18px rgba(0,0,0,.34)!important}
    #fullscreen-button:hover{background:var(--focus)!important;color:var(--focus-contrast,#071018)!important}
    #fullscreen-button svg{width:18px!important;height:18px!important;display:block!important;fill:none!important;stroke:currentColor!important;stroke-width:2.15!important;stroke-linecap:round!important;stroke-linejoin:round!important}
    #video-theater-toolbar{position:fixed;z-index:2147483647;top:max(14px,env(safe-area-inset-top));right:max(16px,env(safe-area-inset-right));display:none;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.2);border-radius:13px;background:rgba(8,12,20,.86);box-shadow:0 12px 34px rgba(0,0,0,.38);backdrop-filter:blur(14px)}
    body.video-theater #video-theater-toolbar{display:flex}
    #video-theater-toolbar button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 11px;border:1px solid rgba(255,255,255,.16);border-radius:9px;background:#1b2940;color:#f5f8ff;font:700 12px/1 'DM Sans',sans-serif;white-space:nowrap}
    #video-theater-toolbar button:hover{border-color:var(--focus);background:#263a58}
    #video-theater-toolbar .theater-stop-share{background:#ad4050;color:#fff;border-color:#d96272}
    #video-theater-toolbar .theater-stop-share:hover{background:#c54b5c;border-color:#ff9ba7}
    #video-theater-toolbar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

    /* Make the channel list a real independent viewport when a server has many channels. */
    @media (min-width:701px){
      .sidebar{min-height:0!important;overflow:hidden!important}
      .sidebar>#room-channels{flex:1 1 auto!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 4px 8px 0!important;margin-right:-4px!important}
      .sidebar>#participants{flex:0 1 auto;max-height:22vh;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain}
      .sidebar>.self-card,.sidebar>.sidebar-actions{flex:0 0 auto}
    }

    /* Theme-safe textual hierarchy, including the light palettes. */
    .content>header h2,.room-name,.room-name span,.room-label,.participant-heading,.room-channels h3,.room-channel,.call-status,.stage h1,.stage h2,.stage p,.video-tile-label,.video-label{color:var(--ink)!important}
    .content>header .eyebrow,.room-label,.participant-heading,.room-channels h3{color:var(--focus)!important}
    .call-status,.stage p,.room-channel:not(.active){color:var(--muted)!important}
    .room-channel.active{color:var(--focus)!important}
    body.theme-snow .video-tile-label,body.theme-lilac .video-tile-label,body.theme-sage .video-tile-label,body.theme-peach .video-tile-label,body.theme-mist .video-tile-label{color:#f7fbff!important;background:rgba(10,18,30,.8)!important}
    @media (max-width:700px){#video-theater-toolbar{left:12px;right:12px;justify-content:stretch}#video-theater-toolbar button{flex:1;min-width:0;font-size:11px}body.video-theater #local-video{right:12px!important;bottom:68px!important;max-width:38vw!important;max-height:22vh!important}}
  </style>`);

  const frame = document.querySelector('#video-frame');
  const fullscreenButton = document.querySelector('#fullscreen-button');
  if (!frame || !fullscreenButton) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'video-theater-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Controles da transmissão');
  toolbar.innerHTML = `<button type="button" class="theater-exit" title="Sair da tela cheia">${svg.shrink}<span>Sair da tela cheia</span></button><button type="button" class="theater-stop-share" title="Encerrar transmissão">${svg.screen}<span>Encerrar transmissão</span></button>`;
  document.body.append(toolbar);
  const exitButton = toolbar.querySelector('.theater-exit');
  const stopButton = toolbar.querySelector('.theater-stop-share');

  const hasScreen = () => Boolean(screenStream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
  const viewedScreenTile = () => [...document.querySelectorAll('#video-gallery .video-tile:not(.hidden)')]
    .find((tile) => tile.dataset.mediaKind === 'screen') || null;
  const hideViewedScreen = () => {
    const tile = viewedScreenTile();
    if (!tile) return false;
    const owner = tile.dataset.mediaOwner || '';
    const target = owner === 'manual-peer' ? peer : hostedPeers?.get?.(owner);
    if (target) {
      target.mediaViewKinds ||= { camera: true, screen: false };
      target.mediaViewKinds.screen = false;
    }
    const tileId = owner === 'manual-peer' ? 'manual-screen' : (owner ? `${owner}-screen` : tile.dataset.videoPeer);
    if (tileId) hideVideoTile?.(tileId);
    renderIncomingMediaOffers?.();
    return true;
  };
  const syncToolbar = () => {
    const isTheater = document.body.classList.contains('video-theater');
    fullscreenButton.title = isTheater ? 'Sair da tela cheia' : 'Abrir live em tela cheia';
    fullscreenButton.innerHTML = isTheater ? svg.shrink : svg.expand;
    const localShare = hasScreen();
    const remoteShare = !localShare && Boolean(viewedScreenTile());
    stopButton.hidden = !localShare && !remoteShare;
    if (localShare) {
      stopButton.innerHTML = `${svg.screen}<span>Encerrar transmissão</span>`;
      stopButton.title = 'Encerrar minha transmissão';
    } else if (remoteShare) {
      stopButton.innerHTML = `${svg.close}<span>Sair da live</span>`;
      stopButton.title = 'Parar de assistir a esta transmissão';
    }
    exitButton.innerHTML = `${isTheater ? svg.shrink : svg.expand}<span>${isTheater ? 'Sair da tela cheia' : 'Tela cheia'}</span>`;
  };

  const leaveTheater = async () => {
    document.body.classList.remove('video-theater');
    try {
      if (window.voiceupDesktop?.setVideoFullscreen) await window.voiceupDesktop.setVideoFullscreen(false);
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* The embedded layout is already restored. */ }
    syncToolbar();
  };
  const enterTheater = async () => {
    document.body.classList.add('video-theater');
    try {
      if (window.voiceupDesktop?.setVideoFullscreen) await window.voiceupDesktop.setVideoFullscreen(true);
      else await frame.requestFullscreen?.();
    } catch { toast?.('Modo tela cheia ativado dentro do aplicativo.'); }
    syncToolbar();
  };

  // Capture phase replaces the older listener so a single click cannot leave
  // Electron and the page in conflicting fullscreen states.
  fullscreenButton.addEventListener('click', (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    void (document.body.classList.contains('video-theater') ? leaveTheater() : enterTheater());
  }, true);
  exitButton.addEventListener('click', () => void leaveTheater());
  stopButton.addEventListener('click', async () => {
    if (hasScreen()) await stopScreenShare?.();
    else hideViewedScreen();
    await leaveTheater();
    syncToolbar();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !window.voiceupDesktop) document.body.classList.remove('video-theater');
    syncToolbar();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !document.body.classList.contains('video-theater')) return;
    event.preventDefault(); event.stopImmediatePropagation(); void leaveTheater();
  }, true);
  const gallery = document.querySelector('#video-gallery');
  if (gallery) new MutationObserver(() => {
    if (document.body.classList.contains('video-theater')) syncToolbar();
  }).observe(gallery, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-media-kind', 'data-media-owner'] });

  // A camera/screen change must never leave an old or stopped microphone
  // attached to a peer. This recovery is deliberately sender-only: it does not
  // reopen or renegotiate a working video stream.
  let audioRecoveryTimer = 0;
  let audioRecoveryRunning = Promise.resolve();
  const currentMicTrack = () => localStream?.getAudioTracks?.().find((track) => track.readyState === 'live') || null;
  const stabilizeOutgoingAudio = async () => {
    let micTrack = currentMicTrack();
    if (!micTrack) {
      try { await requestAudio?.(); } catch { /* Permission feedback is handled by requestAudio. */ }
      micTrack = currentMicTrack();
    }
    let outgoing = null;
    try { outgoing = outgoingAudioTrack?.() || micTrack; } catch { outgoing = micTrack; }
    if (!outgoing || outgoing.readyState === 'ended') return;
    outgoing.enabled = Boolean(micEnabled && (currentMode !== 'hosted' || activeVoiceChannel));
    const senders = typeof audioSenders === 'function' ? audioSenders() : [];
    await Promise.allSettled(senders.filter(Boolean).map((sender) => sender.track === outgoing ? Promise.resolve() : sender.replaceTrack(outgoing)));
  };
  const queueAudioRecovery = () => {
    clearTimeout(audioRecoveryTimer);
    const run = () => { audioRecoveryRunning = audioRecoveryRunning.catch(() => {}).then(stabilizeOutgoingAudio).catch(() => {}); };
    run();
    audioRecoveryTimer = setTimeout(run, 420);
    setTimeout(run, 1250);
  };
  const wrapMediaAction = (name) => {
    const original = globalThis[name];
    if (typeof original !== 'function' || original.__voiceupAudioSafe) return;
    const wrapped = async function voiceupAudioSafeMediaAction(...args) {
      try { return await original.apply(this, args); }
      finally { queueAudioRecovery(); syncToolbar(); }
    };
    wrapped.__voiceupAudioSafe = true;
    globalThis[name] = wrapped;
  };
  ['startCamera', 'stopCamera', 'shareScreen', 'stopScreenShare', 'stopVideo', 'startSharedSystemAudio', 'stopSharedSystemAudio', 'replaceMicrophone'].forEach(wrapMediaAction);
  syncToolbar();
})();
