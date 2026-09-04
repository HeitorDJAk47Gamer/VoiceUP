const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: createSocketClient } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadPlugins } = require('./plugin-runtime');
const { createPersistentChatStore, createBugReportStore } = require('./persistent-storage');

const AVATAR_COLORS = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
// Voice remains a direct WebRTC mesh. Twelve human endpoints is a practical
// default for audio-focused calls, while three extra slots keep server-side
// bots from consuming the participant allowance. Hosts may tune both values.
const MAX_HUMAN_VOICE_CHANNEL_SIZE = Math.max(2, positiveInteger(process.env.VOICEUP_MAX_HUMANS_PER_CALL, 12));
const MAX_VOICE_CHANNEL_SIZE = Math.max(MAX_HUMAN_VOICE_CHANNEL_SIZE, positiveInteger(process.env.VOICEUP_MAX_MEMBERS_PER_CALL, 15));
const MAX_IDENTITY_RECORDS = Math.min(200000, Math.max(1000, positiveInteger(process.env.VOICEUP_MAX_IDENTITIES, 50000)));
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const safeIdentity = (value) => {
  const identity = String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  return ['__proto__', 'prototype', 'constructor'].includes(identity.toLowerCase()) ? '' : identity;
};
const safeDataImage = (value, max = 150000) => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= max ? value : '';
const safeSecretEqual = (left, right) => {
  const first = Buffer.from(String(left || ''), 'utf8');
  const second = Buffer.from(String(right || ''), 'utf8');
  return first.length > 0 && first.length === second.length && crypto.timingSafeEqual(first, second);
};
const identityProofText = (challenge, socketId, room, clientId) => `voiceup-identity-v1\n${challenge}\n${socketId}\n${room}\n${clientId}`;
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
const safeChannelId = (value, fallback = 'canal') => safeRoomId(String(value || fallback).normalize('NFD').replace(/[\u0300-\u036f]/g, '')) || fallback;
const safeChannelList = (values, fallback) => {
  const items = Array.isArray(values) ? values : [];
  const unique = [...new Set(items.map((value) => safeChannel(value, '')).filter(Boolean))].slice(0, 24);
  return unique.length ? unique : [...fallback];
};
const clampNumber = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const hashRoomPassword = (password) => {
  const value = String(password || '');
  if (!value) return '';
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(value, salt, 32);
  return `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`;
};
const verifyRoomPassword = (password, encoded) => {
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/i.exec(String(encoded || ''));
  if (!match) return !encoded;
  try {
    const expected = Buffer.from(match[2], 'hex');
    const actual = crypto.scryptSync(String(password || ''), Buffer.from(match[1], 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
};
const normalizeChannelSettings = (values, type, fallback) => {
  const source = Array.isArray(values) && values.length ? values : fallback;
  const used = new Set();
  return source.slice(0, 48).map((entry, index) => {
    const input = typeof entry === 'string' ? { name: entry } : (entry && typeof entry === 'object' ? entry : {});
    const name = safeChannel(input.name, fallback[index] || `${type === 'voice' ? 'Voz' : 'texto'} ${index + 1}`);
    let id = safeChannelId(input.id || name, `${type}-${index + 1}`);
    while (used.has(id)) id = `${id}-${index + 1}`.slice(0, 48);
    used.add(id);
    const common = {
      id,
      name,
      type,
      position: Math.round(clampNumber(input.position, 0, 999, index)),
      category: String(input.category || input.categoryName || '').trim().slice(0, 36),
      enabled: input.enabled !== false
    };
    if (type === 'voice') return {
      ...common,
      userLimit: Math.round(clampNumber(input.userLimit ?? input.user_limit, 0, 99, 0)),
      bitrateKbps: Math.round(clampNumber(input.bitrateKbps ?? (Number(input.bitrate) / 1000), 8, 510, 64)),
      region: String(input.region || input.rtc_region || 'auto').trim().slice(0, 32) || 'auto',
      locked: Boolean(input.locked)
    };
    return {
      ...common,
      topic: String(input.topic || '').trim().slice(0, 240),
      slowModeSeconds: Math.round(clampNumber(input.slowModeSeconds ?? input.rate_limit_per_user, 0, 21600, 0)),
      readOnly: Boolean(input.readOnly)
    };
  }).filter((channel) => channel.enabled).sort((left, right) => left.position - right.position).map((channel, position) => ({ ...channel, position }));
};
const normalizeRoomLayout = (value = {}, roomId = '') => {
  const voiceInput = Array.isArray(value.voiceChannelSettings) && value.voiceChannelSettings.length ? value.voiceChannelSettings : value.voiceChannels;
  const textInput = Array.isArray(value.textChannelSettings) && value.textChannelSettings.length ? value.textChannelSettings : value.textChannels;
  const voiceChannelSettings = normalizeChannelSettings(voiceInput, 'voice', DEFAULT_ROOM_LAYOUT.voiceChannels);
  const textChannelSettings = normalizeChannelSettings(textInput, 'text', DEFAULT_ROOM_LAYOUT.textChannels);
  const inferredCategoryNames = [...voiceChannelSettings, ...textChannelSettings].map((channel) => channel.category).filter(Boolean);
  const categoryInput = Array.isArray(value.categorySettings) ? value.categorySettings : (Array.isArray(value.categories) ? value.categories : []);
  const categorySettings = [...categoryInput, ...inferredCategoryNames].slice(0, 96).reduce((result, entry, index) => {
    const input = typeof entry === 'string' ? { name: entry } : (entry && typeof entry === 'object' ? entry : {});
    const name = String(input.name || '').trim().slice(0, 36); if (!name || result.some((category) => category.name === name)) return result;
    result.push({ id: safeChannelId(input.id || name, `category-${index + 1}`), name, position: Math.round(clampNumber(input.position, 0, 999, index)) }); return result;
  }, []).sort((left, right) => left.position - right.position).map((category, position) => ({ ...category, position }));
  return {
    id: safeRoomId(value.id || roomId),
    name: String(value.name || roomId || DEFAULT_ROOM_LAYOUT.name).trim().slice(0, 48) || DEFAULT_ROOM_LAYOUT.name,
    template: String(value.template || 'custom').trim().slice(0, 32) || 'custom',
    voiceChannels: safeChannelList(voiceChannelSettings.map((channel) => channel.name), DEFAULT_ROOM_LAYOUT.voiceChannels),
    textChannels: safeChannelList(textChannelSettings.map((channel) => channel.name), DEFAULT_ROOM_LAYOUT.textChannels),
    voiceChannelSettings,
    textChannelSettings,
    categories: categorySettings.map((category) => category.name),
    categorySettings,
    passwordHash: /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(String(value.passwordHash || '')) ? String(value.passwordHash) : '',
    private: Boolean(value.private || value.passwordHash)
  };
};

function startSignalingServer(port = 3000, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '48kb' }));
  const server = http.createServer(app);
  const configuredOrigins = new Set((Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []).map((origin) => String(origin || '').replace(/\/$/, '')).filter(Boolean));
  configuredOrigins.add('https://voiceup.shardweb.app');
  const allowedOrigin = (origin) => {
    const value = String(origin || '').replace(/\/$/, '');
    if (!value || value === 'null' || value === 'file:/' || value === 'file://') return true;
    if (configuredOrigins.has(value)) return true;
    try {
      const target = new URL(value);
      return ['http:', 'https:'].includes(target.protocol) && ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
    } catch { return false; }
  };
  const io = new Server(server, {
    cors: { origin: (origin, callback) => callback(allowedOrigin(origin) ? null : new Error('Origem não autorizada.'), allowedOrigin(origin)), methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin)),
    maxHttpBufferSize: 256 * 1024,
    perMessageDeflate: false
  });
  const startedAt = Date.now();
  const events = { connections: 0, signals: 0, joins: 0, messages: 0, kicks: 0, bans: 0 };
  const normalizeServerIcon = (value) => {
    const icon = String(value || '');
    return /^data:image\/(?:png|jpeg|webp);base64,/i.test(icon) && icon.length <= 60000 ? icon : '';
  };
  let serverProfile = { icon: normalizeServerIcon(options.serverIcon) };
  const logs = [];
  const botSecret = String(options.botToken || '');
  const identityFile = String(options.identityFile || '');
  let identityRegistry = { version: 1, clients: Object.create(null) };
  try {
    const parsed = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
    if (parsed?.clients && typeof parsed.clients === 'object') {
      const clients = Object.create(null);
      for (const [identity, entry] of Object.entries(parsed.clients).slice(0, MAX_IDENTITY_RECORDS)) {
        if (safeIdentity(identity) === identity && entry?.fingerprint) clients[identity] = entry;
      }
      identityRegistry = { version: 1, clients };
    }
  } catch { /* first start or optional in-memory registry */ }
  const persistIdentityRegistry = () => {
    if (!identityFile) return;
    try {
      fs.mkdirSync(path.dirname(identityFile), { recursive: true });
      fs.writeFileSync(identityFile, JSON.stringify(identityRegistry, null, 2), 'utf8');
    } catch (error) { addLog('error', `Não foi possível salvar as identidades protegidas: ${String(error.message || '').slice(0, 140)}`); }
  };
  const issueIdentityChallenge = (socket) => {
    const challenge = crypto.randomBytes(32).toString('base64url');
    socket.data.identityChallenge = challenge;
    socket.data.identityChallengeAt = Date.now();
    socket.emit('identity-challenge', { version: 1, challenge });
  };
  const verifyIdentityProof = (socket, packet, room, identity) => {
    try {
      const challenge = String(packet.identityChallenge || '');
      if (!identity || challenge !== socket.data.identityChallenge || Date.now() - Number(socket.data.identityChallengeAt || 0) > 60000) return { ok: false, reason: 'desafio expirado' };
      const jwk = packet.identityPublicKey && typeof packet.identityPublicKey === 'object' ? packet.identityPublicKey : JSON.parse(String(packet.identityPublicKey || '{}'));
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !/^[a-z0-9_-]{40,60}$/i.test(String(jwk.x || '')) || !/^[a-z0-9_-]{40,60}$/i.test(String(jwk.y || ''))) return { ok: false, reason: 'chave inválida' };
      const normalizedKey = { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) };
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalizedKey)).digest('hex');
      const signature = Buffer.from(String(packet.identityProof || ''), 'base64url');
      if (signature.length !== 64) return { ok: false, reason: 'assinatura inválida' };
      const publicKey = crypto.createPublicKey({ key: normalizedKey, format: 'jwk' });
      const verified = crypto.verify('sha256', Buffer.from(identityProofText(challenge, socket.id, room, identity)), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
      if (!verified) return { ok: false, reason: 'assinatura recusada' };
      const existing = Object.hasOwn(identityRegistry.clients, identity) ? identityRegistry.clients[identity] : null;
      if (existing?.fingerprint && existing.fingerprint !== fingerprint) return { ok: false, reason: 'identidade já protegida por outra chave' };
      if (!existing && Object.keys(identityRegistry.clients).length >= MAX_IDENTITY_RECORDS) return { ok: false, reason: 'limite de identidades protegidas atingido' };
      const now = new Date();
      const shouldPersist = !existing || !Number.isFinite(Date.parse(existing.lastSeenAt || '')) || now.getTime() - Date.parse(existing.lastSeenAt) >= 60 * 60 * 1000;
      identityRegistry.clients[identity] = { fingerprint, publicKey: normalizedKey, createdAt: existing?.createdAt || now.toISOString(), lastSeenAt: shouldPersist ? now.toISOString() : existing.lastSeenAt };
      if (shouldPersist) persistIdentityRegistry();
      socket.data.identityChallenge = '';
      return { ok: true, fingerprint };
    } catch { return { ok: false, reason: 'prova malformada' }; }
  };
  const chatStore = createPersistentChatStore({
    filePath: options.historyFile || path.join(process.cwd(), 'data', 'chat-history.json'),
    maxPerRoom: options.chatMaxPerRoom || 300,
    retentionDays: options.chatRetentionDays || 0
  });
  const reportStore = createBugReportStore({ filePath: options.reportsFile || path.join(process.cwd(), 'data', 'bug-reports.json') });
  const reportRateLimits = new Map();
  const clusterOptions = options.cluster && typeof options.cluster === 'object' ? options.cluster : {};
  const clusterEnabled = clusterOptions.enabled === true;
  const clusterRole = clusterOptions.role === 'secondary' ? 'secondary' : 'primary';
  const clusterNodeId = safeIdentity(clusterOptions.nodeId) || `host-${Math.random().toString(36).slice(2, 10)}`;
  const clusterSecret = String(clusterOptions.secret || '').slice(0, 128);
  const clusterPrimaryUrl = String(clusterOptions.primaryUrl || '').replace(/\/$/, '');
  const clusterPublicUrl = String(clusterOptions.publicUrl || '').trim().replace(/\/$/, '').slice(0, 300);
  const clusterCapacity = Math.round(clampNumber(clusterOptions.capacity, 2, 5000, 100));
  const clusterWeight = clampNumber(clusterOptions.weight, .1, 10, 1);
  const clusterFailover = clusterOptions.failover !== false;
  const clusterSmartDistribution = clusterOptions.smartDistribution !== false;
  const clusterHeartbeatMs = Math.round(clampNumber(clusterOptions.heartbeatMs, 1000, 15000, 3000));
  const remoteMembers = new Map();
  const webrtcTelemetry = new Map();
  const remoteTelemetry = new Map();
  let federationTransport = null;
  let federationRemoteHost = '';
  let federationState = clusterEnabled ? 'aguardando' : 'desativado';
  let federationHeartbeatTimer = null;
  let remoteNodeMetrics = null;
  let localNodeMetrics = { cpuPercent: 0, memoryMb: 0, updatedAt: Date.now() };
  let applyFederatedBans = () => {};
  let currentBanSnapshot = () => [];
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
  const voiceChannelSettings = (layout, channelName) => (layout.voiceChannelSettings || []).find((channel) => channel.name === channelName) || { userLimit: 0, bitrateKbps: 64, region: 'auto', locked: false };
  const voiceChannelLimits = (layout, channelName) => {
    const configured = voiceChannelSettings(layout, channelName);
    const humans = configured.userLimit > 0 ? Math.min(MAX_HUMAN_VOICE_CHANNEL_SIZE, configured.userLimit) : MAX_HUMAN_VOICE_CHANNEL_SIZE;
    return { humans, total: Math.min(MAX_VOICE_CHANNEL_SIZE, humans + Math.max(0, MAX_VOICE_CHANNEL_SIZE - MAX_HUMAN_VOICE_CHANNEL_SIZE)) };
  };
  const publicRoomLayout = (layout) => ({
    ...layout,
    passwordHash: undefined,
    private: Boolean(layout.passwordHash),
    limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE },
    voiceChannelSettings: (layout.voiceChannelSettings || []).map((channel) => ({ ...channel, ...voiceChannelLimits(layout, channel.name) }))
  });
  const publishRoomLayout = (socket) => {
    if (!socket?.data?.room) return;
    socket.emit('room-layout', publicRoomLayout(roomLayout(socket.data.room)));
  };
  const publishServerProfile = (socket) => socket?.emit('server-profile', { ...serverProfile });
  const updateServerProfile = (next = {}) => {
    serverProfile = { icon: normalizeServerIcon(next.icon) };
    io.emit('server-profile', { ...serverProfile });
    return { ...serverProfile };
  };
  setConfiguredRooms(options.roomLayouts);
  const addLog = (level, message) => { logs.unshift({ time: new Date().toLocaleTimeString('pt-BR'), level, message }); if (logs.length > 80) logs.pop(); };
  const consumeRate = (socket, bucket, limit, windowMs) => {
    socket.data.rateLimits ||= new Map();
    const now = Date.now();
    const recent = (socket.data.rateLimits.get(bucket) || []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      if (now - Number(socket.data.lastRateWarningAt || 0) > 2500) {
        socket.data.lastRateWarningAt = now;
        socket.emit('app-error', 'Muitas ações em pouco tempo. Aguarde alguns segundos.');
      }
      socket.data.rateLimits.set(bucket, recent);
      return false;
    }
    recent.push(now); socket.data.rateLimits.set(bucket, recent); return true;
  };
  const finiteMetric = (value, minimum = 0, maximum = 1e12) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : null;
  };
  const sanitizeWebrtcPeer = (value = {}) => ({
    peerId: String(value.peerId || '').slice(0, 180),
    connectionState: String(value.connectionState || 'unknown').slice(0, 24),
    iceConnectionState: String(value.iceConnectionState || 'unknown').slice(0, 24),
    rttMs: finiteMetric(value.rttMs, 0, 60000),
    jitterMs: finiteMetric(value.jitterMs, 0, 60000),
    packetsLost: finiteMetric(value.packetsLost, 0, 1e9),
    inboundKbps: finiteMetric(value.inboundKbps, 0, 1e9) || 0,
    outboundKbps: finiteMetric(value.outboundKbps, 0, 1e9) || 0,
    availableOutgoingKbps: finiteMetric(value.availableOutgoingKbps, 0, 1e9),
    localCandidateType: String(value.localCandidateType || '').slice(0, 24),
    remoteCandidateType: String(value.remoteCandidateType || '').slice(0, 24),
    protocol: String(value.protocol || '').slice(0, 16),
    codec: String(value.codec || '').slice(0, 64)
  });
  const sanitizeWebrtcPacket = (socket, packet = {}) => ({
    socketId: socket.id,
    clientId: socket.data.clientId || '',
    name: socket.data.name || 'Visitante',
    room: socket.data.room || '',
    voiceChannel: socket.data.voiceChannel || LOBBY_CHANNEL,
    sampledAt: Math.min(Date.now() + 5000, Math.max(Date.now() - 60000, Number(packet.sampledAt) || Date.now())),
    receivedAt: Date.now(),
    peers: (Array.isArray(packet.peers) ? packet.peers : []).slice(0, 64).map(sanitizeWebrtcPeer).filter((peer) => peer.peerId)
  });
  const safeClientPlatform = (value) => typeof value === 'string' && ['windows', 'linux', 'android', 'selfweb'].includes(value) ? value : '';
  const safePresenceStatus = (value) => ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
  const safeAudioState = (value) => ({ micMuted: value?.micMuted === true, outputMuted: value?.outputMuted === true });
  const safeMediaState = (value) => ({ screen: value?.screen === true, camera: value?.camera === true });
  const mediaPresence = (value) => value && typeof value === 'object' ? { voiceupMediaState: safeMediaState(value) } : {};
  // A call belongs to the channel, not to the person who first joined it.
  // Keep its start until the LAST member leaves; never persist empty calls.
  const voiceActivityByRoom = new Map();
  const peerSummary = (id, peer = {}) => ({ id, clientId: peer.clientId || '', name: peer.name || 'Visitante', color: peer.color || AVATAR_COLORS[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), platform: safeClientPlatform(peer.platform), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral'), ping: Number.isFinite(peer.ping) ? Math.round(peer.ping) : null, isBot: Boolean(peer.isBot), voiceupAudioState: safeAudioState(peer.voiceupAudioState), ...mediaPresence(peer.voiceupMediaState), callStartedAt: Number(peer.callStartedAt) || voiceActivityByRoom.get(peer.serverRoom)?.get(peer.voiceChannel) || 0 });
  const peersIn = (key) => {
    const local = [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
      const peer = io.sockets.sockets.get(id)?.data || {};
      return peerSummary(id, peer);
    }).filter((peer) => !io.sockets.sockets.get(peer.id)?.data?.isFederation);
    const remote = [...remoteMembers.values()].filter((peer) => peer.serverRoom === key || peer.voiceRoom === key).map((peer) => peerSummary(peer.id, peer));
    return [...local, ...remote];
  };
  const roomPresencePacket = (serverRoom, excludedId) => {
    const members = peersIn(serverRoom).filter((peer) => peer.id !== excludedId);
    const serverTime = Date.now();
    const starts = voiceActivityByRoom.get(serverRoom) || new Map();
    const occupied = new Set(members.map((member) => member.voiceChannel).filter(Boolean));
    for (const channel of starts.keys()) if (!occupied.has(channel)) starts.delete(channel);
    for (const member of members) {
      const channel = member.voiceChannel;
      if (!channel) continue;
      const remoteStart = Number(member.callStartedAt);
      const knownStart = remoteStart > 0 && remoteStart <= serverTime ? remoteStart : serverTime;
      starts.set(channel, Math.min(starts.get(channel) || serverTime, knownStart));
    }
    if (starts.size) voiceActivityByRoom.set(serverRoom, starts); else voiceActivityByRoom.delete(serverRoom);
    return { members, serverTime, voiceActivity: [...starts].map(([voiceChannel, startedAt]) => ({ voiceChannel, startedAt })) };
  };
  const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', roomPresencePacket(serverRoom, excludedId));
  const leaveCurrentMembership = (socket) => {
    const previousServerRoom = socket.data.serverRoom;
    const previousVoiceRoom = socket.data.voiceRoom;
    if (previousVoiceRoom) {
      if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(previousVoiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name || 'Visitante' });
      socket.leave(previousVoiceRoom);
    }
    if (previousServerRoom) socket.leave(previousServerRoom);
    Object.assign(socket.data, { room: '', serverRoom: '', voiceRoom: '', voiceChannel: LOBBY_CHANNEL });
    if (previousServerRoom) broadcastPresence(previousServerRoom, socket.id);
  };
  // A network recovery receives a new Socket.IO id.  The persisted clientId is
  // the durable account identity, so retain the newest session and retire any
  // older socket from that same profile in the same room.
  const duplicateSessionsFor = (room, identity, socketId, isBot = false) => {
    if (!identity || isBot) return [];
    return [...io.sockets.sockets.values()].filter((candidate) => candidate.id !== socketId
      && !candidate.data?.isFederation
      && !candidate.data?.isBot
      && candidate.data?.room === room
      && candidate.data?.clientId === identity);
  };
  const replaceDuplicateSessions = (sessions) => {
    for (const staleSocket of sessions) {
      staleSocket.emit('session-replaced', { message: 'Esta conexão foi substituída por uma reconexão mais recente deste perfil.' });
      staleSocket.disconnect(true);
    }
  };
  const safeMentions = (serverRoom, mentions) => {
    if (!Array.isArray(mentions)) return [];
    const allowed = new Set(peersIn(serverRoom).map((peer) => peer.id));
    return [...new Set(mentions.map(String).filter((id) => allowed.has(id)))].slice(0, 16);
  };
  const stableMentionIds = (serverRoom, mentions) => {
    const allowed = new Set((Array.isArray(mentions) ? mentions : []).map(String));
    return [...new Set(peersIn(serverRoom).filter((peer) => allowed.has(String(peer.id)) && peer.clientId).map((peer) => String(peer.clientId)))].slice(0, 16);
  };
  const historyFor = (room) => chatStore.get(safeRoomId(room));
  const messageById = (room, messageId) => chatStore.find(safeRoomId(room), messageId);
  const rememberMessage = (room, packet) => {
    if (!room || !packet?.messageId || !packet?.text) return null;
    const stored = { ...packet, reactions: packet.reactions && typeof packet.reactions === 'object' ? packet.reactions : {}, pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '' };
    return chatStore.remember(safeRoomId(room), stored);
  };
  const forgetMessage = (room, messageId) => chatStore.forget(safeRoomId(room), messageId);
  const safeReply = (room, reply) => {
    const source = reply?.messageId ? messageById(room, reply.messageId) : null;
    return source ? { messageId: source.messageId, name: String(source.name || 'Mensagem').slice(0, 24), text: String(source.text || '').slice(0, 120) } : null;
  };
  const musicFolder = options.musicDirectory || path.join(__dirname, 'music');
  fs.mkdirSync(musicFolder, { recursive: true });
  const musicFiles = () => fs.readdirSync(musicFolder).filter((name) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const federationId = (socketId) => `fed:${clusterNodeId}:${socketId}`;
  const exportMember = (socket) => ({ id: federationId(socket.id), localId: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), room: socket.data.room || '', serverRoom: socket.data.serverRoom || '', voiceRoom: socket.data.voiceRoom || '', voiceChannel: socket.data.voiceChannel || LOBBY_CHANNEL, ping: Number.isFinite(socket.data.ping) ? Math.round(socket.data.ping) : null, isBot: Boolean(socket.data.isBot), joinedAt: socket.data.joinedAt || Date.now(), voiceupAudioState: safeAudioState(socket.data.voiceupAudioState), ...mediaPresence(socket.data.voiceupMediaState), callStartedAt: voiceActivityByRoom.get(socket.data.serverRoom)?.get(socket.data.voiceChannel) || 0 });
  const localClientSockets = () => [...io.sockets.sockets.values()].filter((socket) => socket.data.room && !socket.data.isFederation);
  const sendFederation = (event, payload) => { if (federationTransport?.connected) federationTransport.emit(event, payload); };
  const nodeLoadScore = (node = {}) => {
    const participants = Math.max(0, Number(node.participants) || 0);
    const capacity = Math.max(1, Number(node.capacity) || clusterCapacity);
    const weight = Math.max(.1, Number(node.weight) || 1);
    const cpu = Math.max(0, Number(node.cpuPercent) || 0) / 100;
    const memoryPressure = Math.max(0, Math.min(1, Number(node.memoryPressure) || 0));
    return Math.round(((participants / capacity) / weight * .66 + cpu * .24 + memoryPressure * .1) * 1000) / 1000;
  };
  const localNodeSnapshot = () => ({
    nodeId: clusterNodeId,
    role: clusterRole,
    publicUrl: clusterPublicUrl,
    participants: localClientSockets().length,
    capacity: clusterCapacity,
    weight: clusterWeight,
    cpuPercent: finiteMetric(localNodeMetrics.cpuPercent, 0, 100) || 0,
    memoryMb: finiteMetric(localNodeMetrics.memoryMb, 0, 1e7) || 0,
    memoryPressure: finiteMetric(localNodeMetrics.memoryPressure, 0, 1) || 0,
    updatedAt: Date.now()
  });
  const remoteNodeHealthy = () => Boolean(remoteNodeMetrics && Date.now() - Number(remoteNodeMetrics.receivedAt || 0) <= Math.max(9000, clusterHeartbeatMs * 3));
  const sendClusterHeartbeat = () => sendFederation('federation:heartbeat', { hostId: clusterNodeId, node: localNodeSnapshot() });
  const clusterAlternates = () => {
    if (!clusterEnabled) return [];
    if (clusterRole === 'primary') return remoteNodeHealthy() && /^https?:\/\//i.test(remoteNodeMetrics.publicUrl || '') ? [{ nodeId: remoteNodeMetrics.nodeId, url: remoteNodeMetrics.publicUrl, role: remoteNodeMetrics.role || 'secondary', score: nodeLoadScore(remoteNodeMetrics) }] : [];
    const primaryPublicUrl = remoteNodeHealthy() && /^https?:\/\//i.test(remoteNodeMetrics?.publicUrl || '') ? remoteNodeMetrics.publicUrl : clusterPrimaryUrl;
    return /^https?:\/\//i.test(primaryPublicUrl) ? [{ nodeId: federationRemoteHost || 'primary', url: primaryPublicUrl, role: 'primary', score: remoteNodeHealthy() ? nodeLoadScore(remoteNodeMetrics) : null }] : [];
  };
  const clusterRoutePacket = () => ({ nodeId: clusterNodeId, currentUrl: clusterPublicUrl, alternates: clusterAlternates(), failover: clusterFailover, smartDistribution: clusterSmartDistribution });
  const publishClusterRoute = (socket) => socket.emit('cluster-route', clusterRoutePacket());
  let publishedClusterRouteSignature = '';
  const publishClusterRoutes = (force = false) => {
    const packet = clusterRoutePacket();
    const signature = JSON.stringify({ currentUrl: packet.currentUrl, failover: packet.failover, alternates: packet.alternates.map(({ nodeId, url, role }) => ({ nodeId, url, role })) });
    if (!force && signature === publishedClusterRouteSignature) return 0;
    publishedClusterRouteSignature = signature;
    const sockets = localClientSockets();
    sockets.forEach((socket) => socket.emit('cluster-route', packet));
    return sockets.length;
  };
  const redirectClientsForShutdown = () => {
    if (!clusterEnabled || !clusterFailover) return { ok: false, redirected: 0, message: 'Failover não está ativo.' };
    const alternate = clusterAlternates().find((node) => /^https?:\/\//i.test(node?.url || ''));
    if (!alternate) return { ok: false, redirected: 0, message: 'Nenhum host alternativo saudável está disponível.' };
    const sockets = localClientSockets().filter((socket) => Array.isArray(socket.data.capabilities) && socket.data.capabilities.includes('cluster-routing'));
    sockets.forEach((socket) => socket.emit('cluster-redirect', { ...alternate, sourceNodeId: clusterNodeId, reason: 'O host atual será desligado · migrando para o host alternativo…' }));
    addLog('cluster', `${sockets.length} Client(s) avisado(s) para migrar ao host ${alternate.nodeId || alternate.url}`);
    return { ok: true, redirected: sockets.length, alternate };
  };
  const shouldRedirectToRemote = (capabilities = []) => {
    if (!clusterEnabled || clusterRole !== 'primary' || !clusterSmartDistribution || !remoteNodeHealthy()) return null;
    if (!Array.isArray(capabilities) || !capabilities.includes('cluster-routing')) return null;
    if (!/^https?:\/\//i.test(remoteNodeMetrics.publicUrl || '')) return null;
    const local = localNodeSnapshot();
    const localScore = nodeLoadScore(local); const remoteScore = nodeLoadScore(remoteNodeMetrics);
    if (local.participants < 2 || remoteNodeMetrics.participants >= remoteNodeMetrics.capacity) return null;
    return remoteScore + .08 < localScore ? { url: remoteNodeMetrics.publicUrl, nodeId: remoteNodeMetrics.nodeId, reason: 'O outro host possui menor carga no momento.', localScore, remoteScore } : null;
  };
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
    const member = { id, localId: String(value.localId || ''), clientId: safeIdentity(value.clientId), name: String(value.name || 'Visitante').slice(0, 24), color: AVATAR_COLORS.includes(value.color) ? value.color : AVATAR_COLORS[0], avatar: typeof value.avatar === 'string' && value.avatar.startsWith('data:image/') && value.avatar.length <= 150000 ? value.avatar : '', status: safePresenceStatus(value.status), platform: safeClientPlatform(value.platform), ping: Number.isFinite(value.ping) ? Math.round(value.ping) : null, room, serverRoom: serverKey(room), voiceChannel, voiceRoom: voiceKey(room, voiceChannel), isBot: Boolean(value.isBot), joinedAt: Number(value.joinedAt) || Date.now(), remote: true };
    member.voiceupAudioState = safeAudioState(value.voiceupAudioState);
    Object.assign(member, mediaPresence(value.voiceupMediaState));
    member.callStartedAt = Number.isFinite(value.callStartedAt) && value.callStartedAt > 0 ? Math.min(Date.now(), value.callStartedAt) : 0;
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
  const normalizeRemoteTelemetryPacket = (packet = {}, remoteHost = federationRemoteHost) => {
    const host = safeIdentity(remoteHost); if (!host || !packet?.socketId) return null;
    const federate = (id) => String(id || '').startsWith('fed:') ? String(id) : `fed:${host}:${String(id || '')}`;
    return { ...packet, socketId: federate(packet.socketId), peers: (Array.isArray(packet.peers) ? packet.peers : []).map((peer) => ({ ...peer, peerId: federate(peer.peerId) })), remote: true, receivedAt: Date.now() };
  };
  const applyFederatedLayouts = (rooms) => {
    if (clusterRole !== 'secondary' || !Array.isArray(rooms)) return;
    setConfiguredRooms(rooms);
    for (const socket of localClientSockets()) publishRoomLayout(socket);
  };
  const sendFederationSnapshot = () => sendFederation('federation:snapshot', { hostId: clusterNodeId, members: localClientSockets().map(exportMember), roomLayouts: [...configuredRooms.values()], bans: currentBanSnapshot(), node: localNodeSnapshot(), telemetry: [...webrtcTelemetry.values()] });
  const bindFederationTransport = (transport, remoteHint = '') => {
    federationTransport = transport; federationRemoteHost = safeIdentity(remoteHint);
    transport.on('federation:snapshot', ({ hostId, members, roomLayouts, bans, node, telemetry } = {}) => {
      const remoteHost = safeIdentity(hostId); if (!remoteHost || remoteHost === clusterNodeId) return;
      clearRemoteHost(remoteHost); federationRemoteHost = remoteHost;
      (Array.isArray(members) ? members : []).forEach(upsertRemoteMember);
      applyFederatedLayouts(roomLayouts);
      if (clusterRole === 'secondary') applyFederatedBans(bans);
      remoteNodeMetrics = node && typeof node === 'object' ? { ...node, nodeId: safeIdentity(node.nodeId || remoteHost), receivedAt: Date.now() } : remoteNodeMetrics;
      remoteTelemetry.clear();
      (Array.isArray(telemetry) ? telemetry : []).forEach((packet) => { const normalized = normalizeRemoteTelemetryPacket(packet, remoteHost); if (normalized) remoteTelemetry.set(normalized.socketId, normalized); });
      federationState = 'conectado'; publishClusterRoutes(); addLog('cluster', `Host ${remoteHost} sincronizado`);
    });
    transport.on('federation:layouts', ({ hostId, roomLayouts } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) applyFederatedLayouts(roomLayouts); });
    transport.on('federation:bans', ({ hostId, bans } = {}) => {
      if (safeIdentity(hostId) === clusterNodeId) return;
      applyFederatedBans(bans);
      if (clusterRole === 'primary') sendFederation('federation:bans', { hostId: clusterNodeId, bans: currentBanSnapshot() });
    });
    transport.on('federation:heartbeat', ({ hostId, node } = {}) => {
      const remoteHost = safeIdentity(hostId); if (!remoteHost || remoteHost === clusterNodeId || !node || typeof node !== 'object') return;
      federationRemoteHost = remoteHost;
      remoteNodeMetrics = { ...node, nodeId: safeIdentity(node.nodeId || remoteHost), publicUrl: String(node.publicUrl || '').replace(/\/$/, '').slice(0, 300), receivedAt: Date.now() };
      federationState = 'conectado';
      publishClusterRoutes();
    });
    transport.on('federation:telemetry', ({ hostId, packet } = {}) => {
      const remoteHost = safeIdentity(hostId); if (remoteHost === clusterNodeId || !packet?.socketId) return;
      const normalized = normalizeRemoteTelemetryPacket(packet, remoteHost); if (normalized) remoteTelemetry.set(normalized.socketId, normalized);
    });
    transport.on('federation:member', ({ hostId, member } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) upsertRemoteMember(member); });
    transport.on('federation:left', ({ hostId, id } = {}) => { if (safeIdentity(hostId) !== clusterNodeId) removeRemoteMember(String(id || '')); });
    transport.on('federation:signal', ({ target, origin, data } = {}) => {
      const socket = io.sockets.sockets.get(localizeFederatedId(target));
      if (!socket?.data?.serverRoom || socket.data.serverRoom !== serverKey(origin?.room)) return;
      events.signals += 1;
      socket.emit('signal', { from: String(origin.id || ''), name: origin.name || 'Visitante', color: origin.color || AVATAR_COLORS[0], avatar: origin.avatar || '', status: safePresenceStatus(origin.status), platform: safeClientPlatform(origin.platform), data });
    });
    transport.on('federation:moderate', ({ target, action, message, expiresAt, reason } = {}) => {
      const localId = localizeFederatedId(target);
      if (!io.sockets.sockets.has(localId) || !['kicked', 'banned'].includes(action)) return;
      disconnectMember(localId, action, '', { message, expiresAt, reason });
    });
    transport.on('federation:text', ({ room, packet } = {}) => {
      const targetRoom = serverKey(safeRoomId(room)); if (!packet?.text || !room) return;
      const mentions = Array.isArray(packet.mentions) ? packet.mentions.map(localizeFederatedId) : [];
      const localized = { ...packet, mentions };
      rememberMessage(room, localized);
      io.to(targetRoom).emit('text-message', localized);
    });
    transport.on('federation:edit', ({ room, packet } = {}) => {
      const targetRoom = serverKey(safeRoomId(room)); if (!packet?.messageId || !room) return;
      const mentions = Array.isArray(packet.mentions) ? packet.mentions.map(localizeFederatedId) : [];
      const localized = { ...packet, mentions }; const stored = messageById(room, packet.messageId);
      if (stored) { Object.assign(stored, { text: localized.text, editedAt: localized.editedAt, mentions }); chatStore.touch(); }
      io.to(targetRoom).emit('message-edited', localized);
    });
    transport.on('federation:reaction', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      const stored = messageById(room, packet.messageId); if (stored) { stored.reactions = packet.reactions || {}; chatStore.touch(); }
      io.to(serverKey(safeRoomId(room))).emit('message-reaction', packet);
    });
    transport.on('federation:pin', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      const stored = messageById(room, packet.messageId); if (stored) { Object.assign(stored, { pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '' }); chatStore.touch(); }
      io.to(serverKey(safeRoomId(room))).emit('message-pinned', packet);
    });
    transport.on('federation:delete', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      forgetMessage(room, packet.messageId);
      io.to(serverKey(safeRoomId(room))).emit('message-deleted', packet);
    });
    transport.on('disconnect', () => {
      federationState = clusterRole === 'secondary' && clusterFailover ? 'failover ativo' : 'desconectado'; clearRemoteHost(); federationTransport = null; remoteNodeMetrics = null; remoteTelemetry.clear(); publishClusterRoutes(true);
      addLog('cluster', clusterRole === 'secondary' && clusterFailover ? 'Host primário indisponível; o secundário assumiu as conexões locais' : 'Ligação com o outro host foi perdida');
    });
  };

  const bansFile = options.bansFile || '';
  const banned = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(bansFile, 'utf8'));
    if (Array.isArray(saved)) saved.forEach((entry) => {
      const clientId = safeIdentity(entry?.clientId); if (!clientId) return;
      banned.set(clientId, { clientId, name: String(entry.name || 'Visitante').slice(0, 24), reason: String(entry.reason || '').slice(0, 160), bannedAt: entry.bannedAt || new Date().toISOString(), expiresAt: entry.expiresAt || null });
    });
  } catch { /* first start or invalid optional file */ }
  const persistBans = () => {
    if (!bansFile) return;
    try { fs.mkdirSync(path.dirname(bansFile), { recursive: true }); fs.writeFileSync(bansFile, JSON.stringify([...banned.values()], null, 2), 'utf8'); } catch (error) { addLog('error', `Não foi possível salvar banimentos: ${error.message}`); }
  };
  const pruneExpiredBans = ({ broadcast = true } = {}) => {
    const now = Date.now(); let changed = false;
    for (const [clientId, entry] of banned) {
      const expiry = entry.expiresAt ? Date.parse(entry.expiresAt) : NaN;
      if (Number.isFinite(expiry) && expiry <= now) { banned.delete(clientId); changed = true; addLog('ban', `Banimento temporário de ${entry.name || 'participante'} expirou`); }
    }
    if (changed) {
      persistBans();
      if (broadcast) sendFederation('federation:bans', { hostId: clusterNodeId, bans: [...banned.values()] });
    }
    return changed;
  };
  currentBanSnapshot = () => { pruneExpiredBans({ broadcast: false }); return [...banned.values()]; };
  applyFederatedBans = (values) => {
    if (!Array.isArray(values)) return;
    const next = new Map();
    values.slice(0, 10000).forEach((entry) => {
      const clientId = safeIdentity(entry?.clientId); if (!clientId) return;
      const expiresAt = entry.expiresAt || null; const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
      if (Number.isFinite(expiry) && expiry <= Date.now()) return;
      next.set(clientId, { clientId, name: String(entry.name || 'Visitante').slice(0, 24), reason: String(entry.reason || '').slice(0, 160), bannedAt: entry.bannedAt || new Date().toISOString(), expiresAt });
    });
    banned.clear(); next.forEach((entry, clientId) => banned.set(clientId, entry)); persistBans();
  };
  pruneExpiredBans({ broadcast: false });
  const publishNotice = (room, text) => {
    if (!room) return;
    const packet = { from: `server:${clusterNodeId}`, messageId: `server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), text, textChannel: 'geral', name: 'VoiceUP Server', color: '#ff8b72', reactions: {}, pinned: false };
    rememberMessage(room, packet);
    io.to(serverKey(room)).emit('text-message', packet);
    sendFederation('federation:text', { hostId: clusterNodeId, room, packet });
  };

  const plugins = loadPlugins({
    directories: options.pluginDirectories || [path.join(__dirname, 'plugins')],
    trustedPluginHashes: options.trustedPluginHashes || [],
    trustedPluginDirectories: options.trustedPluginDirectories || [],
    stateFile: options.pluginStateFile || '',
    addLog,
    emitSystemMessage: ({ room, textChannel, text, name, color, avatar, pluginId }) => {
      if (!room || !text) return;
      events.messages += 1;
      const packet = { from: `plugin:${clusterNodeId}:${pluginId || 'server'}`, messageId: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), text, textChannel, name, color, avatar: avatar || '', pluginId };
      rememberMessage(room, packet);
      io.to(serverKey(room)).emit('text-message', packet);
      sendFederation('federation:text', { hostId: clusterNodeId, room, packet });
    },
    emitPluginEvent: (event) => options.onPluginEvent?.(event),
    media: { list: musicFiles, url: () => '' }
  });

  app.use('/api/bug-reports', (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    next();
  });
  app.options('/api/bug-reports', (_req, res) => res.sendStatus(204));
  app.post('/api/bug-reports', (req, res) => {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const recent = (reportRateLimits.get(key) || []).filter((time) => now - time < 600000);
    if (recent.length >= 4) return res.status(429).json({ ok: false, message: 'Aguarde alguns minutos antes de enviar outro relatório.' });
    const report = reportStore.add(req.body || {});
    if (!report) return res.status(400).json({ ok: false, message: 'Descreva o problema encontrado.' });
    recent.push(now); reportRateLimits.set(key, recent);
    addLog('report', `Novo relatório de ${report.name || 'cliente'} · ${report.id}`);
    return res.status(201).json({ ok: true, id: report.id, message: 'Relatório enviado ao responsável por este servidor.' });
  });
  const publicStatus = () => ({
    ok: true,
    app: 'VoiceUP Server',
    version: String(options.version || ''),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    participants: localClientSockets().filter((client) => !client.data.isBot).length,
    activeRooms: new Set(localClientSockets().map((client) => client.data.room).filter(Boolean)).size,
    cluster: { enabled: clusterEnabled, role: clusterRole, state: federationState },
    limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE }
  });
  app.get(['/health', '/api/status'], (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(publicStatus()); });
  io.on('connection', (socket) => {
    const federationAuth = socket.handshake?.auth || {};
    if (federationAuth.voiceupFederation) {
      const allowed = clusterEnabled && clusterRole === 'primary' && safeSecretEqual(federationAuth.secret, clusterSecret);
      if (!allowed) { addLog('cluster', 'Pareamento de host recusado'); socket.disconnect(true); return; }
      socket.data.isFederation = true;
      const remoteHost = safeIdentity(federationAuth.hostId);
      remoteNodeMetrics = {
        nodeId: remoteHost,
        role: 'secondary',
        publicUrl: String(federationAuth.publicUrl || '').trim().replace(/\/$/, '').slice(0, 300),
        capacity: Math.round(clampNumber(federationAuth.capacity, 2, 5000, 100)),
        weight: clampNumber(federationAuth.weight, .1, 10, 1),
        participants: 0,
        receivedAt: Date.now()
      };
      bindFederationTransport(socket, remoteHost);
      federationState = 'conectado';
      addLog('cluster', `Host secundário ${remoteHost || 'sem identificação'} conectado`);
      sendFederationSnapshot(); sendClusterHeartbeat(); publishClusterRoutes(true);
      return;
    }
    events.connections += 1; addLog('info', 'Novo cliente conectado');
    socket.on('identity-challenge-request', () => { if (consumeRate(socket, 'identity-challenge', 8, 60000)) issueIdentityChallenge(socket); });
    socket.on('join-room', (payload = {}) => {
      if (!payload || typeof payload !== 'object' || !consumeRate(socket, 'join', 12, 60000)) return;
      const { roomId, roomPassword, voiceChannel, name, color, avatar, bot, botToken, clientId, status, capabilities } = payload;
      const room = safeRoomId(roomId);
      const layout = roomLayout(room);
      const requestedVoiceChannel = safeChannel(voiceChannel, LOBBY_CHANNEL);
      const voiceChannelName = requestedVoiceChannel === LOBBY_CHANNEL || layout.voiceChannels.includes(requestedVoiceChannel) ? requestedVoiceChannel : layout.voiceChannels[0];
      const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
      const identity = safeIdentity(clientId);
      const isBot = bot === true && safeSecretEqual(botToken, botSecret);
      if (bot === true && !isBot) {
        addLog('security', `Identificação de bot recusada para ${safeName}`);
        socket.emit('app-error', 'Credencial interna de bot inválida.');
        return setTimeout(() => socket.disconnect(true), 120);
      }
      if (!room) return socket.emit('app-error', 'Informe um código de sala.');
      const safeCapabilities = Array.isArray(capabilities) ? [...new Set(capabilities.map((value) => String(value || '').trim().slice(0, 48)).filter(Boolean))].slice(0, 16) : [];
      const supportsIdentityProof = safeCapabilities.includes('identity-proof-v1');
      let identityFingerprint = '';
      if (!isBot && supportsIdentityProof) {
        const proof = verifyIdentityProof(socket, payload, room, identity);
        if (!proof.ok) {
          socket.emit('identity-proof-required', { message: `Não foi possível confirmar a identidade deste perfil (${proof.reason}).` });
          issueIdentityChallenge(socket);
          return;
        }
        identityFingerprint = proof.fingerprint;
      } else if (!isBot && identity && identityRegistry.clients[identity]?.fingerprint) {
        socket.emit('identity-proof-required', { message: 'Este perfil já usa identidade protegida. Atualize o VoiceUP para continuar com ele.' });
        return;
      }
      if (layout.passwordHash && !isBot && !verifyRoomPassword(roomPassword, layout.passwordHash)) {
        socket.emit('room-password-required', { roomId: room, message: 'Esta sala é privada. Informe a senha correta.' });
        return socket.emit('app-error', 'Esta sala é privada. Informe a senha correta.');
      }
      pruneExpiredBans();
      if (!isBot && identity && banned.has(identity)) {
        const entry = banned.get(identity); const temporary = Boolean(entry.expiresAt);
        const expiresText = temporary ? ` até ${new Date(entry.expiresAt).toLocaleString('pt-BR')}` : '';
        socket.emit('server-action', { action: 'banned', message: `Você foi banido deste Server Host${expiresText}.${entry.reason ? ` Motivo: ${entry.reason}` : ''}`, expiresAt: entry.expiresAt, reason: entry.reason || '' });
        addLog('ban', `${safeName} tentou entrar, mas está banido`);
        return setTimeout(() => socket.disconnect(true), 120);
      }
      const redirect = !isBot ? shouldRedirectToRemote(capabilities) : null;
      if (redirect) {
        socket.emit('cluster-redirect', { ...redirect, sourceNodeId: clusterNodeId });
        addLog('cluster', `${safeName} direcionado ao host ${redirect.nodeId}`);
        return;
      }
      const serverRoom = serverKey(room); const voiceRoom = voiceKey(room, voiceChannelName);
      const staleSessions = duplicateSessionsFor(room, identity, socket.id, isBot);
      const staleSessionIds = new Set(staleSessions.map((candidate) => candidate.id));
      const voiceSettings = voiceChannelSettings(layout, voiceChannelName); const limits = voiceChannelLimits(layout, voiceChannelName);
      if (voiceChannelName !== LOBBY_CHANNEL && voiceSettings.locked && !isBot) return socket.emit('app-error', 'Este canal de voz está fechado pelo ServerHost.');
      const activeVoicePeers = peersIn(voiceRoom).filter((peer) => peer.id !== socket.id && !staleSessionIds.has(peer.id));
      if (voiceChannelName !== LOBBY_CHANNEL && activeVoicePeers.length >= limits.total) return socket.emit('app-error', `O canal de voz já possui o limite de ${limits.total} pessoas.`);
      const regularPeers = activeVoicePeers.filter((peer) => !peer.isBot);
      if (voiceChannelName !== LOBBY_CHANNEL && !isBot && regularPeers.length >= limits.humans) return socket.emit('app-error', `O canal de voz atingiu o limite de ${limits.humans} pessoas.`);
      const usedColors = peersIn(serverRoom).filter((peer) => !staleSessionIds.has(peer.id)).map((peer) => peer.color);
      const requestedColor = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
      const safeColor = usedColors.includes(requestedColor) ? AVATAR_COLORS.find((candidate) => !usedColors.includes(candidate)) || requestedColor : requestedColor;
      const safeAvatar = safeDataImage(avatar);
      leaveCurrentMembership(socket);
      socket.join(serverRoom); socket.join(voiceRoom);
      Object.assign(socket.data, { room, serverRoom, voiceRoom, voiceChannel: voiceChannelName, name: safeName, color: safeColor, avatar: safeAvatar, status: safePresenceStatus(status), platform: safeClientPlatform(payload.platform), clientId: identity, identityFingerprint, identityVerified: Boolean(identityFingerprint), capabilities: safeCapabilities, isBot, joinedAt: Date.now() });
      replaceDuplicateSessions(staleSessions);
      socket.emit('color-assigned', { color: safeColor }); events.joins += 1; addLog('join', `${safeName} entrou em ${room} / ${voiceChannelName}`);
      publishRoomLayout(socket);
      publishServerProfile(socket);
      const peers = voiceChannelName === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id && !staleSessionIds.has(peer.id));
      socket.emit('room-joined', { roomId: room, voiceChannel: voiceChannelName, peers, limits: publicRoomLayout(layout).limits, serverProfile: { ...serverProfile } });
      socket.emit('chat-history', { messages: historyFor(room) });
      publishClusterRoute(socket);
      if (voiceChannelName !== LOBBY_CHANNEL) socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar, clientId: identity, status: socket.data.status, platform: safeClientPlatform(socket.data.platform) });
      broadcastPresence(serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('request-room-presence', () => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'presence-request', 20, 10000)) return;
      socket.emit('room-presence', roomPresencePacket(socket.data.serverRoom));
    });
    socket.on('presence-update', ({ status, platform } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'presence-update', 20, 30000)) return;
      const next = status === undefined ? socket.data.status : safePresenceStatus(status);
      const nextPlatform = safeClientPlatform(platform) || safeClientPlatform(socket.data.platform);
      if (next === socket.data.status && nextPlatform === socket.data.platform) return;
      socket.data.status = next;
      socket.data.platform = nextPlatform;
      broadcastPresence(socket.data.serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('media-state-update', (value = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'media-state-update', 40, 10000)) return;
      const state = safeMediaState(value);
      const previous = socket.data.voiceupMediaState;
      if (previous && state.screen === previous.screen && state.camera === previous.camera) return;
      socket.data.voiceupMediaState = state;
      broadcastPresence(socket.data.serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('audio-state-update', (value = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'audio-state-update', 40, 10000)) return;
      const state = safeAudioState(value);
      const previous = safeAudioState(socket.data.voiceupAudioState);
      if (state.micMuted === previous.micMuted && state.outputMuted === previous.outputMuted) return;
      socket.data.voiceupAudioState = state;
      broadcastPresence(socket.data.serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('switch-voice-channel', ({ voiceChannel } = {}) => {
      if (!socket.data.room || !consumeRate(socket, 'voice-switch', 16, 30000)) return;
      const layout = roomLayout(socket.data.room);
      const requestedChannel = safeChannel(voiceChannel, layout.voiceChannels[0]);
      const channel = requestedChannel === LOBBY_CHANNEL || layout.voiceChannels.includes(requestedChannel) ? requestedChannel : layout.voiceChannels[0];
      const nextVoiceRoom = voiceKey(socket.data.room, channel);
      if (nextVoiceRoom === socket.data.voiceRoom) return;
      const settings = voiceChannelSettings(layout, channel); const limits = voiceChannelLimits(layout, channel);
      if (channel !== LOBBY_CHANNEL && settings.locked && !socket.data.isBot) return socket.emit('app-error', 'Este canal de voz está fechado pelo ServerHost.');
      if (channel !== LOBBY_CHANNEL && peersIn(nextVoiceRoom).length >= limits.total) return socket.emit('app-error', `O canal de voz já possui o limite de ${limits.total} pessoas.`);
      const regularPeers = peersIn(nextVoiceRoom).filter((peer) => !peer.isBot);
      if (channel !== LOBBY_CHANNEL && !socket.data.isBot && regularPeers.length >= limits.humans) return socket.emit('app-error', `O canal de voz atingiu o limite de ${limits.humans} pessoas.`);
      if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
      socket.leave(socket.data.voiceRoom);
      socket.join(nextVoiceRoom); socket.data.voiceRoom = nextVoiceRoom; socket.data.voiceChannel = channel;
      const peers = channel === LOBBY_CHANNEL ? [] : peersIn(nextVoiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers, limits: publicRoomLayout(layout).limits, serverProfile: { ...serverProfile } });
      if (channel !== LOBBY_CHANNEL) socket.to(nextVoiceRoom).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar, clientId: socket.data.clientId || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform) });
      broadcastPresence(socket.data.serverRoom); addLog('channel', channel === LOBBY_CHANNEL ? `${socket.data.name} saiu da call` : `${socket.data.name} mudou para ${channel}`);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('text-message', ({ text, textChannel, messageId, createdAt, mentions, reply } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'text', 30, 10000)) return;
      const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
      events.messages += 1;
      const layout = roomLayout(socket.data.room);
      const requestedTextChannel = safeChannel(textChannel, layout.textChannels[0]);
      const safeTextChannel = layout.textChannels.includes(requestedTextChannel) ? requestedTextChannel : layout.textChannels[0];
      const textSettings = (layout.textChannelSettings || []).find((channel) => channel.name === safeTextChannel) || { readOnly: false, slowModeSeconds: 0 };
      if (textSettings.readOnly && !socket.data.isBot) return socket.emit('app-error', 'Este canal de texto é somente leitura.');
      socket.data.lastTextAt ||= new Map();
      const lastTextAt = Number(socket.data.lastTextAt.get(safeTextChannel) || 0);
      const waitMs = Math.max(0, Number(textSettings.slowModeSeconds || 0) * 1000 - (Date.now() - lastTextAt));
      if (!socket.data.isBot && waitMs > 0) return socket.emit('app-error', `Modo lento ativo. Aguarde ${Math.ceil(waitMs / 1000)}s.`);
      socket.data.lastTextAt.set(safeTextChannel, Date.now());
      const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
      const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
      const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
      const replyPacket = safeReply(socket.data.room, reply);
      socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds, mentionClientIds });
      if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
      const packet = { from: socket.id, authorClientId: socket.data.clientId || '', authorIdentityFingerprint: socket.data.identityFingerprint || '', messageId: id, createdAt: sentAt, text: safeText, textChannel: safeTextChannel, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', mentions: safeMentionIds, mentionClientIds, reply: replyPacket, reactions: {}, pinned: false };
      rememberMessage(socket.data.room, packet);
      io.to(socket.data.serverRoom).emit('text-message', packet);
      sendFederation('federation:text', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
      plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0] }, serverIsCloud: false });
    });
    socket.on('edit-message', ({ messageId, text, textChannel, mentions } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-edit', 24, 10000)) return;
      const id = String(messageId || ''); const stored = messageById(socket.data.room, id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
      const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
      if ((!known && !ownsMessage) || !safeText || safeChannel(textChannel, 'geral') !== (stored?.textChannel || known?.textChannel)) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
      const editedAt = Date.now(); const safeMentionIds = safeMentions(socket.data.serverRoom, mentions); const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
      if (known) Object.assign(known, { mentions: safeMentionIds, mentionClientIds });
      if (stored) { Object.assign(stored, { text: safeText, editedAt, mentions: safeMentionIds, mentionClientIds }); chatStore.touch(); }
      const packet = { from: socket.id, messageId: id, text: safeText, textChannel: stored?.textChannel || known.textChannel, editedAt, mentions: safeMentionIds, mentionClientIds };
      io.to(socket.data.serverRoom).emit('message-edited', packet);
      sendFederation('federation:edit', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
    });
    socket.on('react-message', ({ messageId, emoji } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-reaction', 40, 10000)) return;
      const stored = messageById(socket.data.room, messageId); const safeEmoji = String(emoji || '').trim().slice(0, 12);
      if (!stored || !safeEmoji) return socket.emit('app-error', 'Não foi possível reagir a essa mensagem.');
      stored.reactions ||= {};
      const actor = socket.data.identityFingerprint ? `key:${socket.data.identityFingerprint}` : (socket.data.clientId || socket.id); const actors = new Set(Array.isArray(stored.reactions[safeEmoji]) ? stored.reactions[safeEmoji] : []);
      if (actors.has(actor)) actors.delete(actor); else actors.add(actor);
      if (actors.size) stored.reactions[safeEmoji] = [...actors]; else delete stored.reactions[safeEmoji];
      chatStore.touch();
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel, reactions: stored.reactions };
      io.to(socket.data.serverRoom).emit('message-reaction', packet);
      sendFederation('federation:reaction', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('pin-message', ({ messageId, pinned } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-pin', 20, 10000)) return;
      const stored = messageById(socket.data.room, messageId); if (!stored) return socket.emit('app-error', 'Mensagem não encontrada.');
      stored.pinned = Boolean(pinned); stored.pinnedBy = socket.data.clientId || socket.id;
      chatStore.touch();
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel, pinned: stored.pinned, pinnedBy: stored.pinnedBy };
      io.to(socket.data.serverRoom).emit('message-pinned', packet);
      sendFederation('federation:pin', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('delete-message', ({ messageId } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-delete', 20, 10000)) return;
      const stored = messageById(socket.data.room, messageId);
      const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
      if (!ownsMessage) return socket.emit('app-error', 'Você só pode apagar suas próprias mensagens.');
      forgetMessage(socket.data.room, stored.messageId); socket.data.chatMessages?.delete(stored.messageId);
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel };
      io.to(socket.data.serverRoom).emit('message-deleted', packet);
      sendFederation('federation:delete', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('signal', ({ target, data } = {}) => {
      if (!target || !socket.data.serverRoom || !consumeRate(socket, 'signal', 360, 10000)) return;
      try { if (Buffer.byteLength(JSON.stringify(data || {}), 'utf8') > 64 * 1024) return socket.emit('app-error', 'Pacote de conexão grande demais.'); } catch { return; }
      const targetSocket = io.sockets.sockets.get(String(target));
      if (targetSocket && targetSocket.data.serverRoom === socket.data.serverRoom) {
        events.signals += 1;
        targetSocket.emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), data });
        return;
      }
      const remote = remoteMembers.get(String(target));
      if (!remote || remote.serverRoom !== socket.data.serverRoom) return;
      events.signals += 1;
      sendFederation('federation:signal', { hostId: clusterNodeId, target: remote.id, origin: exportMember(socket), data });
    });
    socket.on('latency-ping', ({ sentAt } = {}) => { if (consumeRate(socket, 'latency', 20, 10000)) socket.emit('latency-pong', { sentAt }); });
    socket.on('server-pong', ({ sentAt } = {}) => { if (!consumeRate(socket, 'server-pong', 30, 10000)) return; const ping = Date.now() - Number(sentAt); if (Number.isFinite(ping) && ping >= 0 && ping < 10000) socket.data.ping = ping; });
    socket.on('webrtc-stats', (packet = {}) => {
      if (!socket.data.serverRoom || socket.data.isBot || !consumeRate(socket, 'webrtc-stats', 12, 30000)) return;
      const sanitized = sanitizeWebrtcPacket(socket, packet);
      webrtcTelemetry.set(socket.id, sanitized);
      sendFederation('federation:telemetry', { hostId: clusterNodeId, packet: sanitized });
    });
    socket.on('disconnecting', () => { webrtcTelemetry.delete(socket.id); if (socket.data.voiceRoom) { addLog('leave', `${socket.data.name || 'Cliente'} saiu da sala`); if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); } if (socket.data.serverRoom) { broadcastPresence(socket.data.serverRoom, socket.id); sendFederation('federation:left', { hostId: clusterNodeId, id: federationId(socket.id) }); } });
  });

  const members = () => [
    ...localClientSockets().map((socket) => ({ id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), ping: Number.isFinite(socket.data.ping) ? Math.round(socket.data.ping) : null, room: socket.data.room || '', voiceChannel: socket.data.voiceChannel || '', isBot: Boolean(socket.data.isBot), remote: false, connectedSeconds: socket.data.joinedAt ? Math.floor((Date.now() - socket.data.joinedAt) / 1000) : 0 })),
    ...[...remoteMembers.values()].map((member) => ({ ...member, remote: true, connectedSeconds: member.joinedAt ? Math.floor((Date.now() - member.joinedAt) / 1000) : 0 }))
  ];
  const updateRoomLayouts = (rooms = []) => {
    setConfiguredRooms(rooms);
    for (const socket of io.sockets.sockets.values()) publishRoomLayout(socket);
    if (clusterRole === 'primary') sendFederation('federation:layouts', { hostId: clusterNodeId, roomLayouts: [...configuredRooms.values()] });
    addLog('rooms', 'Estrutura de salas e canais atualizada');
    return [...configuredRooms.values()];
  };
  const disconnectMember = (id, action, notice, details = {}) => {
    const socket = io.sockets.sockets.get(String(id || ''));
    if (!socket || socket.data.isBot) return { ok: false, message: 'Participante não encontrado.' };
    const name = socket.data.name || 'Participante'; const room = socket.data.room;
    socket.emit('server-action', { action, message: details.message || (action === 'banned' ? 'Você foi banido deste Server Host.' : 'Você foi expulso pelo Server Host.'), expiresAt: details.expiresAt || null, reason: details.reason || '' });
    publishNotice(room, notice || `${name} foi removido pelo Server Host.`);
    setTimeout(() => socket.disconnect(true), 120);
    addLog(action === 'banned' ? 'ban' : 'kick', `${name}: ${action}`);
    return { ok: true, message: action === 'banned' ? `${name} foi banido.` : `${name} foi expulso.` };
  };
  const kick = (id) => {
    events.kicks += 1;
    const remote = remoteMembers.get(String(id || ''));
    if (remote) { sendFederation('federation:moderate', { hostId: clusterNodeId, target: remote.id, action: 'kicked' }); addLog('kick', `${remote.name || 'Participante'}: remoção enviada ao outro host`); return { ok: true, message: `${remote.name || 'Participante'} será expulso pelo host conectado.` }; }
    return disconnectMember(id, 'kicked');
  };
  const ban = (id, options = {}) => {
    const targetId = String(id || ''); const socket = io.sockets.sockets.get(targetId); const remote = remoteMembers.get(targetId);
    const identity = safeIdentity(socket?.data?.clientId || remote?.clientId);
    if (!identity) return { ok: false, message: 'Este cliente é antigo e não pode receber banimento persistente. Peça para atualizar o Client.' };
    const durationMinutes = Math.round(clampNumber(options.durationMinutes, 0, 525600, 0));
    const reason = String(options.reason || '').trim().slice(0, 160);
    const expiresAt = durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
    const targetName = socket?.data?.name || remote?.name || 'Visitante';
    const entry = { clientId: identity, name: targetName, reason, bannedAt: new Date().toISOString(), expiresAt };
    banned.set(identity, entry); persistBans(); events.bans += 1;
    sendFederation('federation:bans', { hostId: clusterNodeId, bans: [...banned.values()] });
    const expiryText = expiresAt ? ` até ${new Date(expiresAt).toLocaleString('pt-BR')}` : ' permanentemente';
    const userMessage = `Você foi banido deste Server Host${expiryText}.${reason ? ` Motivo: ${reason}` : ''}`;
    if (remote) {
      sendFederation('federation:moderate', { hostId: clusterNodeId, target: remote.id, action: 'banned', message: userMessage, expiresAt, reason });
      addLog('ban', `${targetName}: banimento enviado ao outro host`);
      return { ok: true, message: `${targetName} será banido pelo host conectado.` };
    }
    return disconnectMember(id, 'banned', `${targetName} foi banido pelo Server Host.`, { message: userMessage, expiresAt, reason });
  };
  const unban = (clientId) => { const identity = safeIdentity(clientId); if (!identity || !banned.has(identity)) return { ok: false, message: 'Banimento não encontrado.' }; const name = banned.get(identity).name || 'Participante'; banned.delete(identity); persistBans(); sendFederation('federation:bans', { hostId: clusterNodeId, bans: [...banned.values()] }); addLog('ban', `${name} foi desbanido`); return { ok: true, message: `${name} pode entrar novamente.` }; };
  const getStats = () => {
    pruneExpiredBans();
    const voiceRooms = new Set([...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('voice:') && !key.endsWith(`:${LOBBY_CHANNEL}`) && value.size > 0).map(([key]) => key));
    for (const member of remoteMembers.values()) if (member.voiceChannel !== LOBBY_CHANNEL) voiceRooms.add(member.voiceRoom);
    const pings = localClientSockets().map((socket) => socket.data.ping).filter(Number.isFinite);
    for (const socket of localClientSockets()) socket.emit('server-ping', { sentAt: Date.now() });
    const allMembers = members();
    const memberIndex = new Map(allMembers.map((member) => [String(member.id), member]));
    const recentTelemetry = [...webrtcTelemetry.values(), ...remoteTelemetry.values()].filter((packet) => Date.now() - Number(packet.receivedAt || 0) < 15000);
    const connections = recentTelemetry.flatMap((packet) => (packet.peers || []).map((peer) => ({
      sourceId: packet.socketId,
      sourceName: packet.name,
      targetId: peer.peerId,
      targetName: memberIndex.get(String(peer.peerId))?.name || 'Participante',
      room: packet.room,
      voiceChannel: packet.voiceChannel === LOBBY_CHANNEL ? '' : packet.voiceChannel,
      remoteHost: Boolean(packet.remote),
      sampledAt: packet.sampledAt,
      ...peer
    })));
    const bandwidth = connections.reduce((total, connection) => ({ inboundKbps: total.inboundKbps + Number(connection.inboundKbps || 0), outboundKbps: total.outboundKbps + Number(connection.outboundKbps || 0) }), { inboundKbps: 0, outboundKbps: 0 });
    bandwidth.inboundKbps = Math.round(bandwidth.inboundKbps); bandwidth.outboundKbps = Math.round(bandwidth.outboundKbps); bandwidth.totalKbps = bandwidth.inboundKbps + bandwidth.outboundKbps;
    const localNode = localNodeSnapshot(); const remoteHealthy = remoteNodeHealthy();
    const clusterNodes = [
      { ...localNode, state: 'online', score: nodeLoadScore(localNode), local: true },
      ...(remoteNodeMetrics ? [{ ...remoteNodeMetrics, state: remoteHealthy ? 'online' : 'offline', score: nodeLoadScore(remoteNodeMetrics), local: false }] : [])
    ];
    return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), participants: allMembers.length, localParticipants: localClientSockets().length, rooms: voiceRooms.size, maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE, maxHumanVoiceChannelSize: MAX_HUMAN_VOICE_CHANNEL_SIZE, roomLayouts: [...configuredRooms.values()].map(publicRoomLayout), storage: { chat: chatStore.stats(), reports: reportStore.stats() }, reports: reportStore.list(20), cluster: { enabled: clusterEnabled, role: clusterRole, nodeId: clusterNodeId, state: federationState, remoteHost: federationRemoteHost, remoteParticipants: remoteMembers.size, failover: clusterFailover, smartDistribution: clusterSmartDistribution, publicUrl: clusterPublicUrl, capacity: clusterCapacity, weight: clusterWeight, nodes: clusterNodes, alternates: clusterAlternates() }, webrtc: { supportedClients: recentTelemetry.length, unsupportedClients: Math.max(0, allMembers.filter((member) => !member.isBot).length - recentTelemetry.length), connections, sampledAt: Date.now() }, bandwidth, averagePing: pings.length ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length) : null, events, logs, plugins: plugins.list(), pluginErrors: plugins.errors(), members: allMembers, bans: [...banned.values()] };
  };
  const cleanupMessages = (options = {}) => ({ ok: true, ...chatStore.cleanup(options), storage: chatStore.stats() });
  const configureChatStorage = (settings = {}) => ({ ok: true, ...chatStore.configure(settings), storage: chatStore.stats() });
  const listReports = (limit = 50) => reportStore.list(limit);
  const clearReports = () => ({ ok: true, removed: reportStore.clear() });
  const startSecondaryFederation = () => {
    if (!clusterEnabled || clusterRole !== 'secondary') return;
    if (!clusterPrimaryUrl || !clusterSecret) { federationState = 'configuração incompleta'; addLog('cluster', 'Informe URL primária e chave para ligar o host secundário'); return; }
    const transport = createSocketClient(clusterPrimaryUrl, { transports: ['websocket', 'polling'], timeout: 10000, reconnection: true, auth: { voiceupFederation: true, hostId: clusterNodeId, secret: clusterSecret, publicUrl: clusterPublicUrl, capacity: clusterCapacity, weight: clusterWeight } });
    bindFederationTransport(transport);
    transport.on('connect', () => { federationTransport = transport; federationState = 'conectado'; addLog('cluster', 'Ligação com host primário estabelecida'); sendFederationSnapshot(); sendClusterHeartbeat(); publishClusterRoutes(true); });
    transport.on('connect_error', (error) => { federationState = clusterFailover ? 'failover ativo' : 'erro'; addLog('cluster', `Host primário indisponível: ${error.message}`); });
  };
  const updateNodeMetrics = (next = {}) => { localNodeMetrics = { ...localNodeMetrics, cpuPercent: finiteMetric(next.cpuPercent, 0, 100) || 0, memoryMb: finiteMetric(next.memoryMb, 0, 1e7) || 0, memoryPressure: finiteMetric(next.memoryPressure, 0, 1) || 0, updatedAt: Date.now() }; return localNodeSnapshot(); };
  const closeFederation = () => { clearInterval(federationHeartbeatTimer); federationHeartbeatTimer = null; const transport = federationTransport; federationTransport = null; transport?.disconnect?.(); clearRemoteHost(''); remoteTelemetry.clear(); };
  if (clusterEnabled) federationHeartbeatTimer = setInterval(sendClusterHeartbeat, clusterHeartbeatMs);
  server.on('close', () => { closeFederation(); chatStore.close(); reportStore.close(); });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { addLog('info', `Servidor iniciado na porta ${port}`); startSecondaryFederation(); resolve({ server, io, port, getStats, members, kick, ban, unban, updateRoomLayouts, updateNodeMetrics, updateServerProfile, redirectClientsForShutdown, closeFederation, cleanupMessages, configureChatStorage, listReports, clearReports, configurePlugin: plugins.configure, pluginAction: plugins.action }); }); });
}
module.exports = { startSignalingServer, DEFAULT_ROOM_LAYOUT, normalizeRoomLayout, normalizeChannelSettings, hashRoomPassword, verifyRoomPassword };
