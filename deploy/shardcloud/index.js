const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const packageInfo = require('./package.json');
const { loadPlugins } = require('./plugin-runtime');
const { createPersistentChatStore, createBugReportStore } = require('./persistent-storage');

const port = Number(process.env.PORT || process.env.SERVER_PORT || 80);
const positiveInteger = (value, fallback) => { const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; };
const MAX_HUMAN_VOICE_CHANNEL_SIZE = Math.max(2, positiveInteger(process.env.VOICEUP_MAX_HUMANS_PER_CALL, 12));
const MAX_VOICE_CHANNEL_SIZE = Math.max(MAX_HUMAN_VOICE_CHANNEL_SIZE, positiveInteger(process.env.VOICEUP_MAX_MEMBERS_PER_CALL, 15));
const LOBBY_CHANNEL = '__lobby__';
const colors = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const safeIdentity = (value) => String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
const safeMessageId = (value, socketId) => {
  const owner = String(socketId || 'client').replace(/[^a-z0-9_-]/gi, '').slice(0, 36);
  const raw = String(value || Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, '').slice(0, 72);
  return raw.startsWith(`msg-${owner}-`) ? raw : `msg-${owner}-${raw}`;
};
const voiceKey = (room, channel) => `voice:${room}:${channel}`;
const serverKey = (room) => `server:${room}`;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '48kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const startedAt = Date.now();
const counters = { connections: 0, joins: 0, messages: 0, edits: 0, signals: 0 };
const releaseCache = { expiresAt: 0, value: null };
const pluginLogs = [];
const dataDirectory = path.resolve(process.env.VOICEUP_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data'));
const databaseFile = path.join(dataDirectory, 'voiceup.db');
const chatStore = createPersistentChatStore({ filePath: databaseFile, legacyFilePath: path.join(dataDirectory, 'chat-history.json'), maxPerRoom: positiveInteger(process.env.VOICEUP_CHAT_MAX_PER_ROOM, 300), retentionDays: Math.max(0, Number(process.env.VOICEUP_CHAT_RETENTION_DAYS) || 30) });
const reportStore = createBugReportStore({ filePath: databaseFile, legacyFilePath: path.join(dataDirectory, 'bug-reports.json') });
const reportRateLimits = new Map();
const roomPasswords = (() => { try { const value = JSON.parse(process.env.VOICEUP_ROOM_PASSWORDS || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } })();
// O cloud oficial usa a marca VoiceUP. Outros clouds podem apontar esta variável
// para um PNG/WEBP/JPG público próprio, sem precisar modificar o Client.
const serverProfile = {
  icon: /^https?:\/\/[^\s<>"']{1,900}$/i.test(String(process.env.VOICEUP_SERVER_ICON_URL || ''))
    ? String(process.env.VOICEUP_SERVER_ICON_URL)
    : 'https://voiceup.shardweb.app/assets/voiceup-logo.png'
};
const verifyRoomPassword = (room, password) => {
  const expected = String(roomPasswords[room] || '');
  if (!expected) return true;
  const scrypt = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/i.exec(expected);
  if (scrypt) {
    try {
      const reference = Buffer.from(scrypt[2], 'hex');
      const supplied = crypto.scryptSync(String(password || ''), Buffer.from(scrypt[1], 'hex'), reference.length);
      return supplied.length === reference.length && crypto.timingSafeEqual(supplied, reference);
    } catch { return false; }
  }
  const sha256 = /^sha256\$([a-f0-9]{64})$/i.exec(expected);
  const supplied = crypto.createHash('sha256').update(String(password || '')).digest();
  const reference = Buffer.from(sha256 ? sha256[1] : crypto.createHash('sha256').update(expected).digest('hex'), 'hex');
  return supplied.length === reference.length && crypto.timingSafeEqual(supplied, reference);
};
const addPluginLog = (level, message) => { pluginLogs.unshift({ level, message, time: new Date().toISOString() }); if (pluginLogs.length > 40) pluginLogs.pop(); };
const safePresenceStatus = (value) => ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
const peersIn = (key) => [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
  const peer = io.sockets.sockets.get(id)?.data || {};
  return { id, clientId: peer.clientId || '', name: peer.name || 'Visitante', color: peer.color || colors[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral') };
});
const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', { members: peersIn(serverRoom).filter((peer) => peer.id !== excludedId) });
const safeMentions = (serverRoom, mentions) => {
  if (!Array.isArray(mentions)) return [];
  const allowed = new Set(peersIn(serverRoom).map((peer) => peer.id));
  return [...new Set(mentions.map(String).filter((id) => allowed.has(id)))].slice(0, 16);
};
const stableMentionIds = (serverRoom, mentions) => {
  const allowed = new Set((Array.isArray(mentions) ? mentions : []).map(String));
  return [...new Set(peersIn(serverRoom).filter((peer) => allowed.has(String(peer.id)) && peer.clientId).map((peer) => String(peer.clientId)))].slice(0, 16);
};
const historyFor = (room) => chatStore.get(String(room || '').trim().slice(0, 48));
const messageById = (room, messageId) => chatStore.find(String(room || '').trim().slice(0, 48), messageId);
const rememberMessage = (room, packet) => {
  if (!room || !packet?.messageId || !packet?.text) return null;
  const stored = { ...packet, reactions: packet.reactions && typeof packet.reactions === 'object' ? packet.reactions : {}, pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '' };
  return chatStore.remember(room, stored);
};
const forgetMessage = (room, messageId) => chatStore.forget(room, messageId);
const safeReply = (room, reply) => {
  const source = reply?.messageId ? messageById(room, reply.messageId) : null;
  return source ? { messageId: source.messageId, name: String(source.name || 'Mensagem').slice(0, 24), text: String(source.text || '').slice(0, 120) } : null;
};
const musicFolder = path.join(__dirname, 'music');
fs.mkdirSync(musicFolder, { recursive: true });
const musicFiles = () => fs.readdirSync(musicFolder).filter((name) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
const pluginMessageId = () => `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const plugins = loadPlugins({
  directories: [path.join(__dirname, 'plugins')], stateFile: process.env.PLUGIN_STATE_FILE || path.join(__dirname, 'data', 'plugin-settings.json'), addLog: addPluginLog,
  emitSystemMessage: ({ room, textChannel, text, name, color, avatar, pluginId }) => {
    if (room && text) {
      const packet = { from: `plugin:${pluginId || 'server'}`, messageId: pluginMessageId(), createdAt: Date.now(), text, textChannel, name, color, avatar: avatar || '', pluginId, reactions: {}, pinned: false };
      rememberMessage(room, packet); io.to(serverKey(room)).emit('text-message', packet);
    }
  },
  emitPluginEvent: () => {}, media: { list: () => [], url: () => '' }
});

function aggregateStats() {
  const rooms = [...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('server:') && value.size > 0).length;
  const voiceChannels = [...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('voice:') && !key.endsWith(`:${LOBBY_CHANNEL}`) && value.size > 0).length;
  const connections = [...io.sockets.sockets.values()].filter((socket) => Boolean(socket.data.serverRoom)).length;
  return { ok: true, service: 'VoiceUP Server Cloud', version: packageInfo.version, mode: 'signaling', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), connections, rooms, voiceChannels, memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024), maxHumanVoiceChannelSize: MAX_HUMAN_VOICE_CHANNEL_SIZE, maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE, storage: { chat: chatStore.stats(), reports: reportStore.stats() }, counters: { ...counters } };
}

async function latestRelease() {
  if (releaseCache.value && releaseCache.expiresAt > Date.now()) return releaseCache.value;
  const response = await fetch('https://api.github.com/repos/HeitorDJAk47Gamer/VoiceUP/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VoiceUP-Cloud' } });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const release = await response.json();
  const normalize = (value) => String(value || '').toLowerCase().replace(/[._-]+/g, ' ');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const client = assets.find((asset) => normalize(asset.name).startsWith('voiceup setup'));
  const serverHost = assets.find((asset) => normalize(asset.name).startsWith('voiceupserver setup'));
  releaseCache.value = { ok: true, version: String(release.tag_name || release.name || '').replace(/^v/i, '') || 'mais recente', pageUrl: release.html_url, clientUrl: client?.browser_download_url || release.html_url, serverUrl: serverHost?.browser_download_url || release.html_url, publishedAt: release.published_at || '' };
  releaseCache.expiresAt = Date.now() + 15 * 60 * 1000;
  return releaseCache.value;
}

app.disable('x-powered-by');
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d', fallthrough: false }));
app.get('/site.css', (_request, response) => response.sendFile(path.join(__dirname, 'site.css')));
app.get('/site.js', (_request, response) => response.sendFile(path.join(__dirname, 'site.js')));
app.get('/', (_request, response) => response.sendFile(path.join(__dirname, 'site.html')));
app.get('/status', (_request, response) => response.sendFile(path.join(__dirname, 'status.html')));
app.get('/plugins', (_request, response) => response.sendFile(path.join(__dirname, 'plugins.html')));
app.get('/privacidade', (_request, response) => response.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/termos', (_request, response) => response.sendFile(path.join(__dirname, 'terms.html')));
const downloadablePlugins = new Map([['dados', 'dados.js'], ['musica', 'musica.js'], ['xp-chat', 'xp-chat.js']]);
app.get('/downloads/plugins/:plugin', (request, response) => {
  const fileName = downloadablePlugins.get(String(request.params.plugin || '').toLowerCase());
  if (!fileName) return response.status(404).json({ ok: false, message: 'Plugin não encontrado.' });
  response.set('Cache-Control', 'public, max-age=300');
  return response.download(path.join(__dirname, 'plugins', fileName), fileName);
});
app.get('/health', (_request, response) => response.json({ ...aggregateStats(), maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE, plugins: plugins.list(), pluginErrors: plugins.errors(), pluginLogs, musicFiles: musicFiles() }));
app.get('/stats', (_request, response) => response.json(aggregateStats()));
app.get('/api/status', (_request, response) => {
  const stats = aggregateStats();
  response.set('Cache-Control', 'no-store');
  response.json({ ok: stats.ok, service: stats.service, version: stats.version, uptimeSeconds: stats.uptimeSeconds, connections: stats.connections, rooms: stats.rooms, voiceChannels: stats.voiceChannels, memoryMb: stats.memoryMb, joins: stats.counters.joins, signals: stats.counters.signals });
});
app.get('/api/release', async (_request, response) => {
  response.set('Cache-Control', 'public, max-age=300');
  try { response.json(await latestRelease()); }
  catch (error) { response.status(503).json({ ok: false, version: packageInfo.version, pageUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', clientUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', serverUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', message: error.message }); }
});
app.use('/api/bug-reports', (_request, response, next) => { response.set('Access-Control-Allow-Origin', '*'); response.set('Access-Control-Allow-Headers', 'Content-Type'); response.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); next(); });
app.options('/api/bug-reports', (_request, response) => response.sendStatus(204));
app.post('/api/bug-reports', (request, response) => {
  const key = String(request.ip || request.socket?.remoteAddress || 'unknown'); const now = Date.now(); const recent = (reportRateLimits.get(key) || []).filter((time) => now - time < 600000);
  if (recent.length >= 4) return response.status(429).json({ ok: false, message: 'Aguarde alguns minutos antes de enviar outro relatório.' });
  const report = reportStore.add(request.body || {}); if (!report) return response.status(400).json({ ok: false, message: 'Descreva o problema encontrado.' });
  recent.push(now); reportRateLimits.set(key, recent); return response.status(201).json({ ok: true, id: report.id, message: 'Relatório enviado ao servidor global.' });
});

io.on('connection', (socket) => {
  counters.connections += 1;
  socket.on('join-room', ({ roomId, roomPassword, voiceChannel, name, color, avatar, clientId, status } = {}) => {
    const room = String(roomId || '').trim().slice(0, 48);
    const channel = safeChannel(voiceChannel, 'Geral');
    if (!room) return socket.emit('app-error', 'Informe um código de sala.');
    if (!verifyRoomPassword(room, roomPassword)) { socket.emit('room-password-required', { roomId: room, message: 'Esta sala é privada. Informe a senha correta.' }); return socket.emit('app-error', 'Esta sala é privada. Informe a senha correta.'); }
    const voiceRoom = voiceKey(room, channel);
    if (channel !== LOBBY_CHANNEL && (io.sockets.adapter.rooms.get(voiceRoom)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
    const requestedColor = colors.includes(color) ? color : colors[0];
    const used = peersIn(serverKey(room)).map((peer) => peer.color);
    const safeColor = used.includes(requestedColor) ? colors.find((candidate) => !used.includes(candidate)) || requestedColor : requestedColor;
    const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
    const safeAvatar = typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length <= 150000 ? avatar : '';
    socket.join(serverKey(room)); socket.join(voiceRoom);
    Object.assign(socket.data, { room, serverRoom: serverKey(room), voiceRoom, voiceChannel: channel, name: safeName, color: safeColor, avatar: safeAvatar, status: safePresenceStatus(status), clientId: safeIdentity(clientId), joinedAt: Date.now() });
    counters.joins += 1;
    socket.emit('color-assigned', { color: safeColor });
    socket.emit('server-profile', { ...serverProfile });
    socket.emit('room-layout', { id: room, name: room, managed: false, private: Boolean(roomPasswords[room]), voiceChannels: ['Geral', 'Jogando', 'Ausente'], textChannels: ['geral', 'conversa', 'avisos'], voiceChannelSettings: ['Geral', 'Jogando', 'Ausente'].map((channel, position) => ({ id: channel.toLowerCase(), name: channel, position, humans: MAX_HUMAN_VOICE_CHANNEL_SIZE, total: MAX_VOICE_CHANNEL_SIZE })), limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE } });
    const peers = channel === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id);
    socket.emit('room-joined', { roomId: room, voiceChannel: channel, peers, limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE }, serverProfile: { ...serverProfile } });
    socket.emit('chat-history', { messages: historyFor(room) });
    if (channel !== LOBBY_CHANNEL) socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar, status: socket.data.status });
    broadcastPresence(serverKey(room));
  });
  socket.on('request-room-presence', () => { if (socket.data.serverRoom) socket.emit('room-presence', { members: peersIn(socket.data.serverRoom) }); });
  socket.on('presence-update', ({ status } = {}) => {
    if (!socket.data.serverRoom) return;
    const nextStatus = safePresenceStatus(status);
    if (nextStatus === socket.data.status) return;
    socket.data.status = nextStatus;
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('switch-voice-channel', ({ voiceChannel } = {}) => {
    if (!socket.data.room) return;
    const channel = safeChannel(voiceChannel, 'Geral'); const next = voiceKey(socket.data.room, channel);
    if (next === socket.data.voiceRoom) return;
    if (channel !== LOBBY_CHANNEL && (io.sockets.adapter.rooms.get(next)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
    if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
    socket.leave(socket.data.voiceRoom); socket.join(next); socket.data.voiceRoom = next; socket.data.voiceChannel = channel;
    const peers = channel === LOBBY_CHANNEL ? [] : peersIn(next).filter((peer) => peer.id !== socket.id);
    socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers, limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE }, serverProfile: { ...serverProfile } });
    if (channel !== LOBBY_CHANNEL) socket.to(next).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar, status: safePresenceStatus(socket.data.status) });
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('text-message', ({ text, textChannel, messageId, createdAt, mentions, reply } = {}) => {
    if (!socket.data.serverRoom) return;
    const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
    const safeTextChannel = safeChannel(textChannel, 'geral'); const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
    const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
    const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
    const replyPacket = safeReply(socket.data.room, reply);
    socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds, mentionClientIds });
    if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
    counters.messages += 1;
    const packet = { from: socket.id, authorClientId: socket.data.clientId || '', messageId: id, createdAt: sentAt, text: safeText, textChannel: safeTextChannel, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', mentions: safeMentionIds, mentionClientIds, reply: replyPacket, reactions: {}, pinned: false };
    rememberMessage(socket.data.room, packet); io.to(socket.data.serverRoom).emit('text-message', packet);
    plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || colors[0] }, serverIsCloud: true });
  });
  socket.on('edit-message', ({ messageId, text, textChannel, mentions } = {}) => {
    if (!socket.data.serverRoom) return;
    const id = String(messageId || ''); const stored = messageById(socket.data.room, id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
    const ownsMessage = stored && (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id);
    if ((!known && !ownsMessage) || !safeText || safeChannel(textChannel, 'geral') !== (stored?.textChannel || known?.textChannel)) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
    counters.edits += 1; const safeMentionIds = safeMentions(socket.data.serverRoom, mentions); const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds); if (known) Object.assign(known, { mentions: safeMentionIds, mentionClientIds });
    const editedAt = Date.now(); if (stored) { Object.assign(stored, { text: safeText, editedAt, mentions: safeMentionIds, mentionClientIds }); chatStore.save(socket.data.room, stored); }
    io.to(socket.data.serverRoom).emit('message-edited', { from: socket.id, messageId: id, text: safeText, textChannel: stored?.textChannel || known.textChannel, editedAt, mentions: safeMentionIds, mentionClientIds });
  });
  socket.on('react-message', ({ messageId, emoji } = {}) => {
    if (!socket.data.serverRoom) return;
    const stored = messageById(socket.data.room, messageId); const safeEmoji = String(emoji || '').trim().slice(0, 12);
    if (!stored || !safeEmoji) return socket.emit('app-error', 'Não foi possível reagir a essa mensagem.');
    stored.reactions ||= {}; const actor = socket.data.clientId || socket.id; const actors = new Set(Array.isArray(stored.reactions[safeEmoji]) ? stored.reactions[safeEmoji] : []);
    if (actors.has(actor)) actors.delete(actor); else actors.add(actor);
    if (actors.size) stored.reactions[safeEmoji] = [...actors]; else delete stored.reactions[safeEmoji];
    chatStore.save(socket.data.room, stored);
    io.to(socket.data.serverRoom).emit('message-reaction', { messageId: stored.messageId, textChannel: stored.textChannel, reactions: stored.reactions });
  });
  socket.on('pin-message', ({ messageId, pinned } = {}) => {
    if (!socket.data.serverRoom) return;
    const stored = messageById(socket.data.room, messageId); if (!stored) return socket.emit('app-error', 'Mensagem não encontrada.');
    stored.pinned = Boolean(pinned); stored.pinnedBy = socket.data.clientId || socket.id;
    chatStore.save(socket.data.room, stored);
    io.to(socket.data.serverRoom).emit('message-pinned', { messageId: stored.messageId, textChannel: stored.textChannel, pinned: stored.pinned, pinnedBy: stored.pinnedBy });
  });
  socket.on('delete-message', ({ messageId } = {}) => {
    if (!socket.data.serverRoom) return;
    const stored = messageById(socket.data.room, messageId);
    const ownsMessage = stored && (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id);
    if (!ownsMessage) return socket.emit('app-error', 'Você só pode apagar suas próprias mensagens.');
    forgetMessage(socket.data.room, stored.messageId); socket.data.chatMessages?.delete(stored.messageId);
    io.to(socket.data.serverRoom).emit('message-deleted', { messageId: stored.messageId, textChannel: stored.textChannel });
  });
  socket.on('signal', ({ target, data } = {}) => {
    if (!target || !socket.data.serverRoom) return;
    const targetSocket = io.sockets.sockets.get(String(target));
    if (!targetSocket || targetSocket.data.serverRoom !== socket.data.serverRoom) return;
    counters.signals += 1;
    targetSocket.emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), data });
  });
  socket.on('latency-ping', ({ sentAt } = {}) => socket.emit('latency-pong', { sentAt }));
  socket.on('disconnecting', () => {
    if (socket.data.voiceRoom && socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
    if (socket.data.serverRoom) broadcastPresence(socket.data.serverRoom, socket.id);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`VoiceUP Server Cloud ${packageInfo.version} ativo na porta ${port}`));
function shutdown() { chatStore.close(); reportStore.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
