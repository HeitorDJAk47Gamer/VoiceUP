/* VoiceUP 1.1.3-beta.10: interaction and workspace layer.
 * Kept separate from the WebRTC media core so the stabilized simultaneous
 * camera/screen negotiation remains untouched and easy to audit. */
(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const svg = {
    server: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h4M12 17h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 17-6-5 6-5v3h5a7 7 0 0 1 7 7v1a8 8 0 0 0-7-5H9z"/></svg>',
    reaction: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9h.01M15 9h.01"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 4 6 6-3 1-4 4v5l-2 2-2-7-6-6 2-2h5l4-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/></svg>'
  };

  /* ---------------------------------------------------------------------- */
  /* Push-to-talk and Electron global shortcuts                             */
  /* ---------------------------------------------------------------------- */
  const shortcutStorageKey = 'voiceup-shortcuts-v1';
  const shortcutDefaults = Object.freeze({
    pushToTalk: false,
    pushToTalkKey: 'Space',
    mic: 'CommandOrControl+Shift+M',
    output: 'CommandOrControl+Shift+D',
    camera: 'CommandOrControl+Shift+V',
    screen: 'CommandOrControl+Shift+S',
    leave: 'CommandOrControl+Shift+H',
    settings: 'CommandOrControl+Shift+P'
  });
  const readJson = (key, fallback) => {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { return { ...fallback }; }
  };
  let shortcutPreferences = readJson(shortcutStorageKey, shortcutDefaults);
  let pushToTalkPressed = false;
  let pushToTalkPreviousMic = false;

  const isTypingTarget = (target) => Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
  const setMicrophoneEnabled = (enabled) => {
    if (Boolean(micEnabled) === Boolean(enabled)) return;
    byId('mic-button')?.click();
  };
  const releasePushToTalk = () => {
    if (!pushToTalkPressed) return;
    pushToTalkPressed = false;
    setMicrophoneEnabled(pushToTalkPreviousMic);
    document.body.classList.remove('push-to-talk-active');
  };
  const persistShortcuts = async () => {
    localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutPreferences));
    const accelerators = Object.fromEntries(['mic', 'output', 'camera', 'screen', 'leave', 'settings']
      .map((action) => [action, String(shortcutPreferences[action] || '').trim()])
      .filter(([, accelerator]) => accelerator));
    let accepted = {};
    try { accepted = await window.voiceupDesktop?.configureShortcuts?.(accelerators) || {}; }
    catch { accepted = {}; }
    const status = byId('global-shortcut-status');
    if (status) {
      const total = Object.keys(accelerators).length;
      const active = accepted ? Object.keys(accepted).length : 0;
      status.textContent = window.voiceupDesktop?.configureShortcuts
        ? `${active} de ${total} atalhos globais ativos.`
        : 'Atalhos globais ficam disponíveis no aplicativo .exe.';
    }
  };
  const shortcutAction = (action) => {
    const target = ({ mic: 'mic-button', output: 'output-button', camera: 'cam-button', screen: 'screen-button', leave: 'leave-button', settings: 'settings-button' })[action];
    byId(target)?.click();
  };
  window.voiceupDesktop?.onShortcutAction?.(shortcutAction);
  void persistShortcuts();

  document.addEventListener('keydown', (event) => {
    if (!shortcutPreferences.pushToTalk || event.repeat || event.code !== shortcutPreferences.pushToTalkKey || isTypingTarget(event.target)) return;
    pushToTalkPressed = true;
    pushToTalkPreviousMic = Boolean(micEnabled);
    setMicrophoneEnabled(true);
    document.body.classList.add('push-to-talk-active');
    event.preventDefault();
  }, true);
  document.addEventListener('keyup', (event) => {
    if (event.code !== shortcutPreferences.pushToTalkKey) return;
    releasePushToTalk();
    event.preventDefault();
  }, true);
  window.addEventListener('blur', releasePushToTalk);

  const settingsTabs = byId('settings-tabs');
  const settingsPanels = byId('settings-tab-panels');
  if (settingsTabs && settingsPanels && !settingsTabs.querySelector('[data-settings-tab="shortcuts"]')) {
    settingsTabs.insertAdjacentHTML('beforeend', '<button type="button" class="settings-tab" data-settings-tab="shortcuts">Atalhos</button>');
    settingsPanels.insertAdjacentHTML('beforeend', `<div class="settings-panel" data-settings-panel="shortcuts">
      <section class="shortcut-settings-card">
        <div><strong>Push-to-talk</strong><small>Segure a tecla escolhida enquanto a janela do VoiceUP estiver em foco.</small></div>
        <label class="feature-switch"><input id="push-to-talk-toggle" type="checkbox"/><span></span> Ativar push-to-talk</label>
        <label>Tecla para falar<select id="push-to-talk-key"><option value="Space">Espaço</option><option value="KeyV">V</option><option value="KeyB">B</option><option value="ControlRight">Ctrl direito</option><option value="CapsLock">Caps Lock</option></select></label>
      </section>
      <section class="shortcut-settings-card">
        <div><strong>Atalhos globais</strong><small>Funcionam mesmo com o VoiceUP minimizado. Deixe vazio para desativar.</small></div>
        <div class="shortcut-grid">
          <label>Microfone<input data-global-shortcut="mic" value="${escapeHtml(shortcutPreferences.mic)}"/></label>
          <label>Áudio recebido<input data-global-shortcut="output" value="${escapeHtml(shortcutPreferences.output)}"/></label>
          <label>Câmera<input data-global-shortcut="camera" value="${escapeHtml(shortcutPreferences.camera)}"/></label>
          <label>Compartilhar tela<input data-global-shortcut="screen" value="${escapeHtml(shortcutPreferences.screen)}"/></label>
          <label>Sair da call<input data-global-shortcut="leave" value="${escapeHtml(shortcutPreferences.leave)}"/></label>
          <label>Configurações<input data-global-shortcut="settings" value="${escapeHtml(shortcutPreferences.settings)}"/></label>
        </div>
        <small id="global-shortcut-status">Preparando atalhos globais…</small>
      </section>
    </div>`);
    const pttToggle = byId('push-to-talk-toggle');
    const pttKey = byId('push-to-talk-key');
    pttToggle.checked = Boolean(shortcutPreferences.pushToTalk);
    pttKey.value = shortcutPreferences.pushToTalkKey;
    pttToggle.addEventListener('change', () => {
      shortcutPreferences.pushToTalk = pttToggle.checked;
      if (pttToggle.checked) setMicrophoneEnabled(false); else releasePushToTalk();
      void persistShortcuts();
    });
    pttKey.addEventListener('change', () => { shortcutPreferences.pushToTalkKey = pttKey.value; releasePushToTalk(); void persistShortcuts(); });
    settingsPanels.querySelectorAll('[data-global-shortcut]').forEach((input) => input.addEventListener('change', () => {
      shortcutPreferences[input.dataset.globalShortcut] = input.value.trim();
      void persistShortcuts();
    }));
    settingsTabs.querySelector('[data-settings-tab="shortcuts"]')?.addEventListener('click', () => {
      settingsTabs.querySelectorAll('.settings-tab').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === 'shortcuts'));
      settingsPanels.querySelectorAll('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === 'shortcuts'));
    });
    if (shortcutPreferences.pushToTalk) setMicrophoneEnabled(false);
  }

  /* ---------------------------------------------------------------------- */
  /* Transparent Socket.IO reconnect                                         */
  /* ---------------------------------------------------------------------- */
  const reconnectBanner = document.createElement('div');
  reconnectBanner.id = 'reconnect-banner';
  reconnectBanner.className = 'reconnect-banner hidden';
  reconnectBanner.innerHTML = '<i></i><span>Reconectando ao servidor…</span><small>voz e chat voltarão automaticamente</small>';
  document.body.append(reconnectBanner);
  const setReconnectState = (active, failed = false) => {
    document.body.classList.toggle('hosted-reconnecting', active);
    reconnectBanner.classList.toggle('hidden', !active);
    reconnectBanner.classList.toggle('failed', failed);
    reconnectBanner.querySelector('span').textContent = failed ? 'Não foi possível reconectar' : 'Reconectando ao servidor…';
    reconnectBanner.querySelector('small').textContent = failed ? 'verifique sua internet; o VoiceUP continuará tentando' : 'voz e chat voltarão automaticamente';
  };
  const bindTransparentReconnect = (socket) => {
    if (!socket || socket.__voiceupReconnectFeatures) return;
    socket.__voiceupReconnectFeatures = true;
    socket.io?.on('reconnect_attempt', () => setReconnectState(true));
    socket.io?.on('reconnect_error', () => setReconnectState(true));
    socket.io?.on('reconnect_failed', () => setReconnectState(true, true));
    socket.io?.on('reconnect', () => setReconnectState(false));
    socket.on('connect', () => setReconnectState(false));
    socket.on('disconnect', (reason) => { if (reason !== 'io client disconnect') setReconnectState(true); });
  };
  const joinHostedRoomBeforeFeatures = joinHostedRoom;
  joinHostedRoom = async function joinHostedRoomWithReconnect(...args) {
    const result = await joinHostedRoomBeforeFeatures(...args);
    bindTransparentReconnect(hostedSocket);
    return result;
  };

  /* ---------------------------------------------------------------------- */
  /* Replies, reactions, pins, editing and deletion                          */
  /* ---------------------------------------------------------------------- */
  const quickReactions = ['👍', '❤️', '😂', '🎉', '👀'];
  let replyingTo = null;
  const messageRecord = (id, channel = activeTextChannel) => (channelMessages.get(channel) || []).find((item) => String(item.id) === String(id));
  const messageRecordAnyChannel = (id) => {
    for (const [channel, records] of channelMessages) {
      const record = records.find((item) => String(item.id) === String(id));
      if (record) return { channel, record };
    }
    return null;
  };
  const removeMessageLocal = (id, channel = activeTextChannel) => {
    const records = channelMessages.get(channel) || [];
    const index = records.findIndex((item) => String(item.id) === String(id));
    if (index >= 0) records.splice(index, 1);
    if (!records.some((item) => item.mentioned)) mentionChannels.delete(channel);
    document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`)?.remove();
    if (channel === activeTextChannel && !records.length) renderChannelMessages();
    renderPinnedMessages(); renderRoomChannels(); refreshChatUnreadIndicator();
  };
  const reactionEntries = (value) => Object.entries(value && typeof value === 'object' ? value : {}).filter(([, actors]) => Array.isArray(actors) && actors.length);
  const replySnapshot = (record) => record ? { messageId: String(record.id || ''), name: String(record.name || '').slice(0, 24), text: String(record.text || '').slice(0, 120) } : null;
  const replyComposer = document.createElement('div');
  replyComposer.id = 'reply-composer'; replyComposer.className = 'reply-composer hidden';
  replyComposer.innerHTML = `<span>${svg.reply}</span><div><small>Respondendo a</small><strong></strong><p></p></div><button type="button" aria-label="Cancelar resposta">×</button>`;
  byId('message-form')?.before(replyComposer);
  const clearReply = () => { replyingTo = null; replyComposer.classList.add('hidden'); };
  replyComposer.querySelector('button').addEventListener('click', clearReply);
  const beginReply = (record) => {
    if (!record) return;
    replyingTo = replySnapshot(record);
    replyComposer.querySelector('strong').textContent = replyingTo.name;
    replyComposer.querySelector('p').textContent = replyingTo.text;
    replyComposer.classList.remove('hidden');
    byId('message-input')?.focus();
  };

  const decorateMessage = (element, details = {}) => {
    if (!element || element.dataset.featureDecorated === 'true') return;
    element.dataset.featureDecorated = 'true';
    const id = String(details.id || element.dataset.messageId || '');
    if (!id) return;
    if (details.reply?.messageId) {
      const preview = document.createElement('button');
      preview.type = 'button'; preview.className = 'message-reply-preview';
      preview.innerHTML = `${svg.reply}<span><b>${escapeHtml(details.reply.name || 'Mensagem')}</b><small>${escapeHtml(details.reply.text || '')}</small></span>`;
      preview.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(String(details.reply.messageId))}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      element.querySelector('.message-body')?.prepend(preview);
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'message-action-toolbar';
    toolbar.innerHTML = `<button type="button" data-message-action="reply" title="Responder">${svg.reply}</button><button type="button" data-message-action="react" title="Adicionar reação">${svg.reaction}</button><button type="button" data-message-action="pin" title="${details.pinned ? 'Desafixar' : 'Fixar'} mensagem" class="${details.pinned ? 'active' : ''}">${svg.pin}</button>${details.mine ? `<button type="button" data-message-action="delete" title="Apagar mensagem" class="danger">${svg.trash}</button>` : ''}`;
    const edit = element.querySelector('.message-edit');
    if (edit) { edit.title = 'Editar mensagem'; toolbar.insertBefore(edit, toolbar.querySelector('[data-message-action="delete"]')); }
    element.append(toolbar);
    const reactions = document.createElement('div');
    reactions.className = 'message-reactions';
    reactions.innerHTML = reactionEntries(details.reactions).map(([emoji, actors]) => `<button type="button" data-message-reaction="${escapeHtml(emoji)}" class="${actors.includes(String(currentMode === 'hosted' ? hostedSocket?.id : clientId)) || actors.includes(String(clientId)) ? 'mine' : ''}"><span>${escapeHtml(emoji)}</span><b>${actors.length}</b></button>`).join('');
    if (reactions.childElementCount) element.querySelector('.message-body')?.append(reactions);
    if (details.pinned) element.classList.add('pinned-message');
  };
  const addMessageBeforeFeatures = addMessage;
  addMessage = function addMessageWithFeatures(text, author, mine = false, color, details = {}) {
    addMessageBeforeFeatures(text, author, mine, color, details);
    const element = details.id
      ? document.querySelector(`[data-message-id="${CSS.escape(String(details.id))}"]`)
      : byId('messages')?.lastElementChild;
    decorateMessage(element, { ...details, mine });
  };
  const renderChannelMessagesBeforeFeatures = renderChannelMessages;
  renderChannelMessages = function renderChannelMessagesWithFeatures() {
    renderChannelMessagesBeforeFeatures();
    renderPinnedMessages();
  };

  const updateReactionLocal = ({ messageId: id, textChannel, reactions }) => {
    const found = messageRecordAnyChannel(id); if (!found) return;
    found.record.reactions = reactions || {};
    if ((textChannel || found.channel) === activeTextChannel) renderChannelMessages();
  };
  const updatePinLocal = ({ messageId: id, textChannel, pinned, pinnedBy }) => {
    const found = messageRecordAnyChannel(id); if (!found) return;
    found.record.pinned = Boolean(pinned); found.record.pinnedBy = pinnedBy || '';
    if ((textChannel || found.channel) === activeTextChannel) renderChannelMessages(); else renderPinnedMessages();
  };
  const applyDeleteLocal = ({ messageId: id, textChannel }) => {
    const found = messageRecordAnyChannel(id); removeMessageLocal(id, textChannel || found?.channel || activeTextChannel);
  };
  const receiveHostedTextBeforeFeatures = receiveHostedText;
  receiveHostedText = function receiveHostedTextWithFeatures(packet = {}) {
    const channel = ROOM_CHANNELS.text.includes(packet.textChannel) ? packet.textChannel : 'geral';
    const id = String(packet.messageId || '');
    if (id && messageRecordAnyChannel(id)) return;
    const mine = packet.from === hostedSocket?.id || (packet.authorClientId && packet.authorClientId === clientId);
    const mentionIds = Array.isArray(packet.mentions) ? packet.mentions.map(String) : [];
    const stableMentionIds = Array.isArray(packet.mentionClientIds) ? packet.mentionClientIds.map(String) : [];
    const mentioned = !mine && isMentionedForCurrentUser(mentionIds, stableMentionIds);
    const message = {
      id, text: String(packet.text || '').slice(0, 500), name: packet.name || 'Participante', color: packet.color,
      avatar: packet.avatar || serverMembers.get(packet.from)?.avatar || '', createdAt: Number(packet.createdAt) || Date.now(),
      editedAt: Number(packet.editedAt) || 0, mentions: mentionIds, mentionClientIds: stableMentionIds, mentioned,
      mine, reply: packet.reply || null, reactions: packet.reactions || {}, pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '', authorClientId: packet.authorClientId || ''
    };
    if (!channelMessages.has(channel)) channelMessages.set(channel, []);
    channelMessages.get(channel).push(message);
    registerIncomingChannelActivity(channel, mentioned);
    if (channel === activeTextChannel) addMessage(message.text, message.name, message.mine, message.color, message);
    if (!mine) playNotification(mentioned ? 'mention' : 'message');
    renderRoomChannels(); renderPinnedMessages();
  };
  void receiveHostedTextBeforeFeatures;

  const processChatHistory = ({ messages = [] } = {}) => {
    for (const packet of messages) {
      const channel = ROOM_CHANNELS.text.includes(packet.textChannel) ? packet.textChannel : 'geral';
      if (!channelMessages.has(channel)) channelMessages.set(channel, []);
      if (packet.messageId && messageRecordAnyChannel(packet.messageId)) continue;
      const mine = Boolean(packet.authorClientId && packet.authorClientId === clientId);
      const mentionIds = Array.isArray(packet.mentions) ? packet.mentions.map(String) : [];
      const stableMentionIds = Array.isArray(packet.mentionClientIds) ? packet.mentionClientIds.map(String) : [];
      channelMessages.get(channel).push({ id: String(packet.messageId || ''), text: packet.text, name: packet.name, color: packet.color, avatar: packet.avatar || '', createdAt: Number(packet.createdAt) || Date.now(), editedAt: Number(packet.editedAt) || 0, mentions: mentionIds, mentionClientIds: stableMentionIds, mentioned: !mine && isMentionedForCurrentUser(mentionIds, stableMentionIds), mine, reply: packet.reply || null, reactions: packet.reactions || {}, pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '', authorClientId: packet.authorClientId || '' });
    }
    for (const records of channelMessages.values()) records.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    renderChannelMessages();
  };
  const bindChatSocketFeatures = (socket) => {
    if (!socket || socket.__voiceupChatFeatures) return;
    socket.__voiceupChatFeatures = true;
    socket.on('chat-history', processChatHistory);
    socket.on('message-reaction', updateReactionLocal);
    socket.on('message-pinned', updatePinLocal);
    socket.on('message-deleted', applyDeleteLocal);
  };
  const joinHostedRoomBeforeChatFeatures = joinHostedRoom;
  joinHostedRoom = async function joinHostedRoomWithChatFeatures(...args) {
    const result = await joinHostedRoomBeforeChatFeatures(...args);
    bindChatSocketFeatures(hostedSocket);
    return result;
  };

  const sendManualChatEvent = (payload) => {
    if (peer?.channel?.readyState !== 'open') return false;
    peer.channel.send(JSON.stringify(payload)); return true;
  };
  const applyManualReaction = (id, emoji, actor = clientId) => {
    const element = document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
    const found = messageRecordAnyChannel(id);
    const record = found?.record || { id, text: element?.querySelector('.message-text')?.dataset.rawText || '', name: element?.querySelector('.author')?.textContent || '', reactions: {} };
    record.reactions ||= {};
    const actors = new Set(record.reactions[emoji] || []);
    if (actors.has(String(actor))) actors.delete(String(actor)); else actors.add(String(actor));
    record.reactions[emoji] = [...actors];
    if (!record.reactions[emoji].length) delete record.reactions[emoji];
    if (found?.channel === activeTextChannel || !found) {
      if (found) renderChannelMessages();
      else {
        element?.querySelector('.message-reactions')?.remove(); element && (element.dataset.featureDecorated = '');
        decorateMessage(element, { ...record, mine: element?.classList.contains('mine') });
      }
    }
  };
  const receiveDataBeforeChatFeatures = receiveData;
  receiveData = async function receiveDataWithChatFeatures(raw) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'chat') {
        const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : [];
        const mentionClientIds = Array.isArray(msg.mentionClientIds) ? msg.mentionClientIds.map(String) : [];
        const mentioned = isMentionedForCurrentUser(mentions, mentionClientIds);
        const record = { id: msg.messageId, text: msg.text, name: msg.name || peer?.name, mine: false, color: msg.color || peer?.color, createdAt: msg.createdAt, avatar: msg.avatar || peer?.avatar, mentions, mentionClientIds, mentioned, reply: msg.reply || null, reactions: msg.reactions || {}, pinned: false };
        if (!channelMessages.has(activeTextChannel)) channelMessages.set(activeTextChannel, []);
        if (!messageRecordAnyChannel(record.id)) channelMessages.get(activeTextChannel).push(record);
        registerIncomingChannelActivity(activeTextChannel, mentioned);
        playNotification(mentioned ? 'mention' : 'message'); renderRoomChannels(); return addMessage(record.text, record.name, false, record.color, record);
      }
      if (msg.type === 'chat-reaction') return applyManualReaction(msg.messageId, msg.emoji, msg.actor || 'manual-peer');
      if (msg.type === 'chat-pin') { const found = messageRecordAnyChannel(msg.messageId); if (found) found.record.pinned = Boolean(msg.pinned); document.querySelector(`[data-message-id="${CSS.escape(String(msg.messageId || ''))}"]`)?.classList.toggle('pinned-message', Boolean(msg.pinned)); renderPinnedMessages(); return; }
      if (msg.type === 'chat-delete') { const found = messageRecordAnyChannel(msg.messageId); removeMessageLocal(msg.messageId, found?.channel || activeTextChannel); return; }
    } catch { /* delegate malformed or non-chat data */ }
    return receiveDataBeforeChatFeatures(raw);
  };
  const receiveHostedDataBeforeChatFeatures = receiveHostedData;
  receiveHostedData = function receiveHostedDataWithChatFeatures(participant, raw) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'chat') {
        const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : [];
        const mentionClientIds = Array.isArray(msg.mentionClientIds) ? msg.mentionClientIds.map(String) : [];
        const mentioned = isMentionedForCurrentUser(mentions, mentionClientIds);
        const record = { id: msg.messageId, text: msg.text, name: msg.name || participant.name, mine: false, color: msg.color || participant.color, createdAt: msg.createdAt, avatar: msg.avatar || participant.avatar, mentions, mentionClientIds, mentioned, reply: msg.reply || null, reactions: msg.reactions || {}, pinned: false };
        if (!channelMessages.has(activeTextChannel)) channelMessages.set(activeTextChannel, []);
        if (!messageRecordAnyChannel(record.id)) channelMessages.get(activeTextChannel).push(record);
        registerIncomingChannelActivity(activeTextChannel, mentioned);
        playNotification(mentioned ? 'mention' : 'message'); renderRoomChannels(); return addMessage(record.text, record.name, false, record.color, record);
      }
      if (msg.type === 'chat-reaction') return applyManualReaction(msg.messageId, msg.emoji, msg.actor || participant.id);
      if (msg.type === 'chat-pin') { const found = messageRecordAnyChannel(msg.messageId); if (found) found.record.pinned = Boolean(msg.pinned); document.querySelector(`[data-message-id="${CSS.escape(String(msg.messageId || ''))}"]`)?.classList.toggle('pinned-message', Boolean(msg.pinned)); renderPinnedMessages(); return; }
      if (msg.type === 'chat-delete') { const found = messageRecordAnyChannel(msg.messageId); removeMessageLocal(msg.messageId, found?.channel || activeTextChannel); return; }
    } catch { /* delegate */ }
    return receiveHostedDataBeforeChatFeatures(participant, raw);
  };

  byId('message-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    const input = byId('message-input'); const text = input.value.trim(); if (!text) return;
    const id = messageId(); const createdAt = Date.now(); const mentions = mentionIdsForText(text); const reply = replyingTo ? { ...replyingTo } : null;
    if (currentMode === 'hosted') {
      if (!hostedSocket?.connected) return toast('Aguarde a reconexão com o servidor.');
      hostedSocket.emit('text-message', { text, textChannel: activeTextChannel, messageId: id, createdAt, mentions, reply });
    } else {
      if (!hasActiveCall() || !sendManualChatEvent({ type: 'chat', text, name: myName, color: myColor, avatar: myAvatar, messageId: id, createdAt, mentions, reply })) return toast('A conexão ainda está sendo estabelecida.');
      const record = { id, text, name: myName, mine: true, color: myColor, createdAt, avatar: myAvatar, mentions, reply, reactions: {}, pinned: false };
      if (!channelMessages.has(activeTextChannel)) channelMessages.set(activeTextChannel, []);
      channelMessages.get(activeTextChannel).push(record); addMessage(text, myName, true, myColor, record); playNotification('message');
    }
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); clearReply();
  }, true);

  let reactionPopover = null;
  const closeReactionPopover = () => { reactionPopover?.remove(); reactionPopover = null; };
  const sendReaction = (id, emoji) => {
    if (currentMode === 'hosted') hostedSocket?.emit('react-message', { messageId: id, textChannel: activeTextChannel, emoji });
    else { sendManualChatEvent({ type: 'chat-reaction', messageId: id, emoji, actor: clientId }); applyManualReaction(id, emoji); }
  };
  const togglePin = (id) => {
    const found = messageRecordAnyChannel(id); const next = !Boolean(found?.record?.pinned || document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.classList.contains('pinned-message'));
    if (currentMode === 'hosted') hostedSocket?.emit('pin-message', { messageId: id, textChannel: found?.channel || activeTextChannel, pinned: next });
    else { sendManualChatEvent({ type: 'chat-pin', messageId: id, pinned: next }); if (found) found.record.pinned = next; document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.classList.toggle('pinned-message', next); renderPinnedMessages(); }
  };
  const deleteMessage = async (id) => {
    const choice = typeof showVoiceupDialog === 'function' ? await showVoiceupDialog({ title: 'Apagar mensagem?', message: 'A mensagem será removida para todas as pessoas com a versão atual.', detail: 'Clients antigos podem continuar exibindo a cópia que já receberam.', icon: '×', actions: [{ value: 'delete', label: 'Apagar', style: 'danger' }, { value: 'cancel', label: 'Cancelar' }] }) : (confirm('Apagar esta mensagem?') ? 'delete' : 'cancel');
    if (choice !== 'delete') return;
    const found = messageRecordAnyChannel(id);
    if (currentMode === 'hosted') hostedSocket?.emit('delete-message', { messageId: id, textChannel: found?.channel || activeTextChannel });
    else { sendManualChatEvent({ type: 'chat-delete', messageId: id }); removeMessageLocal(id, found?.channel || activeTextChannel); }
  };
  byId('messages')?.addEventListener('click', (event) => {
    const message = event.target.closest('.message[data-message-id]'); if (!message) return;
    const id = message.dataset.messageId; const action = event.target.closest('[data-message-action]')?.dataset.messageAction;
    const reaction = event.target.closest('[data-message-reaction]')?.dataset.messageReaction;
    if (reaction) { sendReaction(id, reaction); return; }
    if (action === 'reply') beginReply(messageRecordAnyChannel(id)?.record || { id, name: message.querySelector('.author')?.textContent, text: message.querySelector('.message-text')?.dataset.rawText });
    if (action === 'pin') togglePin(id);
    if (action === 'delete') void deleteMessage(id);
    if (action === 'react') {
      closeReactionPopover(); reactionPopover = document.createElement('div'); reactionPopover.className = 'quick-reaction-popover';
      reactionPopover.innerHTML = quickReactions.map((emoji) => `<button type="button" data-quick-reaction="${emoji}">${emoji}</button>`).join('');
      document.body.append(reactionPopover); const rect = event.target.closest('button').getBoundingClientRect();
      reactionPopover.style.left = `${Math.max(8, Math.min(innerWidth - reactionPopover.offsetWidth - 8, rect.left))}px`; reactionPopover.style.top = `${Math.max(8, rect.top - reactionPopover.offsetHeight - 7)}px`;
      reactionPopover.addEventListener('click', (reactionEvent) => { const emoji = reactionEvent.target.closest('[data-quick-reaction]')?.dataset.quickReaction; if (emoji) sendReaction(id, emoji); closeReactionPopover(); });
    }
  });
  document.addEventListener('click', (event) => { if (reactionPopover && !reactionPopover.contains(event.target) && !event.target.closest('[data-message-action="react"]')) closeReactionPopover(); });

  const panelTabs = document.querySelector('#right-panel > .panel-tabs');
  const panelUtilities = document.createElement('div'); panelUtilities.className = 'panel-utilities';
  panelUtilities.innerHTML = `<button id="pinned-messages-button" type="button" title="Mensagens fixadas" aria-label="Mensagens fixadas">${svg.pin}<b>0</b></button><button id="right-panel-collapse" type="button" title="Recolher painel" aria-label="Recolher painel">${svg.collapse}</button>`;
  panelTabs?.append(panelUtilities);
  const pinnedPopover = document.createElement('section'); pinnedPopover.id = 'pinned-messages-popover'; pinnedPopover.className = 'pinned-messages-popover hidden';
  pinnedPopover.innerHTML = '<header><div><strong>Mensagens fixadas</strong><small>Canal atual</small></div><button type="button" aria-label="Fechar">×</button></header><div></div>';
  document.body.append(pinnedPopover);
  function renderPinnedMessages() {
    const pinned = (channelMessages.get(activeTextChannel) || []).filter((item) => item.pinned);
    panelUtilities.querySelector('#pinned-messages-button b').textContent = String(pinned.length);
    pinnedPopover.querySelector('header small').textContent = `#${activeTextChannel}`;
    pinnedPopover.lastElementChild.innerHTML = pinned.length ? pinned.map((item) => `<button type="button" data-pinned-jump="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.text)}</span></button>`).join('') : '<p>Nenhuma mensagem fixada neste canal.</p>';
  }
  byId('pinned-messages-button')?.addEventListener('click', (event) => { event.stopPropagation(); renderPinnedMessages(); pinnedPopover.classList.toggle('hidden'); const rect = event.currentTarget.getBoundingClientRect(); pinnedPopover.style.right = `${Math.max(8, innerWidth - rect.right)}px`; pinnedPopover.style.top = `${rect.bottom + 7}px`; });
  pinnedPopover.querySelector('header button').addEventListener('click', () => pinnedPopover.classList.add('hidden'));
  pinnedPopover.addEventListener('click', (event) => { const id = event.target.closest('[data-pinned-jump]')?.dataset.pinnedJump; if (!id) return; pinnedPopover.classList.add('hidden'); document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  document.addEventListener('click', (event) => { if (!pinnedPopover.contains(event.target) && !event.target.closest('#pinned-messages-button')) pinnedPopover.classList.add('hidden'); });
  const selectTextChannelBeforeFeatures = selectTextChannel;
  selectTextChannel = function selectTextChannelWithMessageFeatures(channel) { clearReply(); const result = selectTextChannelBeforeFeatures(channel); renderPinnedMessages(); return result; };

  /* ---------------------------------------------------------------------- */
  /* Stream layouts and contextual center                                    */
  /* ---------------------------------------------------------------------- */
  const layoutStorageKey = 'voiceup-media-layout-v1';
  let mediaLayout = localStorage.getItem(layoutStorageKey) || 'auto';
  const videoFrame = byId('video-frame'); const videoGalleryElement = byId('video-gallery');
  const layoutToolbar = document.createElement('div'); layoutToolbar.id = 'media-layout-toolbar'; layoutToolbar.className = 'media-layout-toolbar';
  layoutToolbar.innerHTML = `${svg.layout}<label>Layout<select id="media-layout-select"><option value="auto">Automático</option><option value="grid">Grade</option><option value="focus">Foco</option><option value="compact">Compacto</option></select></label>`;
  videoFrame?.prepend(layoutToolbar); byId('media-layout-select').value = ['auto', 'grid', 'focus', 'compact'].includes(mediaLayout) ? mediaLayout : 'auto';
  const applyMediaLayout = () => {
    mediaLayout = byId('media-layout-select')?.value || 'auto';
    if (videoGalleryElement) {
      videoGalleryElement.dataset.mediaLayout = mediaLayout;
      const visible = [...videoGalleryElement.querySelectorAll('.video-tile:not(.hidden)')];
      if (mediaLayout === 'focus' && !visible.some((tile) => tile.classList.contains('layout-focused'))) visible[0]?.classList.add('layout-focused');
      if (mediaLayout !== 'focus') visible.forEach((tile) => tile.classList.remove('layout-focused'));
    }
    localStorage.setItem(layoutStorageKey, mediaLayout);
  };
  byId('media-layout-select')?.addEventListener('change', applyMediaLayout); applyMediaLayout();
  videoGalleryElement?.addEventListener('click', (event) => {
    if (mediaLayout !== 'focus' || event.target.closest('.media-tile-controls')) return;
    const tile = event.target.closest('.video-tile:not(.hidden)'); if (!tile) return;
    videoGalleryElement.querySelectorAll('.video-tile').forEach((item) => item.classList.toggle('layout-focused', item === tile));
    videoGalleryElement.dataset.focusedPeer = tile.dataset.videoPeer || '';
  });
  const refreshVideoStageBeforeFeatures = refreshVideoStage;
  refreshVideoStage = function refreshVideoStageWithLayouts(...args) { const result = refreshVideoStageBeforeFeatures(...args); applyMediaLayout(); syncCentralContext(); return result; };
  const contextBadge = document.createElement('span'); contextBadge.id = 'central-context-badge'; contextBadge.className = 'central-context-badge';
  document.querySelector('.content > header')?.append(contextBadge);
  function syncCentralContext() {
    const visibleMedia = Boolean(videoGalleryElement?.querySelector('.video-tile:not(.hidden)'));
    const mode = currentMode === 'hosted' && !activeVoiceChannel ? 'server' : visibleMedia ? 'media' : activeVoiceChannel || hasActiveCall?.() ? 'call' : 'pairing';
    document.body.dataset.centralMode = mode;
    contextBadge.textContent = ({ server: 'Chat do servidor', media: 'Transmissões', call: 'Canal de voz', pairing: 'Pareamento P2P' })[mode];
    contextBadge.classList.toggle('hidden', mode === 'pairing');
  }
  setInterval(syncCentralContext, 500); syncCentralContext();

  /* ---------------------------------------------------------------------- */
  /* Saved-server rail                                                       */
  /* ---------------------------------------------------------------------- */
  const serverRail = document.createElement('nav'); serverRail.id = 'server-rail'; serverRail.className = 'server-rail'; serverRail.setAttribute('aria-label', 'Servidores salvos');
  document.querySelector('#app > .sidebar')?.before(serverRail);
  const readSavedServers = () => { try { const value = JSON.parse(localStorage.getItem('voiceup-saved-servers-v1') || '[]'); return Array.isArray(value) ? value.slice(0, 12) : []; } catch { return []; } };
  const serverInitials = (name) => String(name || 'S').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const renderServerRail = () => {
    const currentUrl = byId('host-url')?.value.trim().replace(/\/$/, ''); const currentRoom = byId('host-room')?.value.trim();
    serverRail.innerHTML = `<button type="button" class="server-rail-home" title="Tela inicial" aria-label="Tela inicial"><span class="brand-mark">V</span></button><i></i>${readSavedServers().map((server) => `<button type="button" class="server-rail-item${server.url?.replace(/\/$/, '') === currentUrl && server.roomId === currentRoom ? ' active' : ''}" data-rail-server="${escapeHtml(server.id)}" title="${escapeHtml(server.name)}" aria-label="Abrir ${escapeHtml(server.name)}"><span>${server.icon ? `<img src="${escapeHtml(server.icon)}" alt="">` : escapeHtml(serverInitials(server.name))}</span></button>`).join('')}<button type="button" class="server-rail-add" title="Adicionar servidor" aria-label="Adicionar servidor">${svg.plus}</button>`;
  };
  renderServerRail();
  const savedList = byId('saved-servers-list'); if (savedList) new MutationObserver(renderServerRail).observe(savedList, { childList: true, subtree: true });
  window.addEventListener('storage', (event) => { if (event.key === 'voiceup-saved-servers-v1') renderServerRail(); });
  window.addEventListener('voiceup-saved-servers-changed', renderServerRail);
  const queueServerOpen = async (server) => {
    if (!server) return;
    const proceed = currentMode === 'hosted' && hostedSocket?.connected && typeof showVoiceupDialog === 'function'
      ? await showVoiceupDialog({ title: `Abrir ${server.name}?`, message: 'Você será desconectado do servidor atual.', detail: `Sala ${server.roomId}`, icon: '↗', actions: [{ value: 'open', label: 'Trocar servidor', style: 'primary' }, { value: 'cancel', label: 'Cancelar' }] })
      : 'open';
    if (proceed !== 'open') return;
    sessionStorage.setItem('voiceup-pending-server', JSON.stringify(server)); location.reload();
  };
  serverRail.addEventListener('click', (event) => {
    if (event.target.closest('.server-rail-home,.server-rail-add')) { if (!byId('app')?.classList.contains('hidden')) location.reload(); else byId('host-url')?.focus(); return; }
    const id = event.target.closest('[data-rail-server]')?.dataset.railServer; if (id) void queueServerOpen(readSavedServers().find((server) => String(server.id) === id));
  });
  try {
    const pending = JSON.parse(sessionStorage.getItem('voiceup-pending-server') || 'null');
    if (pending?.url && pending?.roomId) {
      sessionStorage.removeItem('voiceup-pending-server');
      if (byId('host-name')) byId('host-name').value = pending.name || '';
      byId('host-url').value = pending.url; byId('host-room').value = pending.roomId;
      setTimeout(() => byId('join-host')?.click(), 120);
    }
  } catch { sessionStorage.removeItem('voiceup-pending-server'); }

  /* ---------------------------------------------------------------------- */
  /* Resizable and collapsible right panel                                   */
  /* ---------------------------------------------------------------------- */
  const rightPanelStorageKey = 'voiceup-right-panel-v1';
  const rightPanelPreference = readJson(rightPanelStorageKey, { width: 315, collapsed: false });
  const rightPanel = byId('right-panel');
  const resizeHandle = document.createElement('div'); resizeHandle.id = 'right-panel-resizer'; resizeHandle.className = 'right-panel-resizer'; resizeHandle.title = 'Arraste para redimensionar';
  rightPanel?.prepend(resizeHandle);
  const reopenPanel = document.createElement('button'); reopenPanel.id = 'right-panel-reopen'; reopenPanel.className = 'right-panel-reopen'; reopenPanel.type = 'button'; reopenPanel.title = 'Abrir painel lateral'; reopenPanel.setAttribute('aria-label', 'Abrir painel lateral'); reopenPanel.innerHTML = svg.expand;
  document.querySelector('.content > header')?.append(reopenPanel);
  const applyRightPanel = () => {
    const width = Math.max(260, Math.min(520, Number(rightPanelPreference.width) || 315));
    document.documentElement.style.setProperty('--right-panel-width', `${width}px`);
    document.body.classList.toggle('right-panel-collapsed', Boolean(rightPanelPreference.collapsed));
    localStorage.setItem(rightPanelStorageKey, JSON.stringify({ width, collapsed: Boolean(rightPanelPreference.collapsed) }));
  };
  byId('right-panel-collapse')?.addEventListener('click', () => { rightPanelPreference.collapsed = true; applyRightPanel(); });
  reopenPanel.addEventListener('click', () => { rightPanelPreference.collapsed = false; applyRightPanel(); });
  resizeHandle.addEventListener('pointerdown', (event) => {
    if (innerWidth <= 980) return;
    resizeHandle.setPointerCapture(event.pointerId); document.body.classList.add('resizing-right-panel');
    const move = (moveEvent) => { rightPanelPreference.width = Math.max(260, Math.min(520, innerWidth - moveEvent.clientX)); applyRightPanel(); };
    const end = () => { resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', end); resizeHandle.removeEventListener('pointercancel', end); document.body.classList.remove('resizing-right-panel'); };
    resizeHandle.addEventListener('pointermove', move); resizeHandle.addEventListener('pointerup', end); resizeHandle.addEventListener('pointercancel', end);
  });
  applyRightPanel(); renderPinnedMessages();
})();
