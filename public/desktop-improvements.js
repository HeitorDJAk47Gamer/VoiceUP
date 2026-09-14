/* Desktop beta: viewer-specific quality and accessible settings. */
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const quality = window.voiceupViewerQuality;
  const tuneQueues = new WeakMap();
  const tune = tuneVideoSender;
  tuneVideoSender = function (sender, kind) {
    if (!sender) return Promise.resolve(false);
    const job = (tuneQueues.get(sender) || Promise.resolve()).catch(() => {}).then(() => tune(sender, kind));
    tuneQueues.set(sender, job);
    void job.finally(() => { if (tuneQueues.get(sender) === job) tuneQueues.delete(sender); }).catch(() => {});
    return job;
  };
  const requests = new WeakMap();
  const resumeViews = new Map();
  const viewKey = (p) => {
    const identity = serverMembers.get(p?.id)?.clientId || p?.clientId;
    return identity ? `${byId('host-url')?.value}|${byId('host-room')?.value}|${identity}` : '';
  };
  const clearVoice = clearHostedVoice;
  clearHostedVoice = function (...args) {
    if (hostedSocket?.__voiceupWasDisconnected && !hostedSocket.__voiceupReconnectCancelled) {
      hostedPeers.forEach((p) => {
        const key = viewKey(p);
        if (key) resumeViews.set(key, { viewing: Boolean(mediaViewState(p).screen), quality: p.viewerQuality, expires: Date.now() + 60000 });
      });
    }
    return clearVoice(...args);
  };
  function resumeView(p) {
    const key = viewKey(p), saved = resumeViews.get(key);
    if (!saved) return;
    if (saved.expires < Date.now()) { resumeViews.delete(key); return; }
    p.viewerQuality = saved.quality;
    if (saved.viewing && p.videoExpectedKinds?.screen) { resumeViews.delete(key); setParticipantScreenView(p, true); }
  }
  const send = (p, message) => { if (p?.channel?.readyState === 'open') p.channel.send(JSON.stringify(message)); };
  function requestQuality(p) {
    if (!p?.viewerQuality) return;
    send(p, { type: 'viewer-quality', value: p.viewerQuality, request: ++p.viewerQualityRequest || (p.viewerQualityRequest = 1) });
    p.viewerQualityStatus = 'Solicitando…';
    const request = p.viewerQualityRequest;
    setTimeout(() => {
      if (p.viewerQualityRequest !== request || p.viewerQualityStatus !== 'Solicitando…') return;
      p.viewerQualityStatus = 'Sem confirmação: transmissor antigo ou indisponível';
      refreshQualityStatus(p);
    }, 5000);
  }
  function refreshQualityStatus(p) {
    const owner = p === peer ? 'manual-peer' : String(p?.id || '');
    document.querySelectorAll('[data-viewer-quality-status]').forEach((node) => {
      if (node.closest('[data-media-owner]')?.dataset.mediaOwner === owner) node.title = p.viewerQualityStatus || 'Máximo do transmissor';
    });
  }
  async function receiveQuality(p, raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return false; }
    if (message.type === 'viewer-quality-result') {
      if (message.request === p?.viewerQualityRequest) {
        p.viewerQualityStatus = message.ok ? 'Limite aplicado · depende da fonte e da rede' : 'Não foi possível aplicar agora';
        refreshQualityStatus(p);
      }
      return true;
    }
    if (message.type !== 'viewer-quality') return false;
    if (!p || p.left || quality.normalize(message.value) === null || !Number.isSafeInteger(message.request) || message.request < 1 || message.request > 1000000000) return true;
    // Bound remote work and serialize changes on this sender.
    if (requests.get(p)) return true;
    requests.set(p, true);
    try {
      const sender = p.screenSender;
      if (!sender || sender.track !== betaActiveVideoTrack('screen')) {
        send(p, { type: 'viewer-quality-result', request: message.request, ok: false }); return true;
      }
      const previous = quality.senders.get(sender);
      quality.senders.set(sender, message.value);
      const ok = await tuneVideoSender(sender, 'screen');
      if (!ok) { if (previous) quality.senders.set(sender, previous); else quality.senders.delete(sender); }
      send(p, { type: 'viewer-quality-result', request: message.request, ok: Boolean(ok) });
    } finally { setTimeout(() => requests.delete(p), 250); }
    return true;
  }
  const hostedReceive = receiveHostedData;
  receiveHostedData = async (p, raw) => {
    if (await receiveQuality(p, raw)) return;
    const result = await hostedReceive(p, raw); resumeView(p); return result;
  };
  const manualReceive = receiveData;
  receiveData = async (raw) => { if (!(await receiveQuality(peer, raw))) return manualReceive(raw); };
  const decorate = decorateRemoteMediaTile;
  decorateRemoteMediaTile = function (id, kind, p) {
    decorate(id, kind, p);
    if (kind !== 'screen' || !p) return;
    const tile = videoGallery.querySelector(`[data-video-peer="${videoTileId(id)}"]`);
    const controls = tile?.querySelector('.media-tile-controls');
    if (!controls) return;
    const label = document.createElement('label');
    label.className = 'viewer-quality-control';
    label.innerHTML = '<select data-viewer-quality-status aria-label="Qualidade somente para você"><option value="auto">Máximo / automático</option><option value="360">Até 360p · 30 FPS</option><option value="480">Até 480p · 30 FPS</option><option value="720">Até 720p · 30 FPS</option><option value="1080">Até 1080p · 30 FPS</option></select>';
    const select = label.querySelector('select');
    select.value = p.viewerQuality || 'auto';
    select.onchange = () => { p.viewerQuality = select.value; requestQuality(p); refreshQualityStatus(p); };
    controls.prepend(label);
    refreshQualityStatus(p);
  };
  // Reapply the preference when a live restarts, not on every tile render.
  const screenView = setParticipantScreenView;
  setParticipantScreenView = function (p, viewing, ...args) {
    const result = screenView(p, viewing, ...args);
    if (viewing) requestQuality(p);
    return result;
  };
  window.voiceupViewerControls = { requestQuality, receiveQuality };

  // Retry ICE only for hosted calls, where the signalling path can carry the
  // new offer. The deterministic initiator avoids simultaneous restart offers.
  const makeConnection = makeHostedConnection;
  makeHostedConnection = function (p, ...args) {
    const pc = makeConnection(p, ...args);
    let timer = null, attempts = 0;
    const valid = () => !p.left && p.pc === pc && hostedPeers.get(p.id) === p && hostedSocket?.connected;
    const retry = async () => {
      timer = null;
      if (!valid() || !['failed', 'disconnected'].includes(pc.connectionState) || attempts >= 3) return;
      if (p.makingOffer || pc.signalingState !== 'stable') { timer = setTimeout(retry, 5000); return; }
      if (String(hostedSocket.id).localeCompare(String(p.id)) > 0) return;
      attempts++; p.makingOffer = true;
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        if (!valid()) return;
        await pc.setLocalDescription(offer);
        if (valid()) hostedSocket.emit('signal', { target: p.id, data: { description: pc.localDescription } });
      } catch { /* A later bounded retry can recover a transient failure. */ }
      finally { p.makingOffer = false; if (valid() && attempts < 3) timer = setTimeout(retry, 10000); }
    };
    pc.addEventListener('connectionstatechange', () => {
      if (['connected', 'closed'].includes(pc.connectionState)) { clearTimeout(timer); timer = null; attempts = 0; }
      else if (!timer && attempts < 3 && ['failed', 'disconnected'].includes(pc.connectionState)) timer = setTimeout(retry, 5000);
    });
    return pc;
  };

  const tabs = byId('settings-tabs'), panels = byId('settings-tab-panels');
  let accessibility;
  try { accessibility = JSON.parse(localStorage.getItem('voiceup-accessibility-v1') || '{}') || {}; } catch { accessibility = {}; }
  const apply = () => {
    document.body.classList.toggle('accessible-contrast', accessibility.contrast === true);
    document.body.classList.toggle('accessible-text', accessibility.text === true);
    document.body.classList.toggle('accessible-motion', accessibility.motion === true);
  };
  apply();
  if (tabs && panels) {
    tabs.insertAdjacentHTML('beforeend', '<button type="button" class="settings-tab" data-settings-tab="accessibility">Acessibilidade</button>');
    panels.insertAdjacentHTML('beforeend', `<div class="settings-panel" data-settings-panel="accessibility"><p>Complementa as opções da aba Aparência. As mudanças ficam salvas neste computador.</p><label><input type="checkbox" data-accessibility="text"> Texto ampliado no chat, canais e configurações</label><label><input type="checkbox" data-accessibility="contrast"> Contraste reforçado, mantendo a cor do tema</label><label><input type="checkbox" data-accessibility="motion"> Reduzir animações e transições</label><small>Use Tab para navegar, Enter ou Espaço para ativar e Escape para fechar janelas.</small></div>`);
    panels.querySelectorAll('[data-accessibility]').forEach((input) => {
      input.checked = accessibility[input.dataset.accessibility] === true;
      input.onchange = () => { accessibility[input.dataset.accessibility] = input.checked; localStorage.setItem('voiceup-accessibility-v1', JSON.stringify(accessibility)); apply(); };
    });
    tabs.querySelector('[data-settings-tab="accessibility"]').onclick = () => {
      tabs.querySelectorAll('.settings-tab').forEach((node) => node.classList.toggle('active', node.dataset.settingsTab === 'accessibility'));
      panels.querySelectorAll('.settings-panel').forEach((node) => node.classList.toggle('active', node.dataset.settingsPanel === 'accessibility'));
    };
    tabs.setAttribute('role', 'tablist');
    const syncTabs = () => tabs.querySelectorAll('.settings-tab').forEach((tab) => {
      const key = tab.dataset.settingsTab, panel = panels.querySelector(`[data-settings-panel="${key}"]`);
      tab.id ||= `settings-tab-${key}`; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      if (panel) { panel.id ||= `settings-panel-${key}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); tab.setAttribute('aria-controls', panel.id); }
    });
    syncTabs();
    tabs.addEventListener('click', () => queueMicrotask(syncTabs));
    tabs.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...tabs.querySelectorAll('.settings-tab')], index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    });
  }
  byId('toast')?.setAttribute('role', 'status');
  byId('connection-state')?.setAttribute('aria-live', 'polite');
  document.querySelectorAll('button[title]').forEach((button) => { if (!button.textContent.trim() && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title); });
  // Trap keyboard focus in visible modal overlays, and restore it on closing.
  let modal = null, previousFocus = null;
  const visible = (node) => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
  const focusable = (node) => [...node.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(visible);
  const findModal = () => [...document.querySelectorAll('[aria-modal="true"],#settings-modal')].filter(visible).pop();
  const syncModal = () => {
    const next = findModal();
    if (next === modal) return;
    if (modal && !next) { if (previousFocus?.isConnected && visible(previousFocus)) previousFocus.focus(); previousFocus = null; }
    if (next) { if (!modal) previousFocus = document.activeElement; next.setAttribute('role', 'dialog'); next.setAttribute('aria-modal', 'true'); if (!next.contains(document.activeElement)) focusable(next)[0]?.focus(); }
    modal = next;
  };
  new MutationObserver(syncModal).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !modal) return;
    const nodes = focusable(modal), first = nodes[0], last = nodes.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'desktop-improvements.css'; document.head.append(style);
})();
