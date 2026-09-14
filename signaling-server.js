const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: createSocketClient } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createAttachmentService } = require('./server-attachments');
const { loadPlugins } = require('./plugin-runtime');
const { createPersistentChatStore, createBugReportStore } = require('./persistent-storage');
const {
  PERMISSION_DEFINITIONS,
  normalizeAccessControl,
  accessForClient,
  upsertRole,
  deleteRole,
  assignRoles,
  createSecurityAuditStore,
  safeRoleId
} = require('./server-access-control');

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
const TEXT_FILE_MAX_CHARACTERS = 30000;
const TEXT_FILE_MAX_BYTES = 64 * 1024;
const safeTextFileName = (value) => {
  const withoutPath = String(value || 'mensagem.txt').split(/[\\/]/).pop() || 'mensagem.txt';
  const cleaned = withoutPath.replace(/[\u0000-\u001f<>:"|?*]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'mensagem';
  return /\.txt$/i.test(cleaned) ? cleaned : `${cleaned.replace(/\.+$/g, '') || 'mensagem'}.txt`;
};
const safeTextFile = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const content = String(value.content ?? '').replaceAll('\u0000', ''); const size = Buffer.byteLength(content, 'utf8');
  if (!content.trim() || content.length > TEXT_FILE_MAX_CHARACTERS || size > TEXT_FILE_MAX_BYTES) return null;
  return { name: safeTextFileName(value.name), content, size, type: 'text/plain' };
};
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
const safeForumThreadId = (value) => safeChannelId(String(value || '').replace(/^thread-/, ''), '').slice(0, 64);
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
      // An empty list intentionally means "visible to everyone" so rooms saved
      // by older ServerHosts keep exactly the same behaviour after updating.
      visibleRoleIds: [...new Set((Array.isArray(input.visibleRoleIds) ? input.visibleRoleIds : [])
        .map(safeRoleId).filter(Boolean))].slice(0, 64),
      enabled: input.enabled !== false
    };
    if (type === 'voice') return {
      ...common,
      kind: ['voice', 'stage', 'dynamic'].includes(String(input.kind || input.channelKind || '')) ? String(input.kind || input.channelKind) : 'voice',
      userLimit: Math.round(clampNumber(input.userLimit ?? input.user_limit, 0, 99, 0)),
      bitrateKbps: Math.round(clampNumber(input.bitrateKbps ?? (Number(input.bitrate) / 1000), 8, 510, 64)),
      region: String(input.region || input.rtc_region || 'auto').trim().slice(0, 32) || 'auto',
      locked: Boolean(input.locked)
    };
    return {
      ...common,
      kind: String(input.kind || input.channelKind) === 'forum' ? 'forum' : 'text',
      topic: String(input.topic || '').trim().slice(0, 240),
      slowModeSeconds: Math.round(clampNumber(input.slowModeSeconds ?? input.rate_limit_per_user, 0, 21600, 0)),
      readOnly: Boolean(input.readOnly),
      forumTags: [...new Set((Array.isArray(input.forumTags) ? input.forumTags : String(input.forumTags || '').split(','))
        .map((tag) => String(tag || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24)).filter(Boolean))].slice(0, 16),
      forumSort: input.forumSort === 'newest' ? 'newest' : 'recent'
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
  const runtimeOption = (value) => typeof value === 'function' ? value() : value;
  const chatPolicy = () => ({
    cooldownSeconds: Math.round(clampNumber(runtimeOption(options.chatCooldownSeconds), 0, 21600, 0)),
    pluginMessageMaxLength: Math.round(clampNumber(runtimeOption(options.pluginMessageMaxLength), 500, 10000, 2000))
  });
  const events = { connections: 0, signals: 0, joins: 0, messages: 0, kicks: 0, bans: 0, chatPunishments: 0 };
  const normalizeServerIcon = (value) => {
    const icon = String(value || '');
    return /^data:image\/(?:png|jpeg|webp);base64,/i.test(icon) && icon.length <= 60000 ? icon : '';
  };
  let serverProfile = { icon: normalizeServerIcon(options.serverIcon) };
  const logs = [];
  const auditStore = options.auditStore || createSecurityAuditStore({ filePath: options.auditFile || '' });
  let accessControl = normalizeAccessControl(options.accessControl);
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
  let applyFederatedPunishments = () => {};
  let currentPunishmentSnapshot = () => [];
  let configuredRooms = new Map();
  // Dynamic channels live only in memory.  They are deliberately kept out of
  // the saved room layout: after the last person leaves, the call disappears
  // without leaving stale channels behind in a ServerHost backup.
  const dynamicVoiceChannels = new Map();
  const setConfiguredRooms = (rooms = []) => {
    configuredRooms = new Map((Array.isArray(rooms) ? rooms : []).map((room) => {
      const normalized = normalizeRoomLayout(room);
      return [normalized.id.toLowerCase(), normalized];
    }).filter(([id]) => id));
  };
  const roomLayout = (roomId) => {
    const id = safeRoomId(roomId);
    const configured = configuredRooms.get(id.toLowerCase());
    const base = configured || normalizeRoomLayout({ id, name: id || DEFAULT_ROOM_LAYOUT.name }, id);
    const dynamic = [...(dynamicVoiceChannels.get(id)?.values() || [])];
    return dynamic.length
      ? {
          ...base,
          voiceChannels: [...base.voiceChannels, ...dynamic.map((channel) => channel.name)],
          voiceChannelSettings: [...base.voiceChannelSettings, ...dynamic],
          managed: Boolean(configured)
        }
      : { ...base, managed: Boolean(configured) };
  };
  const memberAccess = (peer = {}) => {
    const access = accessForClient(accessControl, peer.identityVerified === true ? peer.clientId : '');
    return { roleIds: access.roleIds, roles: access.roles, primaryRole: access.primaryRole, permissions: access.permissions };
  };
  const channelSettings = (layout, type, channelName) => ((type === 'voice' ? layout.voiceChannelSettings : layout.textChannelSettings) || []).find((channel) => channel.name === channelName);
  const canViewChannel = (layout, type, channelName, peer = {}) => {
    if (type === 'voice' && channelName === LOBBY_CHANNEL) return true;
    const settings = channelSettings(layout, type, channelName);
    if (!settings) return false;
    const required = Array.isArray(settings.visibleRoleIds) ? settings.visibleRoleIds : [];
    if (!required.length || peer.isBot === true) return true;
    const access = memberAccess(peer);
    return (peer.identityVerified === true && access.permissions.includes('manageChannels'))
      || access.roleIds.some((roleId) => required.includes(roleId));
  };
  const visibleChannels = (layout, type, peer = {}) => {
    const names = type === 'voice' ? layout.voiceChannels : layout.textChannels;
    return names.filter((name) => canViewChannel(layout, type, name, peer));
  };
  const voiceChannelSettings = (layout, channelName) => channelSettings(layout, 'voice', channelName) || { userLimit: 0, bitrateKbps: 64, region: 'auto', locked: false, visibleRoleIds: [] };
  const voiceChannelLimits = (layout, channelName) => {
    const configured = voiceChannelSettings(layout, channelName);
    const humans = configured.userLimit > 0 ? Math.min(MAX_HUMAN_VOICE_CHANNEL_SIZE, configured.userLimit) : MAX_HUMAN_VOICE_CHANNEL_SIZE;
    return { humans, total: Math.min(MAX_VOICE_CHANNEL_SIZE, humans + Math.max(0, MAX_VOICE_CHANNEL_SIZE - MAX_HUMAN_VOICE_CHANNEL_SIZE)) };
  };
  const publicRoomLayout = (layout, peer = null) => {
    const voiceNames = peer ? visibleChannels(layout, 'voice', peer) : [...layout.voiceChannels];
    const textNames = peer ? visibleChannels(layout, 'text', peer) : [...layout.textChannels];
    const canManage = peer?.identityVerified === true && memberAccess(peer).permissions.includes('manageChannels');
    const exposeChannel = (channel) => {
      const result = { ...channel };
      if (peer && !canManage) delete result.visibleRoleIds;
      return result;
    };
    const voiceChannelSettingsList = (layout.voiceChannelSettings || [])
      .filter((channel) => voiceNames.includes(channel.name))
      .map((channel) => ({ ...exposeChannel(channel), ...voiceChannelLimits(layout, channel.name) }));
    const textChannelSettingsList = (layout.textChannelSettings || [])
      .filter((channel) => textNames.includes(channel.name))
      .map(exposeChannel);
    const visibleCategories = new Set([...voiceChannelSettingsList, ...textChannelSettingsList].map((channel) => channel.category).filter(Boolean));
    return {
      ...layout,
      passwordHash: undefined,
      private: Boolean(layout.passwordHash),
      limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE },
      voiceChannels: voiceNames,
      textChannels: textNames,
      voiceChannelSettings: voiceChannelSettingsList,
      textChannelSettings: textChannelSettingsList,
      categories: (layout.categories || []).filter((category) => visibleCategories.has(category)),
      categorySettings: (layout.categorySettings || []).filter((category) => visibleCategories.has(category.name))
    };
  };
  const publishRoomLayout = (socket) => {
    if (!socket?.data?.room) return;
    socket.emit('room-layout', publicRoomLayout(roomLayout(socket.data.room), socket.data));
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
  const safePresenceStatus = (value) => ['online', 'idle', 'activity', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
  const safeAudioState = (value) => ({ micMuted: value?.micMuted === true, outputMuted: value?.outputMuted === true });
  const safeMediaState = (value) => ({ screen: value?.screen === true, camera: value?.camera === true });
  const mediaPresence = (value) => value && typeof value === 'object' ? { voiceupMediaState: safeMediaState(value) } : {};
  const actorSnapshot = (socket) => {
    const access = memberAccess(socket?.data || {});
    return { kind: 'client', clientId: socket?.data?.clientId || '', name: socket?.data?.name || 'Visitante', roleIds: access.roleIds };
  };
  const hasPermission = (socket, permission) => socket?.data?.identityVerified === true && memberAccess(socket.data).permissions.includes(permission);
  const rolePosition = (role) => Number.isFinite(Number(role?.position)) ? Number(role.position) : 0;
  const highestRolePosition = (peer = {}) => Math.max(...memberAccess(peer).roles.map(rolePosition), 0);
  const canManageRolePosition = (socket, position) => highestRolePosition(socket?.data || {}) > rolePosition({ position });
  const canManageMember = (socket, peer = {}) => highestRolePosition(socket?.data || {}) > highestRolePosition(peer);
  const denyPermission = (socket, action, permission, respond) => {
    const message = 'Você não tem permissão para realizar esta ação.';
    socket?.emit('app-error', message);
    auditStore.record(action, actorSnapshot(socket), {}, { requiredPermission: permission }, 'denied');
    if (typeof respond === 'function') respond({ ok: false, message });
    return false;
  };
  const denyHierarchy = (socket, action, target = {}, respond) => {
    const message = 'A hierarquia de cargos não permite esta ação.';
    socket?.emit('app-error', message);
    auditStore.record(action, actorSnapshot(socket), { clientId: target.clientId || '', name: target.name || '', roleId: target.roleId || '' }, { reason: 'role-hierarchy' }, 'denied');
    if (typeof respond === 'function') respond({ ok: false, message });
    return false;
  };
  // A call belongs to the channel, not to the person who first joined it.
  // Keep its start until the LAST member leaves; never persist empty calls.
  const voiceActivityByRoom = new Map();
  const peerSummary = (id, peer = {}) => ({ id, clientId: peer.clientId || '', name: peer.name || 'Visitante', color: peer.color || AVATAR_COLORS[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), platform: safeClientPlatform(peer.platform), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral'), ping: Number.isFinite(peer.ping) ? Math.round(peer.ping) : null, isBot: Boolean(peer.isBot), identityVerified: peer.identityVerified === true, ...memberAccess(peer), voiceupAudioState: safeAudioState(peer.voiceupAudioState), ...mediaPresence(peer.voiceupMediaState), callStartedAt: Number(peer.callStartedAt) || voiceActivityByRoom.get(peer.serverRoom)?.get(peer.voiceChannel) || 0 });
  const peersIn = (key) => {
    const local = [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
      const peer = io.sockets.sockets.get(id)?.data || {};
      return peerSummary(id, peer);
    }).filter((peer) => !io.sockets.sockets.get(peer.id)?.data?.isFederation);
    const remote = [...remoteMembers.values()].filter((peer) => peer.serverRoom === key || peer.voiceRoom === key).map((peer) => peerSummary(peer.id, peer));
    return [...local, ...remote];
  };
  const roomPresencePacket = (serverRoom, excludedId, viewer = null) => {
    const allMembers = peersIn(serverRoom).filter((peer) => peer.id !== excludedId);
    const serverTime = Date.now();
    const starts = voiceActivityByRoom.get(serverRoom) || new Map();
    const occupied = new Set(allMembers.map((member) => member.voiceChannel).filter(Boolean));
    for (const channel of starts.keys()) if (!occupied.has(channel)) starts.delete(channel);
    for (const member of allMembers) {
      const channel = member.voiceChannel;
      if (!channel) continue;
      const remoteStart = Number(member.callStartedAt);
      const knownStart = remoteStart > 0 && remoteStart <= serverTime ? remoteStart : serverTime;
      starts.set(channel, Math.min(starts.get(channel) || serverTime, knownStart));
    }
    if (starts.size) voiceActivityByRoom.set(serverRoom, starts); else voiceActivityByRoom.delete(serverRoom);
    const room = String(serverRoom || '').replace(/^server:/, '');
    const layout = roomLayout(room);
    const members = viewer ? allMembers.map((member) => {
      if (!member.voiceChannel || canViewChannel(layout, 'voice', member.voiceChannel, viewer)) return member;
      return { ...member, voiceChannel: '', callStartedAt: 0, hiddenVoiceChannel: true };
    }) : allMembers;
    const voiceActivity = [...starts]
      .filter(([voiceChannel]) => !viewer || canViewChannel(layout, 'voice', voiceChannel, viewer))
      .map(([voiceChannel, startedAt]) => ({ voiceChannel, startedAt }));
    return { members, serverTime, voiceActivity };
  };
  const broadcastPresence = (serverRoom, excludedId) => {
    for (const client of localClientSockets().filter((candidate) => candidate.data.serverRoom === serverRoom && candidate.id !== excludedId)) {
      client.emit('room-presence', roomPresencePacket(serverRoom, excludedId, client.data));
    }
  };
  const leaveCurrentMembership = (socket) => {
    const previousRoom = socket.data.room;
    const previousServerRoom = socket.data.serverRoom;
    const previousVoiceRoom = socket.data.voiceRoom;
    if (previousVoiceRoom) {
      if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(previousVoiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name || 'Visitante' });
      socket.leave(previousVoiceRoom);
    }
    if (previousServerRoom) socket.leave(previousServerRoom);
    Object.assign(socket.data, { room: '', serverRoom: '', voiceRoom: '', voiceChannel: LOBBY_CHANNEL });
    if (previousRoom) cleanupDynamicVoiceChannels(previousRoom);
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
  const safeReply = (room, reply, viewer = null) => {
    const source = reply?.messageId ? messageById(room, reply.messageId) : null;
    if (!source || (viewer && !canViewChannel(roomLayout(room), 'text', source.textChannel, viewer))) return null;
    return { messageId: source.messageId, name: String(source.name || 'Mensagem').slice(0, 24), text: String(source.text || '').slice(0, 120) };
  };
  const musicFolder = options.musicDirectory || path.join(__dirname, 'music');
  fs.mkdirSync(musicFolder, { recursive: true });
  const musicFiles = () => fs.readdirSync(musicFolder).filter((name) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const federationId = (socketId) => `fed:${clusterNodeId}:${socketId}`;
  const exportMember = (socket) => ({ id: federationId(socket.id), localId: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), room: socket.data.room || '', serverRoom: socket.data.serverRoom || '', voiceRoom: socket.data.voiceRoom || '', voiceChannel: socket.data.voiceChannel || LOBBY_CHANNEL, ping: Number.isFinite(socket.data.ping) ? Math.round(socket.data.ping) : null, isBot: Boolean(socket.data.isBot), identityVerified: socket.data.identityVerified === true, ...memberAccess(socket.data), joinedAt: socket.data.joinedAt || Date.now(), voiceupAudioState: safeAudioState(socket.data.voiceupAudioState), ...mediaPresence(socket.data.voiceupMediaState), callStartedAt: voiceActivityByRoom.get(socket.data.serverRoom)?.get(socket.data.voiceChannel) || 0 });
  const localClientSockets = () => [...io.sockets.sockets.values()].filter((socket) => socket.data.room && !socket.data.isFederation);
  const emitToVisibleTextChannel = (room, event, packet = {}) => {
    const safeRoom = safeRoomId(room);
    const layout = roomLayout(safeRoom);
    const textChannel = String(packet.textChannel || layout.textChannels[0] || '');
    for (const client of localClientSockets().filter((candidate) => candidate.data.room === safeRoom)) {
      if (canViewChannel(layout, 'text', textChannel, client.data)) client.emit(event, packet);
    }
  };
  const serverAccessPacket = (socket) => {
    const access = memberAccess(socket?.data || {});
    return {
      version: 1,
      identityVerified: socket?.data?.identityVerified === true,
      roleIds: access.roleIds,
      roles: access.roles,
      permissions: access.permissions,
      availableRoles: accessControl.roles.map((role) => ({ ...role, permissions: [...role.permissions] })),
      permissionDefinitions: PERMISSION_DEFINITIONS.map((permission) => ({ ...permission })),
      capabilities: { manageChatPolicy: typeof options.onChatPolicyChange === 'function' },
      serverSettings: access.permissions.includes('manageServer') ? { chatPolicy: chatPolicy() } : null
    };
  };
  const publishServerAccess = (socket) => { if (socket?.data?.serverRoom) socket.emit('server-access', serverAccessPacket(socket)); };
  const publishAllServerAccess = () => {
    for (const socket of localClientSockets()) { publishServerAccess(socket); publishRoomLayout(socket); }
    for (const room of new Set(localClientSockets().map((socket) => socket.data.serverRoom).filter(Boolean))) broadcastPresence(room);
  };
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
  const sendFederationSnapshot = () => sendFederation('federation:snapshot', { hostId: clusterNodeId, members: localClientSockets().map(exportMember), roomLayouts: [...configuredRooms.values()], bans: currentBanSnapshot(), chatPunishments: currentPunishmentSnapshot(), node: localNodeSnapshot(), telemetry: [...webrtcTelemetry.values()] });
  const bindFederationTransport = (transport, remoteHint = '') => {
    federationTransport = transport; federationRemoteHost = safeIdentity(remoteHint);
    transport.on('federation:snapshot', ({ hostId, members, roomLayouts, bans, chatPunishments, node, telemetry } = {}) => {
      const remoteHost = safeIdentity(hostId); if (!remoteHost || remoteHost === clusterNodeId) return;
      clearRemoteHost(remoteHost); federationRemoteHost = remoteHost;
      (Array.isArray(members) ? members : []).forEach(upsertRemoteMember);
      applyFederatedLayouts(roomLayouts);
      if (clusterRole === 'secondary') { applyFederatedBans(bans); applyFederatedPunishments(chatPunishments); }
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
    transport.on('federation:chat-punishments', ({ hostId, chatPunishments } = {}) => {
      if (safeIdentity(hostId) === clusterNodeId) return;
      applyFederatedPunishments(chatPunishments);
      if (clusterRole === 'primary') sendFederation('federation:chat-punishments', { hostId: clusterNodeId, chatPunishments: currentPunishmentSnapshot() });
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
      if (!socket?.data?.serverRoom || socket.data.serverRoom !== serverKey(origin?.room) || socket.data.voiceRoom !== origin?.voiceRoom || socket.data.voiceChannel === LOBBY_CHANNEL) return;
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
      const textFile = safeTextFile(packet.textFile); const localized = { ...packet, mentions, ...(textFile ? { textFile } : {}) };
      if (!textFile) delete localized.textFile;
      rememberMessage(room, localized);
      emitToVisibleTextChannel(room, 'text-message', localized);
    });
    transport.on('federation:edit', ({ room, packet } = {}) => {
      const targetRoom = serverKey(safeRoomId(room)); if (!packet?.messageId || !room) return;
      const mentions = Array.isArray(packet.mentions) ? packet.mentions.map(localizeFederatedId) : [];
      const localized = { ...packet, mentions }; const stored = messageById(room, packet.messageId);
      if (stored) { Object.assign(stored, { text: localized.text, editedAt: localized.editedAt, mentions }); chatStore.touch(); }
      emitToVisibleTextChannel(room, 'message-edited', localized);
    });
    transport.on('federation:reaction', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      const stored = messageById(room, packet.messageId); if (stored) { stored.reactions = packet.reactions || {}; chatStore.touch(); }
      emitToVisibleTextChannel(room, 'message-reaction', packet);
    });
    transport.on('federation:pin', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      const stored = messageById(room, packet.messageId); if (stored) { Object.assign(stored, { pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '' }); chatStore.touch(); }
      emitToVisibleTextChannel(room, 'message-pinned', packet);
    });
    transport.on('federation:delete', ({ room, packet } = {}) => {
      if (!room || !packet?.messageId) return;
      forgetMessage(room, packet.messageId);
      emitToVisibleTextChannel(room, 'message-deleted', packet);
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
  const punishmentsFile = options.punishmentsFile || '';
  const chatPunishments = new Map();
  const normalizePunishment = (entry = {}) => {
    const clientId = safeIdentity(entry.clientId); if (!clientId) return null;
    const expiresAt = entry.expiresAt || null; const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
    if (Number.isFinite(expiry) && expiry <= Date.now()) return null;
    return { clientId, name: String(entry.name || 'Visitante').slice(0, 24), reason: String(entry.reason || '').slice(0, 160), punishedAt: entry.punishedAt || new Date().toISOString(), expiresAt };
  };
  try {
    const saved = JSON.parse(fs.readFileSync(punishmentsFile, 'utf8'));
    if (Array.isArray(saved)) saved.slice(0, 10000).forEach((entry) => { const normalized = normalizePunishment(entry); if (normalized) chatPunishments.set(normalized.clientId, normalized); });
  } catch { /* first start or invalid optional file */ }
  const persistChatPunishments = () => {
    if (!punishmentsFile) return;
    try { fs.mkdirSync(path.dirname(punishmentsFile), { recursive: true }); fs.writeFileSync(punishmentsFile, JSON.stringify([...chatPunishments.values()], null, 2), 'utf8'); } catch (error) { addLog('error', `Não foi possível salvar castigos: ${error.message}`); }
  };
  const pruneExpiredPunishments = ({ broadcast = true } = {}) => {
    const now = Date.now(); let changed = false;
    for (const [clientId, entry] of chatPunishments) {
      const expiry = entry.expiresAt ? Date.parse(entry.expiresAt) : NaN;
      if (Number.isFinite(expiry) && expiry <= now) { chatPunishments.delete(clientId); changed = true; addLog('punishment', `Castigo de ${entry.name || 'participante'} expirou`); }
    }
    if (changed) {
      persistChatPunishments();
      if (broadcast) sendFederation('federation:chat-punishments', { hostId: clusterNodeId, chatPunishments: [...chatPunishments.values()] });
    }
    return changed;
  };
  const punishmentMessage = (entry) => {
    const expiry = entry?.expiresAt ? ` até ${new Date(entry.expiresAt).toLocaleString('pt-BR')}` : '';
    return `Você está de castigo e não pode enviar mensagens${expiry}.${entry?.reason ? ` Motivo: ${entry.reason}` : ''}`;
  };
  const notifyPunishedClients = (entry) => {
    if (!entry?.clientId) return;
    localClientSockets().filter((socket) => !socket.data.isBot && socket.data.clientId === entry.clientId).forEach((socket) => socket.emit('app-error', punishmentMessage(entry)));
  };
  currentPunishmentSnapshot = () => { pruneExpiredPunishments({ broadcast: false }); return [...chatPunishments.values()]; };
  applyFederatedPunishments = (values) => {
    if (!Array.isArray(values)) return;
    const next = new Map();
    values.slice(0, 10000).forEach((entry) => { const normalized = normalizePunishment(entry); if (normalized) next.set(normalized.clientId, normalized); });
    chatPunishments.clear(); next.forEach((entry, clientId) => chatPunishments.set(clientId, entry)); persistChatPunishments();
    next.forEach(notifyPunishedClients);
  };
  pruneExpiredPunishments({ broadcast: false });
  const canWriteChat = (socket) => {
    if (socket.data.isBot) return true;
    pruneExpiredPunishments();
    const entry = chatPunishments.get(safeIdentity(socket.data.clientId));
    if (!entry) return true;
    socket.emit('app-error', punishmentMessage(entry));
    return false;
  };
  const publishNotice = (room, text) => {
    if (!room) return;
    const packet = { from: `server:${clusterNodeId}`, messageId: `server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), text, textChannel: 'geral', name: 'VoiceUP Server', color: '#ff8b72', reactions: {}, pinned: false };
    rememberMessage(room, packet);
    emitToVisibleTextChannel(room, 'text-message', packet);
    sendFederation('federation:text', { hostId: clusterNodeId, room, packet });
  };

  const plugins = loadPlugins({
    directories: options.pluginDirectories || [path.join(__dirname, 'plugins')],
    trustedPluginHashes: options.trustedPluginHashes || [],
    trustedPluginDirectories: options.trustedPluginDirectories || [],
    stateFile: options.pluginStateFile || '',
    maxSystemMessageLength: () => chatPolicy().pluginMessageMaxLength,
    addLog,
    emitSystemMessage: ({ room, textChannel, text, name, color, avatar, pluginId }) => {
      if (!room || !text) return;
      events.messages += 1;
      const packet = { from: `plugin:${clusterNodeId}:${pluginId || 'server'}`, messageId: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), text, textChannel, name, color, avatar: avatar || '', pluginId };
      rememberMessage(room, packet);
      emitToVisibleTextChannel(room, 'text-message', packet);
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

  const returnMemberToLobby = (target, by = 'A equipe do servidor', reason = 'Seu acesso ao canal foi alterado.') => {
    if (!target?.data?.room || target.data.voiceChannel === LOBBY_CHANNEL) return false;
    const previousVoiceRoom = target.data.voiceRoom;
    if (target.data.voiceRoom) {
      target.to(target.data.voiceRoom).emit('peer-left', { id: target.id, name: target.data.name });
      target.leave(target.data.voiceRoom);
    }
    const layout = roomLayout(target.data.room);
    const lobbyRoom = voiceKey(target.data.room, LOBBY_CHANNEL);
    target.join(lobbyRoom);
    target.data.voiceRoom = lobbyRoom;
    target.data.voiceChannel = LOBBY_CHANNEL;
    if (previousVoiceRoom !== lobbyRoom) cleanupDynamicVoiceChannels(target.data.room);
    target.emit('server-member-moved', { by, voiceChannel: '', reason });
    target.emit('room-joined', { roomId: target.data.room, voiceChannel: LOBBY_CHANNEL, peers: [], limits: publicRoomLayout(layout, target.data).limits, serverProfile: { ...serverProfile } });
    sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(target) });
    return true;
  };
  const reconcileMemberChannelAccess = (room = '') => {
    let changed = false;
    for (const target of localClientSockets().filter((candidate) => !room || candidate.data.room === room)) {
      const layout = roomLayout(target.data.room);
      if (target.data.voiceChannel !== LOBBY_CHANNEL && !canViewChannel(layout, 'voice', target.data.voiceChannel, target.data)) changed = returnMemberToLobby(target) || changed;
    }
    return changed;
  };
  const persistAccessControl = () => options.onAccessControlChange?.(accessControl);
  const updateAccessControl = (next = {}) => {
    accessControl = normalizeAccessControl(next);
    persistAccessControl();
    reconcileMemberChannelAccess();
    publishAllServerAccess();
    return accessControl;
  };
  const persistRoomLayouts = () => options.onRoomLayoutsChange?.([...configuredRooms.values()]);
  const publishLayoutsForRoom = (room) => {
    for (const client of localClientSockets().filter((candidate) => candidate.data.room === room)) publishRoomLayout(client);
    broadcastPresence(serverKey(room));
    if (clusterRole === 'primary') sendFederation('federation:layouts', { hostId: clusterNodeId, roomLayouts: [...configuredRooms.values()] });
  };
  const persistentRoomLayout = (layout = {}) => normalizeRoomLayout({
    ...layout,
    voiceChannelSettings: (layout.voiceChannelSettings || []).filter((channel) => channel.ephemeral !== true && !channel.dynamicParentId)
  }, layout.id);
  const dynamicChannelMap = (room) => {
    const id = safeRoomId(room);
    if (!dynamicVoiceChannels.has(id)) dynamicVoiceChannels.set(id, new Map());
    return dynamicVoiceChannels.get(id);
  };
  const createDynamicVoiceChannel = (room, template, member = {}) => {
    const roomId = safeRoomId(room);
    const map = dynamicChannelMap(roomId);
    const existing = [...map.values()].find((channel) => channel.createdBy === member.socketId && channel.dynamicParentId === template.id);
    if (existing) return existing.name;
    const displayName = String(member.name || 'Participante').trim().slice(0, 24) || 'Participante';
    // The template is only an entry point. The temporary call itself is named
    // after the person who opened it, which keeps the channel list compact and
    // makes ownership immediately recognizable.
    const baseName = safeChannel(displayName, 'Participante');
    const used = new Set(roomLayout(roomId).voiceChannels.map((name) => name.toLowerCase()));
    let suffix = 2;
    let name = baseName;
    while (used.has(name.toLowerCase())) name = safeChannel(`${baseName.slice(0, 21)} ${suffix++}`, 'Participante');
    const channel = {
      ...template,
      id: safeChannelId(`${template.id}-tmp-${crypto.randomBytes(4).toString('hex')}`, `dynamic-${Date.now()}`),
      name,
      kind: 'voice',
      ephemeral: true,
      dynamicParentId: template.id,
      dynamicTemplateName: template.name,
      createdBy: member.socketId || '',
      createdAt: Date.now(),
      locked: false
    };
    map.set(name, channel);
    publishLayoutsForRoom(roomId);
    return name;
  };
  const cleanupDynamicVoiceChannels = (room) => {
    const roomId = safeRoomId(room);
    const map = dynamicVoiceChannels.get(roomId);
    if (!map?.size) return false;
    let changed = false;
    for (const [name] of map) {
      if (peersIn(voiceKey(roomId, name)).length === 0) { map.delete(name); changed = true; }
    }
    if (!map.size) dynamicVoiceChannels.delete(roomId);
    if (changed) publishLayoutsForRoom(roomId);
    return changed;
  };
  const resolveVoiceChannel = (room, layout, requested, member = {}) => {
    if (requested === LOBBY_CHANNEL) return { channel: LOBBY_CHANNEL, layout };
    const settings = voiceChannelSettings(layout, requested);
    if (settings.kind === 'dynamic' && !settings.ephemeral) {
      const channel = createDynamicVoiceChannel(room, settings, member);
      return { channel, layout: roomLayout(room) };
    }
    return { channel: requested, layout };
  };
  const updateServerSettingsByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageServer')) return denyPermission(socket, 'server.settings.change', 'manageServer', respond);
    if (typeof options.onChatPolicyChange !== 'function') return reply({ ok: false, message: 'Este servidor não permite alterar essas configurações pelo Client.' });
    const next = {
      cooldownSeconds: Math.round(clampNumber(payload.chatPolicy?.cooldownSeconds, 0, 21600, chatPolicy().cooldownSeconds)),
      pluginMessageMaxLength: Math.round(clampNumber(payload.chatPolicy?.pluginMessageMaxLength, 500, 10000, chatPolicy().pluginMessageMaxLength))
    };
    const saved = options.onChatPolicyChange(next) || next;
    publishAllServerAccess();
    auditStore.record('server.settings.changed', actorSnapshot(socket), { roomId: socket.data.room }, { cooldownSeconds: saved.cooldownSeconds, pluginMessageMaxLength: saved.pluginMessageMaxLength });
    addLog('security', `${socket.data.name} alterou as políticas de chat do servidor`);
    reply({ ok: true, message: 'Configurações do servidor atualizadas.', chatPolicy: { ...saved } });
  };
  const channelRolesFromPayload = (value) => {
    const available = new Set(accessControl.roles.map((role) => role.id));
    return [...new Set((Array.isArray(value) ? value : []).map(safeRoleId).filter((id) => id && available.has(id)))].slice(0, 64);
  };
  const channelSettingFromPayload = (type, payload = {}, previous = {}) => {
    const common = {
      ...previous,
      name: previous.name || safeChannel(payload.name, ''),
      type,
      category: String(payload.category ?? previous.category ?? '').trim().slice(0, 36),
      visibleRoleIds: channelRolesFromPayload(payload.visibleRoleIds ?? previous.visibleRoleIds)
    };
    if (type === 'voice') return {
      ...common,
      kind: ['voice', 'stage', 'dynamic'].includes(String(payload.kind ?? previous.kind ?? '')) ? String(payload.kind ?? previous.kind) : 'voice',
      userLimit: Math.round(clampNumber(payload.userLimit, 0, 99, Number(previous.userLimit) || 0)),
      bitrateKbps: Math.round(clampNumber(payload.bitrateKbps, 8, 510, Number(previous.bitrateKbps) || 64)),
      region: String(payload.region ?? previous.region ?? 'auto').trim().slice(0, 32) || 'auto',
      locked: payload.locked === undefined ? Boolean(previous.locked) : Boolean(payload.locked)
    };
    return {
      ...common,
      kind: String(payload.kind ?? previous.kind) === 'forum' ? 'forum' : 'text',
      topic: String(payload.topic ?? previous.topic ?? '').trim().slice(0, 240),
      slowModeSeconds: Math.round(clampNumber(payload.slowModeSeconds, 0, 21600, Number(previous.slowModeSeconds) || 0)),
      readOnly: payload.readOnly === undefined ? Boolean(previous.readOnly) : Boolean(payload.readOnly),
      forumTags: [...new Set((Array.isArray(payload.forumTags) ? payload.forumTags : (previous.forumTags || []))
        .map((tag) => String(tag || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24)).filter(Boolean))].slice(0, 16),
      forumSort: payload.forumSort === 'newest' ? 'newest' : (payload.forumSort === 'recent' ? 'recent' : (previous.forumSort === 'newest' ? 'newest' : 'recent'))
    };
  };
  const createChannelByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageChannels')) return denyPermission(socket, 'channel.create', 'manageChannels', respond);
    const type = payload.type === 'text' ? 'text' : payload.type === 'voice' ? 'voice' : '';
    const name = safeChannel(payload.name, '');
    if (!type || !name) return reply({ ok: false, message: 'Informe o tipo e um nome válido para o canal.' });
    const layout = roomLayout(socket.data.room);
    const existing = type === 'voice' ? layout.voiceChannels : layout.textChannels;
    if (existing.some((channel) => channel.toLowerCase() === name.toLowerCase())) return reply({ ok: false, message: 'Já existe um canal com esse nome.' });
    const settingsKey = type === 'voice' ? 'voiceChannelSettings' : 'textChannelSettings';
    const nextSetting = channelSettingFromPayload(type, { ...payload, name });
    const settings = [...layout[settingsKey]];
    const position = Math.round(clampNumber(payload.position, 0, settings.length, settings.length));
    settings.splice(position, 0, nextSetting);
    settings.forEach((channel, index) => { channel.position = index; });
    const next = persistentRoomLayout({ ...layout, id: socket.data.room, [settingsKey]: settings });
    configuredRooms.set(next.id.toLowerCase(), next);
    persistRoomLayouts();
    publishLayoutsForRoom(next.id);
    auditStore.record('channel.created', actorSnapshot(socket), { roomId: next.id, channel: name }, { type, category: nextSetting.category, visibleRoleIds: nextSetting.visibleRoleIds });
    addLog('security', `${socket.data.name} criou ${type === 'voice' ? 'a call' : 'o chat'} ${name}`);
    reply({ ok: true, message: `${type === 'voice' ? 'Call' : 'Chat'} ${name} criado.`, layout: publicRoomLayout(next, socket.data) });
  };
  const updateChannelByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageChannels')) return denyPermission(socket, 'channel.update', 'manageChannels', respond);
    const type = payload.type === 'text' ? 'text' : payload.type === 'voice' ? 'voice' : '';
    if (!type) return reply({ ok: false, message: 'Tipo de canal inválido.' });
    const layout = roomLayout(socket.data.room);
    const settingsKey = type === 'voice' ? 'voiceChannelSettings' : 'textChannelSettings';
    const settings = [...layout[settingsKey]];
    const requestedId = safeChannelId(payload.channelId || '', '');
    const requestedName = safeChannel(payload.channelName, '');
    const currentIndex = settings.findIndex((channel) => (requestedId && channel.id === requestedId) || (requestedName && channel.name === requestedName));
    if (currentIndex < 0) return reply({ ok: false, message: 'Canal não encontrado nesta sala.' });
    const previous = settings[currentIndex];
    const updated = channelSettingFromPayload(type, payload, previous);
    settings.splice(currentIndex, 1);
    const position = Math.round(clampNumber(payload.position, 0, settings.length, currentIndex));
    settings.splice(position, 0, updated);
    settings.forEach((channel, index) => { channel.position = index; });
    const next = persistentRoomLayout({ ...layout, id: socket.data.room, [settingsKey]: settings });
    configuredRooms.set(next.id.toLowerCase(), next);
    persistRoomLayouts();

    // A restriction is authoritative immediately. Someone already inside a
    // voice channel that just became private is safely returned to the lobby.
    if (type === 'voice') for (const target of localClientSockets().filter((candidate) => candidate.data.room === next.id && candidate.data.voiceChannel === previous.name && !canViewChannel(next, 'voice', previous.name, candidate.data))) returnMemberToLobby(target, socket.data.name, 'O acesso ao canal foi alterado.');
    publishLayoutsForRoom(next.id);
    auditStore.record('channel.updated', actorSnapshot(socket), { roomId: next.id, channel: previous.name }, { type, category: updated.category, position, visibleRoleIds: updated.visibleRoleIds });
    addLog('security', `${socket.data.name} configurou ${type === 'voice' ? 'a call' : 'o chat'} ${previous.name}`);
    reply({ ok: true, message: `${type === 'voice' ? 'Call' : 'Chat'} ${previous.name} atualizado.`, layout: publicRoomLayout(next, socket.data) });
  };
  const deleteChannelByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageChannels')) return denyPermission(socket, 'channel.delete', 'manageChannels', respond);
    const type = payload.type === 'text' ? 'text' : payload.type === 'voice' ? 'voice' : '';
    if (!type) return reply({ ok: false, message: 'Tipo de canal inválido.' });
    const layout = roomLayout(socket.data.room); const settingsKey = type === 'voice' ? 'voiceChannelSettings' : 'textChannelSettings';
    const settings = [...layout[settingsKey]].filter((channel) => !channel.ephemeral);
    const channelId = safeChannelId(payload.channelId || '', ''); const channelName = safeChannel(payload.channelName, '');
    const index = settings.findIndex((channel) => (channelId && channel.id === channelId) || (channelName && channel.name === channelName));
    if (index < 0) return reply({ ok: false, message: 'Canal não encontrado nesta sala.' });
    if (settings.length <= 1) return reply({ ok: false, message: `Mantenha ao menos um canal de ${type === 'voice' ? 'voz' : 'texto'} na sala.` });
    const [removed] = settings.splice(index, 1); settings.forEach((channel, position) => { channel.position = position; });
    if (type === 'voice') for (const target of localClientSockets().filter((candidate) => candidate.data.room === socket.data.room && candidate.data.voiceChannel === removed.name)) returnMemberToLobby(target, socket.data.name, 'O canal foi removido.');
    const next = persistentRoomLayout({ ...layout, id: socket.data.room, [settingsKey]: settings });
    configuredRooms.set(next.id.toLowerCase(), next); persistRoomLayouts(); publishLayoutsForRoom(next.id);
    auditStore.record('channel.deleted', actorSnapshot(socket), { roomId: next.id, channel: removed.name }, { type, kind: removed.kind || type });
    addLog('security', `${socket.data.name} removeu ${type === 'voice' ? 'a call' : 'o chat'} ${removed.name}`);
    reply({ ok: true, message: `${type === 'voice' ? 'Call' : 'Chat'} ${removed.name} removido e salvo automaticamente.`, layout: publicRoomLayout(next, socket.data) });
  };
  const moveMemberByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'moveMembers')) return denyPermission(socket, 'member.move', 'moveMembers', respond);
    const target = io.sockets.sockets.get(String(payload.targetId || ''));
    if (!target || target.data.isBot || target.data.serverRoom !== socket.data.serverRoom) return reply({ ok: false, message: 'Participante não encontrado nesta sala.' });
    if (!canManageMember(socket, target.data)) return denyHierarchy(socket, 'member.move', { clientId: target.data.clientId, name: target.data.name }, respond);
    let layout = roomLayout(socket.data.room);
    const requested = safeChannel(payload.voiceChannel, LOBBY_CHANNEL);
    let channel = requested === LOBBY_CHANNEL || layout.voiceChannels.includes(requested) ? requested : '';
    if (!channel) return reply({ ok: false, message: 'Canal de voz inválido.' });
    if (channel !== LOBBY_CHANNEL && !canViewChannel(layout, 'voice', channel, target.data)) return reply({ ok: false, message: 'Essa pessoa não possui um cargo com acesso ao canal.' });
    if (channel !== LOBBY_CHANNEL) {
      const resolved = resolveVoiceChannel(socket.data.room, layout, channel, { socketId: target.id, name: target.data.name });
      channel = resolved.channel;
      layout = resolved.layout;
    }
    if (target.data.voiceChannel === channel) return reply({ ok: true, message: 'A pessoa já está nesse canal.' });
    const nextRoom = voiceKey(socket.data.room, channel);
    const limits = voiceChannelLimits(layout, channel);
    const nextPeers = channel === LOBBY_CHANNEL ? [] : peersIn(nextRoom).filter((peer) => peer.id !== target.id);
    if (channel !== LOBBY_CHANNEL && nextPeers.length >= limits.total) return reply({ ok: false, message: `O canal atingiu o limite de ${limits.total} pessoas.` });
    const previousPeers = target.data.voiceChannel === LOBBY_CHANNEL ? [] : peersIn(target.data.voiceRoom).filter((peer) => peer.id !== target.id);
    previousPeers.forEach((peer) => target.emit('peer-left', { id: peer.id, name: peer.name }));
    const previousVoiceRoom = target.data.voiceRoom;
    if (target.data.voiceChannel !== LOBBY_CHANNEL) target.to(target.data.voiceRoom).emit('peer-left', { id: target.id, name: target.data.name });
    target.leave(target.data.voiceRoom);
    target.join(nextRoom);
    target.data.voiceRoom = nextRoom;
    target.data.voiceChannel = channel;
    target.emit('server-member-moved', { by: socket.data.name, voiceChannel: channel === LOBBY_CHANNEL ? '' : channel });
    target.emit('room-joined', { roomId: target.data.room, voiceChannel: channel, peers: nextPeers, limits: publicRoomLayout(layout).limits, serverProfile: { ...serverProfile } });
    if (channel !== LOBBY_CHANNEL) target.to(nextRoom).emit('peer-joined', peerSummary(target.id, target.data));
    if (previousVoiceRoom !== nextRoom) cleanupDynamicVoiceChannels(target.data.room);
    broadcastPresence(socket.data.serverRoom);
    sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(target) });
    auditStore.record('member.moved', actorSnapshot(socket), { clientId: target.data.clientId || '', name: target.data.name }, { roomId: target.data.room, voiceChannel: channel === LOBBY_CHANNEL ? 'fora-da-call' : channel });
    addLog('security', `${socket.data.name} moveu ${target.data.name} para ${channel === LOBBY_CHANNEL ? 'fora da call' : channel}`);
    reply({ ok: true, message: `${target.data.name} foi movido para ${channel === LOBBY_CHANNEL ? 'fora da call' : channel}.` });
  };
  const assignRolesByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageRoles')) return denyPermission(socket, 'member.roles.change', 'manageRoles', respond);
    const target = peersIn(socket.data.serverRoom).find((member) => member.id === String(payload.targetId || ''));
    if (!target?.clientId || target.identityVerified !== true) return reply({ ok: false, message: 'Este perfil precisa usar a identidade protegida da versão atual.' });
    if (!canManageMember(socket, target)) return denyHierarchy(socket, 'member.roles.change', { clientId: target.clientId, name: target.name }, respond);
    const requestedRoles = [...new Set((Array.isArray(payload.roleIds) ? payload.roleIds : []).map(safeRoleId).filter(Boolean))]
      .map((roleId) => accessControl.roles.find((role) => role.id === roleId)).filter(Boolean);
    if (requestedRoles.some((role) => !canManageRolePosition(socket, role.position))) return denyHierarchy(socket, 'member.roles.change', { clientId: target.clientId, name: target.name }, respond);
    const result = assignRoles(accessControl, target.clientId, payload.roleIds, target.name);
    if (!result.ok) return reply(result);
    accessControl = result.accessControl;
    persistAccessControl();
    reconcileMemberChannelAccess(socket.data.room);
    publishAllServerAccess();
    auditStore.record('member.roles.changed', actorSnapshot(socket), { clientId: target.clientId, name: target.name }, { roleIds: Array.isArray(payload.roleIds) ? payload.roleIds : [] });
    addLog('security', `${socket.data.name} alterou os cargos de ${target.name}`);
    reply({ ok: true, message: result.message });
  };
  const saveRoleByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageRoles')) return denyPermission(socket, 'role.save', 'manageRoles', respond);
    const result = upsertRole(accessControl, payload);
    if (!result.ok) return reply(result);
    const previousId = safeRoleId(payload.previousId || payload.id || payload.name);
    const previous = accessControl.roles.find((role) => role.id === previousId);
    if ((previous && !canManageRolePosition(socket, previous.position)) || !canManageRolePosition(socket, result.role.position)) return denyHierarchy(socket, 'role.save', { roleId: result.role.id, name: result.role.name }, respond);
    accessControl = result.accessControl;
    persistAccessControl();
    reconcileMemberChannelAccess();
    publishAllServerAccess();
    auditStore.record('role.saved', actorSnapshot(socket), { roleId: result.role.id, name: result.role.name }, { permissions: result.role.permissions });
    addLog('security', `${socket.data.name} salvou o cargo ${result.role.name}`);
    reply({ ok: true, message: result.message, role: result.role });
  };
  const deleteRoleByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'manageRoles')) return denyPermission(socket, 'role.delete', 'manageRoles', respond);
    const current = accessControl.roles.find((role) => role.id === safeRoleId(payload.roleId));
    if (current && !canManageRolePosition(socket, current.position)) return denyHierarchy(socket, 'role.delete', { roleId: current.id, name: current.name }, respond);
    const result = deleteRole(accessControl, payload.roleId);
    if (!result.ok) return reply(result);
    accessControl = result.accessControl;
    persistAccessControl();
    reconcileMemberChannelAccess();
    publishAllServerAccess();
    auditStore.record('role.deleted', actorSnapshot(socket), { roleId: String(payload.roleId || '') });
    addLog('security', `${socket.data.name} removeu um cargo`);
    reply({ ok: true, message: result.message });
  };
  const moderateMemberByClient = (socket, payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'moderateMembers')) return denyPermission(socket, 'moderation.remote', 'moderateMembers', respond);
    const targetId = String(payload.targetId || '');
    if (!targetId || targetId === socket.id) return reply({ ok: false, message: 'Escolha outra pessoa para moderar.' });
    const target = peersIn(socket.data.serverRoom).find((member) => member.id === targetId);
    if (!target || target.isBot) return reply({ ok: false, message: 'Participante não encontrado nesta sala.' });
    if (!canManageMember(socket, target)) return denyHierarchy(socket, 'moderation.remote', { clientId: target.clientId || '', name: target.name }, respond);
    const action = ['kick', 'ban', 'punish'].includes(payload.action) ? payload.action : '';
    if (!action) return reply({ ok: false, message: 'Ação de moderação inválida.' });
    const options = { durationMinutes: payload.durationMinutes, reason: payload.reason };
    const result = action === 'kick' ? kick(targetId) : action === 'ban' ? ban(targetId, options) : punishChat(targetId, options);
    auditStore.record(`moderation.${action}`, actorSnapshot(socket), { clientId: target.clientId || '', name: target.name, socketId: targetId }, { durationMinutes: Number(payload.durationMinutes) || 0, reason: String(payload.reason || '').slice(0, 160) }, result.ok ? 'allowed' : 'failed');
    reply(result);
  };
  const listAuditByClient = (socket, _payload = {}, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!hasPermission(socket, 'viewAuditLog')) return denyPermission(socket, 'audit.view', 'viewAuditLog', respond);
    reply({ ok: true, entries: auditStore.list(100) });
  };
  const attachments = createAttachmentService({
    directory: options.attachmentsDirectory || (options.historyFile ? path.join(path.dirname(options.historyFile), 'attachments') : ''),
    policy: () => ({ enabled: runtimeOption(options.attachmentsEnabled) === true, maxMB: runtimeOption(options.attachmentMaxMB) || 5 }),
    authorize: (socket, channel, write, thread) => {
      if (!socket.data.serverRoom || !canViewChannel(roomLayout(socket.data.room), 'text', channel, socket.data)) return false;
      if (!write) return true;
      if (!canWriteChat(socket)) return false;
      const settings = (roomLayout(socket.data.room).textChannelSettings || []).find(item => item.name === channel);
      return !(settings?.readOnly && !hasPermission(socket, 'manageMessages')) && (settings?.kind !== 'forum' || Boolean(safeForumThreadId(thread)));
    },
    publish: (socket, packet) => socket.listeners('text-message')[0]?.(packet) === true
  });
  io.on('connection', (socket) => {
    attachments.bind(socket);
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
      let layout = roomLayout(room);
      const requestedVoiceChannel = safeChannel(voiceChannel, LOBBY_CHANNEL);
      let voiceChannelName = LOBBY_CHANNEL;
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
      const joiningPeer = { clientId: identity, identityVerified: Boolean(identityFingerprint), isBot };
      const allowedVoiceChannels = visibleChannels(layout, 'voice', joiningPeer);
      if (requestedVoiceChannel === LOBBY_CHANNEL) voiceChannelName = LOBBY_CHANNEL;
      else if (layout.voiceChannels.includes(requestedVoiceChannel) && canViewChannel(layout, 'voice', requestedVoiceChannel, joiningPeer)) voiceChannelName = requestedVoiceChannel;
      else if (layout.voiceChannels.includes(requestedVoiceChannel)) socket.emit('app-error', 'Seu cargo não permite entrar nesse canal de voz. Você entrou fora da call.');
      else voiceChannelName = allowedVoiceChannels[0] || LOBBY_CHANNEL;
      if (voiceChannelName !== LOBBY_CHANNEL) {
        const resolved = resolveVoiceChannel(room, layout, voiceChannelName, { socketId: socket.id, name: safeName });
        voiceChannelName = resolved.channel;
        layout = resolved.layout;
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
      publishServerAccess(socket);
      const peers = voiceChannelName === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id && !staleSessionIds.has(peer.id));
      socket.emit('room-joined', { roomId: room, voiceChannel: voiceChannelName, peers, limits: publicRoomLayout(layout, socket.data).limits, serverProfile: { ...serverProfile } });
      socket.emit('chat-history', { messages: historyFor(room).filter((message) => canViewChannel(layout, 'text', message.textChannel || layout.textChannels[0], socket.data)) });
      const activePunishment = chatPunishments.get(identity); if (!isBot && activePunishment) socket.emit('app-error', punishmentMessage(activePunishment));
      publishClusterRoute(socket);
      if (voiceChannelName !== LOBBY_CHANNEL) socket.to(voiceRoom).emit('peer-joined', peerSummary(socket.id, socket.data));
      broadcastPresence(serverRoom);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
      auditStore.record('session.joined', actorSnapshot(socket), { roomId: room, voiceChannel: voiceChannelName === LOBBY_CHANNEL ? 'fora-da-call' : voiceChannelName }, { platform: socket.data.platform || 'unknown', identityVerified: socket.data.identityVerified === true });
    });
    socket.on('request-room-presence', () => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'presence-request', 20, 10000)) return;
      socket.emit('room-presence', roomPresencePacket(socket.data.serverRoom, '', socket.data));
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
      let layout = roomLayout(socket.data.room);
      const requestedChannel = safeChannel(voiceChannel, layout.voiceChannels[0]);
      let channel = requestedChannel === LOBBY_CHANNEL || layout.voiceChannels.includes(requestedChannel) ? requestedChannel : layout.voiceChannels[0];
      if (channel !== LOBBY_CHANNEL && !canViewChannel(layout, 'voice', channel, socket.data)) return socket.emit('app-error', 'Seu cargo não permite entrar nesse canal de voz.');
      if (channel !== LOBBY_CHANNEL) {
        const resolved = resolveVoiceChannel(socket.data.room, layout, channel, { socketId: socket.id, name: socket.data.name });
        channel = resolved.channel;
        layout = resolved.layout;
      }
      const nextVoiceRoom = voiceKey(socket.data.room, channel);
      if (nextVoiceRoom === socket.data.voiceRoom) return;
      const settings = voiceChannelSettings(layout, channel); const limits = voiceChannelLimits(layout, channel);
      if (channel !== LOBBY_CHANNEL && settings.locked && !socket.data.isBot) return socket.emit('app-error', 'Este canal de voz está fechado pelo ServerHost.');
      if (channel !== LOBBY_CHANNEL && peersIn(nextVoiceRoom).length >= limits.total) return socket.emit('app-error', `O canal de voz já possui o limite de ${limits.total} pessoas.`);
      const regularPeers = peersIn(nextVoiceRoom).filter((peer) => !peer.isBot);
      if (channel !== LOBBY_CHANNEL && !socket.data.isBot && regularPeers.length >= limits.humans) return socket.emit('app-error', `O canal de voz atingiu o limite de ${limits.humans} pessoas.`);
      const previousVoiceRoom = socket.data.voiceRoom;
      if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
      socket.leave(socket.data.voiceRoom);
      socket.join(nextVoiceRoom); socket.data.voiceRoom = nextVoiceRoom; socket.data.voiceChannel = channel;
      const peers = channel === LOBBY_CHANNEL ? [] : peersIn(nextVoiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers, limits: publicRoomLayout(layout, socket.data).limits, serverProfile: { ...serverProfile } });
      if (channel !== LOBBY_CHANNEL) socket.to(nextVoiceRoom).emit('peer-joined', peerSummary(socket.id, socket.data));
      if (previousVoiceRoom !== nextVoiceRoom) cleanupDynamicVoiceChannels(socket.data.room);
      broadcastPresence(socket.data.serverRoom); addLog('channel', channel === LOBBY_CHANNEL ? `${socket.data.name} saiu da call` : `${socket.data.name} mudou para ${channel}`);
      sendFederation('federation:member', { hostId: clusterNodeId, member: exportMember(socket) });
    });
    socket.on('admin:update-server-settings', (payload = {}, respond) => updateServerSettingsByClient(socket, payload, respond));
    socket.on('admin:create-channel', (payload = {}, respond) => createChannelByClient(socket, payload, respond));
    socket.on('admin:update-channel', (payload = {}, respond) => updateChannelByClient(socket, payload, respond));
    socket.on('admin:delete-channel', (payload = {}, respond) => deleteChannelByClient(socket, payload, respond));
    socket.on('admin:move-member', (payload = {}, respond) => moveMemberByClient(socket, payload, respond));
    socket.on('admin:assign-roles', (payload = {}, respond) => assignRolesByClient(socket, payload, respond));
    socket.on('admin:save-role', (payload = {}, respond) => saveRoleByClient(socket, payload, respond));
    socket.on('admin:delete-role', (payload = {}, respond) => deleteRoleByClient(socket, payload, respond));
    socket.on('admin:moderate', (payload = {}, respond) => moderateMemberByClient(socket, payload, respond));
    socket.on('admin:get-audit', (payload = {}, respond) => listAuditByClient(socket, payload, respond));
    socket.on('text-message', ({ text, textFile, textChannel, messageId, createdAt, mentions, reply, forumThreadId, forumTitle } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'text', 30, 10000)) return;
      if (!canWriteChat(socket)) return;
      const requestedTextFile = textFile !== undefined && textFile !== null; const normalizedTextFile = safeTextFile(textFile);
      if (requestedTextFile && !normalizedTextFile) return socket.emit('app-error', 'Arquivo de texto inválido ou maior que 64 KB.');
      const fallbackText = normalizedTextFile ? `Arquivo de texto: ${normalizedTextFile.name}` : '';
      const safeText = String(text || fallbackText).trim().slice(0, 500) || fallbackText; if (!safeText) return;
      events.messages += 1;
      const layout = roomLayout(socket.data.room);
      const allowedTextChannels = visibleChannels(layout, 'text', socket.data);
      const requestedTextChannel = safeChannel(textChannel, allowedTextChannels[0]);
      const safeTextChannel = allowedTextChannels.includes(requestedTextChannel)
        ? requestedTextChannel
        : (layout.textChannels.includes(requestedTextChannel) ? '' : allowedTextChannels[0]);
      if (!safeTextChannel) return socket.emit('app-error', 'Seu cargo não permite enviar mensagens nesse canal.');
      const textSettings = (layout.textChannelSettings || []).find((channel) => channel.name === safeTextChannel) || { readOnly: false, slowModeSeconds: 0 };
      if (textSettings.readOnly && !socket.data.isBot && !hasPermission(socket, 'manageMessages')) return socket.emit('app-error', 'Este canal de texto é somente leitura.');
      socket.data.lastTextAt ||= new Map();
      const lastTextAt = Number(socket.data.lastTextAt.get(safeTextChannel) || 0);
      const cooldownSeconds = Math.max(chatPolicy().cooldownSeconds, Number(textSettings.slowModeSeconds || 0));
      const waitMs = Math.max(0, cooldownSeconds * 1000 - (Date.now() - lastTextAt));
      if (!socket.data.isBot && waitMs > 0) return socket.emit('app-error', `Cooldown ativo. Aguarde ${Math.ceil(waitMs / 1000)}s.`);
      socket.data.lastTextAt.set(safeTextChannel, Date.now());
      const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
      const safeThreadId = textSettings.kind === 'forum' ? safeForumThreadId(forumThreadId) : '';
      const safeForumTitle = safeThreadId ? String(forumTitle || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '';
      if (textSettings.kind === 'forum' && !safeThreadId) return socket.emit('app-error', 'Abra um tópico antes de enviar uma mensagem no fórum.');
      const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
      const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
      const replyPacket = safeReply(socket.data.room, reply, socket.data);
      socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds, mentionClientIds });
      if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
      const packet = { from: socket.id, authorClientId: socket.data.clientId || '', authorIdentityFingerprint: socket.data.identityFingerprint || '', messageId: id, createdAt: sentAt, text: safeText, ...(normalizedTextFile ? { textFile: normalizedTextFile } : {}), textChannel: safeTextChannel, ...(safeThreadId ? { forumThreadId: safeThreadId, forumTitle: safeForumTitle } : {}), name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', mentions: safeMentionIds, mentionClientIds, reply: replyPacket, reactions: {}, pinned: false };
      rememberMessage(socket.data.room, packet);
      emitToVisibleTextChannel(socket.data.room, 'text-message', packet);
      sendFederation('federation:text', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
      plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0] }, serverIsCloud: false });
      return true;
    });
    socket.on('edit-message', ({ messageId, text, textChannel, mentions } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-edit', 24, 10000)) return;
      if (!canWriteChat(socket)) return;
      const id = String(messageId || ''); const stored = messageById(socket.data.room, id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
      if (stored && !canViewChannel(roomLayout(socket.data.room), 'text', stored.textChannel, socket.data)) return socket.emit('app-error', 'Seu cargo não permite acessar essa mensagem.');
      const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
      if ((!known && !ownsMessage) || !safeText || safeChannel(textChannel, 'geral') !== (stored?.textChannel || known?.textChannel)) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
      const editedAt = Date.now(); const safeMentionIds = safeMentions(socket.data.serverRoom, mentions); const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
      if (known) Object.assign(known, { mentions: safeMentionIds, mentionClientIds });
      if (stored) { Object.assign(stored, { text: safeText, editedAt, mentions: safeMentionIds, mentionClientIds }); chatStore.touch(); }
      const packet = { from: socket.id, messageId: id, text: safeText, textChannel: stored?.textChannel || known.textChannel, editedAt, mentions: safeMentionIds, mentionClientIds };
      emitToVisibleTextChannel(socket.data.room, 'message-edited', packet);
      sendFederation('federation:edit', { hostId: clusterNodeId, room: socket.data.room, packet: { ...packet, from: federationId(socket.id) } });
    });
    socket.on('react-message', ({ messageId, emoji } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-reaction', 40, 10000)) return;
      const stored = messageById(socket.data.room, messageId); const safeEmoji = String(emoji || '').trim().slice(0, 12);
      if (!stored || !safeEmoji) return socket.emit('app-error', 'Não foi possível reagir a essa mensagem.');
      if (!canViewChannel(roomLayout(socket.data.room), 'text', stored.textChannel, socket.data)) return socket.emit('app-error', 'Seu cargo não permite acessar essa mensagem.');
      stored.reactions ||= {};
      const actor = socket.data.identityFingerprint ? `key:${socket.data.identityFingerprint}` : (socket.data.clientId || socket.id); const actors = new Set(Array.isArray(stored.reactions[safeEmoji]) ? stored.reactions[safeEmoji] : []);
      if (actors.has(actor)) actors.delete(actor); else actors.add(actor);
      if (actors.size) stored.reactions[safeEmoji] = [...actors]; else delete stored.reactions[safeEmoji];
      chatStore.touch();
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel, reactions: stored.reactions };
      emitToVisibleTextChannel(socket.data.room, 'message-reaction', packet);
      sendFederation('federation:reaction', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('pin-message', ({ messageId, pinned } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-pin', 20, 10000)) return;
      if (!hasPermission(socket, 'manageMessages')) return denyPermission(socket, 'message.pin', 'manageMessages');
      const stored = messageById(socket.data.room, messageId); if (!stored) return socket.emit('app-error', 'Mensagem não encontrada.');
      if (!canViewChannel(roomLayout(socket.data.room), 'text', stored.textChannel, socket.data)) return socket.emit('app-error', 'Seu cargo não permite acessar essa mensagem.');
      stored.pinned = Boolean(pinned); stored.pinnedBy = socket.data.clientId || socket.id;
      chatStore.touch();
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel, pinned: stored.pinned, pinnedBy: stored.pinnedBy };
      emitToVisibleTextChannel(socket.data.room, 'message-pinned', packet);
      sendFederation('federation:pin', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('delete-message', ({ messageId } = {}) => {
      if (!socket.data.serverRoom || !consumeRate(socket, 'message-delete', 20, 10000)) return;
      const stored = messageById(socket.data.room, messageId);
      const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
      if (stored && !canViewChannel(roomLayout(socket.data.room), 'text', stored.textChannel, socket.data)) return socket.emit('app-error', 'Seu cargo não permite acessar essa mensagem.');
      if (!ownsMessage) return socket.emit('app-error', 'Você só pode apagar suas próprias mensagens.');
      forgetMessage(socket.data.room, stored.messageId); socket.data.chatMessages?.delete(stored.messageId);
      const packet = { messageId: stored.messageId, textChannel: stored.textChannel };
      emitToVisibleTextChannel(socket.data.room, 'message-deleted', packet);
      sendFederation('federation:delete', { hostId: clusterNodeId, room: socket.data.room, packet });
    });
    socket.on('signal', ({ target, data } = {}) => {
      if (!target || !socket.data.serverRoom || !consumeRate(socket, 'signal', 360, 10000)) return;
      try { if (Buffer.byteLength(JSON.stringify(data || {}), 'utf8') > 64 * 1024) return socket.emit('app-error', 'Pacote de conexão grande demais.'); } catch { return; }
      const targetSocket = io.sockets.sockets.get(String(target));
      if (targetSocket && targetSocket.data.serverRoom === socket.data.serverRoom && targetSocket.data.voiceRoom === socket.data.voiceRoom && socket.data.voiceChannel !== LOBBY_CHANNEL) {
        events.signals += 1;
        targetSocket.emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), data });
        return;
      }
      const remote = remoteMembers.get(String(target));
      if (!remote || remote.serverRoom !== socket.data.serverRoom || remote.voiceRoom !== socket.data.voiceRoom || socket.data.voiceChannel === LOBBY_CHANNEL) return;
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
    socket.on('disconnecting', () => { const departedRoom = socket.data.room; webrtcTelemetry.delete(socket.id); if (socket.data.voiceRoom) { addLog('leave', `${socket.data.name || 'Cliente'} saiu da sala`); if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); } if (socket.data.serverRoom) { auditStore.record('session.left', actorSnapshot(socket), { roomId: socket.data.room || '', voiceChannel: socket.data.voiceChannel === LOBBY_CHANNEL ? 'fora-da-call' : socket.data.voiceChannel || '' }); broadcastPresence(socket.data.serverRoom, socket.id); sendFederation('federation:left', { hostId: clusterNodeId, id: federationId(socket.id) }); } if (departedRoom) setTimeout(() => cleanupDynamicVoiceChannels(departedRoom), 0); });
  });

  const members = () => [
    ...localClientSockets().map((socket) => ({ id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), ping: Number.isFinite(socket.data.ping) ? Math.round(socket.data.ping) : null, room: socket.data.room || '', voiceChannel: socket.data.voiceChannel || '', isBot: Boolean(socket.data.isBot), identityVerified: socket.data.identityVerified === true, ...memberAccess(socket.data), remote: false, connectedSeconds: socket.data.joinedAt ? Math.floor((Date.now() - socket.data.joinedAt) / 1000) : 0 })),
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
  const punishChat = (id, options = {}) => {
    const targetId = String(id || ''); const socket = io.sockets.sockets.get(targetId); const remote = remoteMembers.get(targetId);
    const identity = safeIdentity(socket?.data?.clientId || remote?.clientId);
    if (!identity) return { ok: false, message: 'Este cliente é antigo e não pode receber castigo persistente. Peça para atualizar o Client.' };
    const durationMinutes = Math.round(clampNumber(options.durationMinutes, 0, 525600, 60));
    const reason = String(options.reason || '').trim().slice(0, 160);
    const expiresAt = durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
    const targetName = socket?.data?.name || remote?.name || 'Visitante';
    const entry = { clientId: identity, name: targetName, reason, punishedAt: new Date().toISOString(), expiresAt };
    chatPunishments.set(identity, entry); persistChatPunishments(); events.chatPunishments += 1;
    sendFederation('federation:chat-punishments', { hostId: clusterNodeId, chatPunishments: [...chatPunishments.values()] });
    notifyPunishedClients(entry);
    addLog('punishment', `${targetName} ficou sem enviar mensagens${expiresAt ? ` até ${new Date(expiresAt).toLocaleString('pt-BR')}` : ' permanentemente'}`);
    return { ok: true, message: `${targetName} recebeu castigo no chat.` };
  };
  const unpunishChat = (clientId) => {
    const identity = safeIdentity(clientId);
    if (!identity || !chatPunishments.has(identity)) return { ok: false, message: 'Castigo não encontrado.' };
    const name = chatPunishments.get(identity).name || 'Participante';
    chatPunishments.delete(identity); persistChatPunishments();
    sendFederation('federation:chat-punishments', { hostId: clusterNodeId, chatPunishments: [...chatPunishments.values()] });
    addLog('punishment', `Castigo de ${name} foi removido`);
    return { ok: true, message: `${name} pode enviar mensagens novamente.` };
  };
  const getStats = () => {
    pruneExpiredBans();
    pruneExpiredPunishments();
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
    return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), participants: allMembers.length, localParticipants: localClientSockets().length, rooms: voiceRooms.size, maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE, maxHumanVoiceChannelSize: MAX_HUMAN_VOICE_CHANNEL_SIZE, roomLayouts: [...configuredRooms.values()].map(publicRoomLayout), chatPolicy: chatPolicy(), storage: { chat: chatStore.stats(), reports: reportStore.stats(), security: auditStore.stats() }, reports: reportStore.list(20), accessControl, permissionDefinitions: PERMISSION_DEFINITIONS, securityAudit: auditStore.list(150), cluster: { enabled: clusterEnabled, role: clusterRole, nodeId: clusterNodeId, state: federationState, remoteHost: federationRemoteHost, remoteParticipants: remoteMembers.size, failover: clusterFailover, smartDistribution: clusterSmartDistribution, publicUrl: clusterPublicUrl, capacity: clusterCapacity, weight: clusterWeight, nodes: clusterNodes, alternates: clusterAlternates() }, webrtc: { supportedClients: recentTelemetry.length, unsupportedClients: Math.max(0, allMembers.filter((member) => !member.isBot).length - recentTelemetry.length), connections, sampledAt: Date.now() }, bandwidth, averagePing: pings.length ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length) : null, events, logs, plugins: plugins.list(), pluginErrors: plugins.errors(), members: allMembers, bans: [...banned.values()], chatPunishments: [...chatPunishments.values()] };
  };
  const cleanupMessages = (options = {}) => ({ ok: true, ...chatStore.cleanup(options), storage: chatStore.stats() });
  const configureChatStorage = (settings = {}) => ({ ok: true, ...chatStore.configure(settings), storage: chatStore.stats() });
  const flushPersistence = () => {
    chatStore.flush();
    reportStore.flush();
    persistBans();
    persistChatPunishments();
    return { ok: true };
  };
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
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { addLog('info', `Servidor iniciado na porta ${port}`); startSecondaryFederation(); resolve({ server, io, port, getStats, members, kick, ban, unban, punishChat, unpunishChat, updateAccessControl, updateRoomLayouts, updateNodeMetrics, updateServerProfile, redirectClientsForShutdown, closeFederation, cleanupMessages, configureChatStorage, flushPersistence, listReports, clearReports, configurePlugin: plugins.configure, pluginAction: plugins.action }); }); });
}
module.exports = { startSignalingServer, DEFAULT_ROOM_LAYOUT, normalizeRoomLayout, normalizeChannelSettings, hashRoomPassword, verifyRoomPassword };
