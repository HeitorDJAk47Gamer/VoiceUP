const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: createSocketClient } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const { loadPlugins } = require('./plugin-runtime');

const AVATAR_COLORS = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const MAX_VOICE_CHANNEL_SIZE = 7;
const MAX_HUMAN_VOICE_CHANNEL_SIZE = 6;
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const safeIdentity = (value) => String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
const safeMessageId = (value, socketId) => { const owner = String(socketId || 'client').replace(/[^a-z0-9_-]/gi, '').slice(0, 36); const raw = String(value || Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, '').slice(0, 72); return raw.startsWith(`msg-${owner}-`) ? raw : `msg-${owner}-${raw}`; };
const voiceKey = (room, channel) => `voice:${room}:${channel}`;
const serverKey = (room) => `server:${room}`;
const LOBBY_CHANNEL = '__lobby__';
const DEFAULT_ROOM_LAYOUT = Object.freeze({
  name: 'Sala VoiceUP',
  voiceChannels: ['Geral', 'Jogando', 'Ausente'],
  textChannels: ['geral', 'conversa', 'avisos']
});
const safeRoomId = (value) => String(value || '').trim().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').slice(0, 48);
const safeChannelList = (values, fallback) => {
  const items = Array.isArray(values) ? values : [];
  const unique = [...new Set(items.map((value) => safeChannel(value, '')).filter(Boolean))].slice(0, 24);
  return unique.length ? unique : [...fallback];
};
const normalizeRoomLayout = (value = {}, roomId = '') => ({
  id: safeRoomId(value.id || roomId),
  name: String(value.name || roomId || DEFAULT_ROOM_LAYOUT.name).trim().slice(0, 48) || DEFAULT_ROOM_LAYOUT.name,
  voiceChannels: safeChannelList(value.voiceChannels, DEFAULT_ROOM_LAYOUT.voiceChannels),
  textChannels: safeChannelList(value.textChannels, DEFAULT_ROOM_LAYOUT.textChannels)
});

function startSignalingServer(port = 3000, options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  const startedAt = Date.now();
  const events = { connections: 0, signals: 0, joins: 0, messages: 0, kicks: 0, bans: 0 };
  const logs = [];
  const clusterOptions = options.cluster && typeof options.cluster === 'object' ? options.cluster : {};
  const clusterEnabled = clusterOptions.enabled === true;
  const clusterRole = clusterOptions.role === 'secondary' ? 'secondary' : 'primary';
  const clusterNodeId = safeIdentity(clusterOptions.nodeId) || `host-${Math.random().toString(36).slice(2, 10)}`;
  const clusterSecret = String(clusterOptions.secret || '').slice(0, 128);
  const clusterPrimaryUrl = String(clusterOptions.primaryUrl || '').replace(/\/$/, '');
  const remoteMembers = new Map();
  let federationTransport = null;
  let federationRemoteHost = '';
  let federationState = clusterEnabled ? 'aguardando' : 'desativado';
  let configuredRooms = new Map();
  const setConfiguredRooms = (rooms = []) => {
    configuredRooms = new Map((Array.isArray(rooms) ? rooms : []).map((room) => {
      const normalized = normalizeRoomLayout(room);
      return [normalized.id.toLowerCase(), normalized];
    }).filter(([id]) => id));
  };
  const roomLayout = (roomId) => {
    const id = safeRoomId(roomId);
    const configured = configuredRooms.get(id.toLowerCase());
    return { ...(configured || normalizeRoomLayout({ id, name: id || DEFAULT_ROOM_LAYOUT.name }, id)), managed: Boolean(configured) };
  };
  const publishRoomLayout = (socket) => {
    if (!socket?.data?.room) return;
    socket.emit('room-layout', roomLayout(socket.data.room));
  };
  setConfiguredRooms(options.roomLayouts);
  const addLog = (level, message) => { logs.unshift({ time: new Date().toLocaleTimeString('pt-BR'), level, message }); if (logs.length > 80) logs.pop(); };
  const safePresenceStatus = (value) => ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
  const peerSummary = (id, peer = {}) => ({ id, name: peer.name || 'Visitante', color: peer.color || AVATAR_COLORS[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral'), isBot: Boolean(peer.isBot) });
  const peersIn = (key) => {
    const local = [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
      const peer = io.sockets.sockets.get(id)?.data || {};
      return peerSummary(id, peer);
    }).filter((peer) => !io.sockets.sockets.get(peer.id)?.data?.isFederation);
    const remote = [...remoteMembers.values()].filter((peer) => peer.serverRoom === key || peer.voiceRoom === key).map((peer) => peerSummary(peer.id, peer));
    return [...local, ...remote];
  };
  const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', { members: peersIn(serverRoom).filter((peer) => peer.id !== excludedId) });
  const safeMentions = (serverRoom, mentions) => {
    if (!Array.isArray(mentions)) return [];
    const allowed = new Set(peersIn(serverRoom).map((peer) => peer.id));
    return [...new Set(mentions.map(String).filter((id) => allowed.has(id)))].slice(0, 16);
  };
  const musicFolder = options.musicDirectory || path.join(__dirname, 'music');
  fs.mkdirSync(musicFolder, { recursive: true });
  const musicFiles = () => fs.readdirSync(musicFolder).filter((name) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const federationId = (socketId) => `fed:${clusterNodeId}:${socketId}`;
  const exportMember = (socket) => ({ id: federationId(socket.id), localId: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), room: socket.data.room || '', serverRoom: socket.data.serverRoom || '', voiceRoom: socket.data.voiceRoom || '', voiceChannel: socket.data.voiceChannel || LOBBY_CHANNEL, isBot: Boolean(socket.data.isBot), joinedAt: socket.data.joinedAt || Date.now() });
  const localClientSockets = () => [...io.sockets.sockets.values()].filter((socket) => socket.data.room && !socket.data.isFederation);
  const sendFederation = (event, payload) => { if (federationTransport?.connected) federationTransport.emit(event, payload); };
  const localizeFederatedId = (id) => {
    const prefix = `fed:${clusterNodeId}:`;
    return String(id || '').startsWith(prefix) ? String(id).slice(prefix.length) : String(id || '');
  };
  const removeRemoteMember = (id) => {
    const previous = remoteMembers.get(String(id || '')); if (!previous) return;
    remoteMembers.delete(previous.id);
    if (previous.voiceChannel !== LOBBY_CHANNEL) io.to(previous.voiceRoom).emit('peer-left', { id: previous.id, name: previous.name });
    broadcastPresence(previous.serverRoom);
  };
  const upsertRemoteMember = (value = {}) => {
    const id = String(value.id || '').slice(0, 180); const room = safeRoomId(value.room); if (!id || !room) return;
    const layout = roomLayout(room); const requested = safeChannel(value.voiceChannel, LOBBY_CHANNEL);
    const voiceChannel = requested === LOBBY_CHANNEL || layout.voiceChannels.includes(requested) ? requested : layout.voiceChannels[0];
    const member = { id, localId: String(value.localId || ''), clientId: safeIdentity(value.clientId), name: String(value.name || 'Visitante').slice(0, 24), color: AVATAR_COLORS.includes(value.color) ? value.color : AVATAR_COLORS[0], avatar: typeof value.avatar === 'string' && value.avatar.startsWith('data:image/') && value.avatar.length <= 150000 ? value.avatar : '', status: safePresenceStatus(value.status), room, serverRoom: serverKey(room), voiceChannel, voiceRoom: voiceKey(room, voiceChannel), isBot: Boolean(value.isBot), joinedAt: Number(value.joinedAt) || Date.now(), remote: true };
    const previous = remoteMembers.get(id);
    if (previous?.voiceRoom && previous.voiceRoom !== member.voiceRoom && previous.voiceChannel !== LOBBY_CHANNEL) io.to(previous.voiceRoom).emit('peer-left', { id, name: previous.name });
    remoteMembers.set(id, member);
    if ((!previous || previous.voiceRoom !== member.voiceRoom) && member.voiceChannel !== LOBBY_CHANNEL) io.to(member.voiceRoom).emit('peer-joined', peerSummary(id, member));
    if (previous?.serverRoom && previous.serverRoom !== member.serverRoom) broadcastPresence(previous.serverRoom);
    broadcastPresence(member.serverRoom);
  };
  const clearRemoteHost = (hostId = federationRemoteHost) => {
    const affected = [...remoteMembers.values()].filter((member) => !hostId || member.id.startsWith(`fed:${hostId}:`));
    affected.forEach((member) => removeRemoteMember(member.id));
  };
  const applyFederatedLayouts = (rooms) => {
    if (clusterRole !== 'secondary' || !Array.isArray(rooms)) return;
    setConfiguredRooms(rooms);
    for (const socket of localClientSockets()) publishRoomLayout(socket);
  };
  const sendFederationSnapshot = () => sendFederation('federation:snapshot', { hostId: clusterNodeId, members: localClientSockets().map(exportMember), roomLayouts: [...configuredRooms.values()] });
  const bindFederationTransport = (transport, remoteHint = '') => {
    federationTransport = transport; federationRemoteHost = safeIdentity(remoteHint);
    transport.on('federation:snapshot', ({ hostId, members, roomLayouts } = {}) => {
      const remoteHost = safeIdentity(hostId); if (!remoteHost || remoteHost === clusterNodeId) return;
      clearRemoteHost(remoteHost); federationRemoteHost = remoteHost;
      (Array.isArray(members) ? members : []).forEach(upsertRemoteMember);
      applyFederatedLayouts(roomLayouts);
      federationState = 'conectado'; addLog('cluster', `Host ${remoteHost} sincronizado`);
    });
    transport.on('federation:layouts', ({ hostId, roomLayouts } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) applyFederatedLayouts(roomLayouts); });
    transport.on('federation:member', ({ hostId, member } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) upsertRemoteMember(member); });
    transport.on('federation:left', ({ hostId, id } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) removeRemoteMember(String(id || '')); });
    transport.on('federation:signal', ({ target, origin, data } = {}) => {
      const socket = io.sockets.sockets.get(localizeFederatedId(target));
      if (!socket?.data?.serverRoom || socket.data.serverRoom !== serverKey(origin?.room)) return;
      events.signals += 1;
      socket.emit('signal', { from: String(origin.id || ''), name: origin.name || 'Visitante', color: origin.color || AVATAR_COLORS[0], avatar: origin.avatar || '', status: safePresenceStatus(origin.status), data });
    });
    transport.on('federation:text', ({ room, packet } = {}) => {
      const targetRoom = serverKey(safeRoomId(room)); if (!packet?.text || !room) return;
      const mentions = Array.isArray(packet.mentions) ? packet.mentions.map(localizeFederatedId) : [];
      io.to(targetRoom).emit('text-message', { ...packet, mentions });
    });
    transport.on('federation:edit', ({ room, packet } = {}) => {
      const targetRoom = serverKey(safeRoomId(room)); if (!packet?.messageId || !room) return;
      const mentions = Array.isArray(packet.mentions) ? packet.mentions.map(localizeFederatedId) : [];
      io.to(targetRoom).emit('message-edited', { ...packet, mentions });
    });
    transport.on('disconnect', () => {
      federationState = 'desconectado'; clearRemoteHost(); federationTransport = null;
      addLog('cluster', 'Ligação com o outro host foi perdida');
    });
  };

  const bansFile = options.bansFile || '';
  const banned = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(bansFile, 'utf8'));
    if (Array.isArray(saved)) saved.forEach((entry) => { if (safeIdentity(entry?.clientId)) banned.set(safeIdentity(entry.clientId), entry); });
  } catch { /* first start or invalid optional file */ }
  const persistBans = () => {
    if (!bansFile) return;
    try { fs.mkdirSync(path.dirname(bansFile), { recursive: true }); fs.writeFileSync(bansFile, JSON.stringify([...banned.values()], null, 2), 'utf8'); } catch (error) { addLog('error', `Não foi possível salvar banimentos: ${error.message}`); }
  };
  const publishNotice = (room, text) => {
    if (!room) return;
    const packet = { from: `server:${clusterNodeId}`, text, textChannel: 'geral', name: 'VoiceUP Server', color: '#ff8b72' };
    io.to(serverKey(room)).emit('text-message', packet);
    sendFederation('federation:text', { hostId: clusterNodeId, room, packet });
  };

  const plugins = loadPlugins({
    directories: options.pluginDirectories || [path.join(__dirname, 'plugins')],
    stateFile: options.pluginStateFile || '',
    addLog,
    emitSystemMessage: ({ room, textChannel, text, name, color, avatar, pluginId }) => {
      if (!room || !text) return;
      events.messages += 1;
      const packet = { from: `plugin:${clusterNodeId}:${pluginId || 'server'}`, messageId: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), text, textChannel, name, color, avatar: avatar || '', pluginId };
      io.to(serverKey(room)).emit('text-message', packet);
      sendFederation('federation:text', { hostId: clusterNodeId, room, packet });
    },
    emitPluginEvent: (event) => options.onPluginEvent?.(event),
    media: { list: musicFiles, url: () => '' }
  });

  app.get('/health', (_req, res) => res.json({ ok: true, app: 'VoiceUp Server', maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE, managedRooms: configuredRooms.size, plugins: plugins.list().map(({ id, version }) => ({ id, version })), musicFiles: musicFiles() }));
  io.on('connection', (socket) => {
    const federationAuth = socket.handshake?.auth || {};
    if (federationAuth.voiceupFederation) {
      const allowed = clusterEnabled && clusterRole === 'primary' && clusterSecret && String(federationAuth.secret || '') === clusterSecret;
      if (!allowed) { addLog('cluster', 'Pareamento de host recusado'); socket.disconnect(true); return; }
      socket.data.isFederation = true;
      const remoteHost = safeIdentity(federationAuth.hostId);
      bindFederationTransport(socket, remoteHost);
      federationState = 'conectado';
      addLog('cluster', `Host secundário ${remoteHost || 'sem identificação'} conectado`);
      sendFederationSnapshot();
      return;
    }
    events.connections += 1; addLog('info', 'Novo cliente conectado');
    socket.on('join-room', ({ roomId, voiceChannel, name, color, avatar, bot, clientId, status }) => {
      const room = safeRoomId(roomId);
      const layout = roomLayout(room);
      const requestedVoiceChannel = safeChannel(voiceChannel, LOBBY_CHANNEL);
      const voiceChannelName = requestedVoiceChannel === LOBBY_CHANNEL || layout.voiceChannels.includes(requestedVoiceChannel) ? requestedVoiceChannel : layout.voiceChannels[0];
      const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
      const identity = safeIdentity(clientId);
      if (!room) return socket.emit('app-error', 'Informe um código de sala.');
      if (!bot && identity && banned.has(identity)) {
        socket.emit('server-action', { action: 'banned', message: 'Você foi banido deste Server Host.' });
        addLog('ban', `${safeName} tentou entrar, mas está banido`);
        return setTimeout(() => socket.disconnect(true), 120);
      }
      const serverRoom = serverKey(room); const voiceRoom = voiceKey(room, voiceChannelName);
      if (voiceChannelName !== LOBBY_CHANNEL && peersIn(voiceRoom).length >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
      const regularPeers = peersIn(voiceRoom).filter((peer) => !peer.isBot);
      if (voiceChannelName !== LOBBY_CHANNEL && !bot && regularPeers.length >= MAX_HUMAN_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz atingiu o limite de ${MAX_HUMAN_VOICE_CHANNEL_SIZE} pessoas.`);
      const usedColors = peersIn(serverRoom).map((peer) => peer.color);
      const requestedColor = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
      const safeColor = usedColors.includes(requestedColor) ? AVATAR_COLORS.find((candidate) => !usedColors.includes(candidate)) || requestedColor : requestedColor;
      const safeAvatar = typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length <= 150000 ? avatar : '';
      socket.join(serverRoom); socket.join(voiceRoom);
      Object.assign(socket.data, { room, serverRoom, voiceRoom, voiceChannel: voiceChannelName, name: safeName, color: safeColor, avatar: safeAvatar, status: safePresenceStatus(status), clientId: identity, isBot: Boolean(bot), joinedAt: Date.now() });
      socket.emit('color-assigned', { color: safeColor }); events.joins += 1; addLog('join', `${safeName} entrou em ${room} / ${voiceChannelName}`);
      publishRoomLayout(socket);
      const peers = voiceChannelName === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: room, voiceChannel: voiceChannelName, peers });
      if (voiceChannelName !== LOBBY_CHANNEL) socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar, status: socket.data.status });
      broadcastPresence(serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('request-room-presence', () => {
      if (!socket.data.serverRoom) return;
      socket.emit('room-presence', { members: peersIn(socket.data.serverRoom) });
    });
    socket.on('presence-update', ({ status } = {}) => {
      if (!socket.data.serverRoom) return;
      const next = safePresenceStatus(status);
      if (next === socket.data.status) return;
      socket.data.status = next;
      broadcastPresence(socket.data.serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('switch-voice-channel', ({ voiceChannel }) => {
      if (!socket.data.room) return;
      const layout = roomLayout(socket.data.room);
      const requestedChannel = safeChannel(voiceChannel, layout.voiceChannels[0]);
      const channel = requestedChannel === LOBBY_CHANNEL || layout.voiceChannels.includes(requestedChannel) ? requestedChannel : layout.voiceChannels[0];
      const nextVoiceRoom = voiceKey(socket.data.room, channel);
      if (nextVoiceRoom === socket.data.voiceRoom) return;
      if (channel !== LOBBY_CHANNEL && peersIn(nextVoiceRoom).length >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
      if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
      socket.leave(socket.data.voiceRoom);
      socket.join(nextVoiceRoom); socket.data.voiceRoom = nextVoiceRoom; socket.data.voiceChannel = channel;
      const peers = channel === LOBBY_CHANNEL ? [] : peersIn(nextVoiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers });
      if (channel !== LOBBY_CHANNEL) socket.to(nextVoiceRoom).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar, status: safePresenceStatus(socket.data.status) });
      broadcastPresence(socket.data.serverRoom); addLog('channel', channel === LOBBY_CHANNEL ? `${socket.data.name} saiu da call` : `${socket.data.name} mudou para ${channel}`);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('text-message', ({ text, textChannel, messageId, createdAt, mentions }) => {
      if (!socket.data.serverRoom) return;
      const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
      events.messages += 1;
      const layout = roomLayout(socket.data.room);
      const requestedTextChannel = safeChannel(textChannel, layout.textChannels[0]);
      const safeTextChannel = layout.textChannels.includes(requestedTextChannel) ? requestedTextChannel : layout.textChannels[0];
      const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
      const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
      socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds });
      if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
      const packet = { from: socket.id, messageId: id, createdAt: sentAt, text: safeText, textChannel: safeTextChannel, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', mentions: safeMentionIds };
      io.to(socket.data.serverRoom).emit('text-message', packet);
      sendFederation('federation:text', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
      plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0] }, serverIsCloud: false });
    });
    socket.on('edit-message', ({ messageId, text, textChannel, mentions }) => {
      if (!socket.data.serverRoom) return;
      const id = safeMessageId(messageId, socket.id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
      if (!known || !safeText || safeChannel(textChannel, 'geral') !== known.textChannel) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
      const editedAt = Date.now(); const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
      known.mentions = safeMentionIds;
      const packet = { from: socket.id, messageId: id, text: safeText, textChannel: known.textChannel, editedAt, mentions: safeMentionIds };
      io.to(socket.data.serverRoom).emit('message-edited', packet);
      sendFederation('federation:edit', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
    });
    socket.on('signal', ({ target, data }) => {
      if (!target || !socket.data.serverRoom) return;
      const targetSocket = io.sockets.sockets.get(String(target));
      if (targetSocket && targetSocket.data.serverRoom === socket.data.serverRoom) {
        events.signals += 1;
        targetSocket.emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), data });
        return;
      }
      const remote = remoteMembers.get(String(target));
      if (!remote || remote.serverRoom !== socket.data.serverRoom) return;
      events.signals += 1;
      sendFederation('federation:signal', { hostId: clusterNodeId, target: remote.id, origin: exportMember(socket), data });
    });
    socket.on('latency-ping', ({ sentAt }) => socket.emit('latency-pong', { sentAt }));
    socket.on('server-pong', ({ sentAt }) => { const ping = Date.now() - Number(sentAt); if (Number.isFinite(ping) && ping >= 0 && ping < 10000) socket.data.ping = ping; });
    socket.on('disconnecting', () => { if (socket.data.voiceRoom) { addLog('leave', `${socket.data.name || 'Cliente'} saiu da sala`); if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); } if (socket.data.serverRoom) { broadcastPresence(socket.data.serverRoom, socket.id); sendFederation('federation:left', { hostId: clusterNodeId, id: federationId(socket.id) }); } });
  });

  const members = () => [
    ...localClientSockets().map((socket) => ({ id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), room: socket.data.room || '', voiceChannel: socket.data.voiceChannel || '', isBot: Boolean(socket.data.isBot), remote: false, connectedSeconds: socket.data.joinedAt ? Math.floor((Date.now() - socket.data.joinedAt) / 1000) : 0 })),
    ...[...remoteMembers.values()].map((member) => ({ ...member, remote: true, connectedSeconds: member.joinedAt ? Math.floor((Date.now() - member.joinedAt) / 1000) : 0 }))
  ];
  const updateRoomLayouts = (rooms = []) => {
    setConfiguredRooms(rooms);
    for (const socket of io.sockets.sockets.values()) publishRoomLayout(socket);
    if (clusterRole === 'primary') sendFederation('federation:layouts', { hostId: clusterNodeId, roomLayouts: [...configuredRooms.values()] });
    addLog('rooms', 'Estrutura de salas e canais atualizada');
    return [...configuredRooms.values()];
  };
  const disconnectMember = (id, action, notice) => {
    const socket = io.sockets.sockets.get(String(id || ''));
    if (!socket || socket.data.isBot) return { ok: false, message: 'Participante não encontrado.' };
    const name = socket.data.name || 'Participante'; const room = socket.data.room;
    socket.emit('server-action', { action, message: action === 'banned' ? 'Você foi banido deste Server Host.' : 'Você foi expulso pelo Server Host.' });
    publishNotice(room, notice || `${name} foi removido pelo Server Host.`);
    setTimeout(() => socket.disconnect(true), 120);
    addLog(action === 'banned' ? 'ban' : 'kick', `${name}: ${action}`);
    return { ok: true, message: action === 'banned' ? `${name} foi banido.` : `${name} foi expulso.` };
  };
  const kick = (id) => { events.kicks += 1; return disconnectMember(id, 'kicked'); };
  const ban = (id) => {
    const socket = io.sockets.sockets.get(String(id || ''));
    const identity = safeIdentity(socket?.data?.clientId);
    if (!identity) return { ok: false, message: 'Este cliente é antigo e não pode receber banimento persistente. Peça para atualizar o Client.' };
    banned.set(identity, { clientId: identity, name: socket.data.name || 'Visitante', bannedAt: new Date().toISOString() }); persistBans(); events.bans += 1;
    return disconnectMember(id, 'banned', `${socket.data.name || 'Participante'} foi banido pelo Server Host.`);
  };
  const unban = (clientId) => { const identity = safeIdentity(clientId); if (!identity || !banned.has(identity)) return { ok: false, message: 'Banimento não encontrado.' }; const name = banned.get(identity).name || 'Participante'; banned.delete(identity); persistBans(); addLog('ban', `${name} foi desbanido`); return { ok: true, message: `${name} pode entrar novamente.` }; };
  const getStats = () => {
    const voiceRooms = new Set([...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('voice:') && !key.endsWith(`:${LOBBY_CHANNEL}`) && value.size > 0).map(([key]) => key));
    for (const member of remoteMembers.values()) if (member.voiceChannel !== LOBBY_CHANNEL) voiceRooms.add(member.voiceRoom);
    const pings = localClientSockets().map((socket) => socket.data.ping).filter(Number.isFinite);
    for (const socket of localClientSockets()) socket.emit('server-ping', Date.now());
    const allMembers = members();
    return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), participants: allMembers.length, localParticipants: localClientSockets().length, rooms: voiceRooms.size, roomLayouts: [...configuredRooms.values()], cluster: { enabled: clusterEnabled, role: clusterRole, nodeId: clusterNodeId, state: federationState, remoteHost: federationRemoteHost, remoteParticipants: remoteMembers.size }, averagePing: pings.length ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length) : null, events, logs, plugins: plugins.list(), pluginErrors: plugins.errors(), members: allMembers, bans: [...banned.values()] };
  };
  const startSecondaryFederation = () => {
    if (!clusterEnabled || clusterRole !== 'secondary') return;
    if (!clusterPrimaryUrl || !clusterSecret) { federationState = 'configuração incompleta'; addLog('cluster', 'Informe URL primária e chave para ligar o host secundário'); return; }
    const transport = createSocketClient(clusterPrimaryUrl, { transports: ['websocket', 'polling'], timeout: 10000, reconnection: true, auth: { voiceupFederation: true, hostId: clusterNodeId, secret: clusterSecret } });
    bindFederationTransport(transport);
    transport.on('connect', () => { federationTransport = transport; federationState = 'conectado'; addLog('cluster', 'Ligação com host primário estabelecida'); sendFederationSnapshot(); });
    transport.on('connect_error', (error) => { federationState = 'erro'; addLog('cluster', `Host primário indisponível: ${error.message}`); });
  };
  const closeFederation = () => { const transport = federationTransport; federationTransport = null; transport?.disconnect?.(); clearRemoteHost(''); };
  server.on('close', closeFederation);
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { addLog('info', `Servidor iniciado na porta ${port}`); startSecondaryFederation(); resolve({ server, io, port, getStats, members, kick, ban, unban, updateRoomLayouts, closeFederation, configurePlugin: plugins.configure, pluginAction: plugins.action }); }); });
}
module.exports = { startSignalingServer, DEFAULT_ROOM_LAYOUT, normalizeRoomLayout };
