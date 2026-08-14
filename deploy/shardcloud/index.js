const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const packageInfo = require('./package.json');
const { loadPlugins } = require('./plugin-runtime');

const port = Number(process.env.PORT || process.env.SERVER_PORT || 80);
const MAX_VOICE_CHANNEL_SIZE = 6;
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
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const startedAt = Date.now();
const counters = { connections: 0, joins: 0, messages: 0, edits: 0, signals: 0 };
const releaseCache = { expiresAt: 0, value: null };
const pluginLogs = [];
const addPluginLog = (level, message) => { pluginLogs.unshift({ level, message, time: new Date().toISOString() }); if (pluginLogs.length > 40) pluginLogs.pop(); };
const safePresenceStatus = (value) => ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
const peersIn = (key) => [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
  const peer = io.sockets.sockets.get(id)?.data || {};
  return { id, name: peer.name || 'Visitante', color: peer.color || colors[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral') };
});
const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', { members: peersIn(serverRoom).filter((peer) => peer.id !== excludedId) });
const safeMentions = (serverRoom, mentions) => {
  if (!Array.isArray(mentions)) return [];
  const allowed = new Set(peersIn(serverRoom).map((peer) => peer.id));
  return [...new Set(mentions.map(String).filter((id) => allowed.has(id)))].slice(0, 16);
};
const musicFolder = path.join(__dirname, 'music');
fs.mkdirSync(musicFolder, { recursive: true });
const musicFiles = () => fs.readdirSync(musicFolder).filter((name) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
const pluginMessageId = () => `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const plugins = loadPlugins({
  directories: [path.join(__dirname, 'plugins')], stateFile: process.env.PLUGIN_STATE_FILE || path.join(__dirname, 'data', 'plugin-settings.json'), addLog: addPluginLog,
  emitSystemMessage: ({ room, textChannel, text, name, color, avatar, pluginId }) => {
    if (room && text) io.to(serverKey(room)).emit('text-message', { from: `plugin:${pluginId || 'server'}`, messageId: pluginMessageId(), createdAt: Date.now(), text, textChannel, name, color, avatar: avatar || '', pluginId });
  },
  emitPluginEvent: () => {}, media: { list: () => [], url: () => '' }
});

function aggregateStats() {
  const rooms = [...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('server:') && value.size > 0).length;
  const voiceChannels = [...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('voice:') && !key.endsWith(`:${LOBBY_CHANNEL}`) && value.size > 0).length;
  const connections = [...io.sockets.sockets.values()].filter((socket) => Boolean(socket.data.serverRoom)).length;
  return { ok: true, service: 'VoiceUP Server Cloud', version: packageInfo.version, mode: 'signaling', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), connections, rooms, voiceChannels, memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024), counters: { ...counters } };
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
  catch (error) { response.status(503).json({ ok: false, version: '1.1.0', pageUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', clientUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', serverUrl: 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest', message: error.message }); }
});

io.on('connection', (socket) => {
  counters.connections += 1;
  socket.on('join-room', ({ roomId, voiceChannel, name, color, avatar, clientId, status } = {}) => {
    const room = String(roomId || '').trim().slice(0, 48);
    const channel = safeChannel(voiceChannel, 'Geral');
    if (!room) return socket.emit('app-error', 'Informe um código de sala.');
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
    const peers = channel === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id);
    socket.emit('room-joined', { roomId: room, voiceChannel: channel, peers });
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
    socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers });
    if (channel !== LOBBY_CHANNEL) socket.to(next).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar, status: safePresenceStatus(socket.data.status) });
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('text-message', ({ text, textChannel, messageId, createdAt, mentions } = {}) => {
    if (!socket.data.serverRoom) return;
    const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
    const safeTextChannel = safeChannel(textChannel, 'geral'); const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
    const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
    socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds });
    if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
    counters.messages += 1;
    io.to(socket.data.serverRoom).emit('text-message', { from: socket.id, messageId: id, createdAt: sentAt, text: safeText, textChannel: safeTextChannel, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', mentions: safeMentionIds });
    plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || colors[0] }, serverIsCloud: true });
  });
  socket.on('edit-message', ({ messageId, text, textChannel, mentions } = {}) => {
    if (!socket.data.serverRoom) return;
    const id = safeMessageId(messageId, socket.id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
    if (!known || !safeText || safeChannel(textChannel, 'geral') !== known.textChannel) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
    counters.edits += 1; const safeMentionIds = safeMentions(socket.data.serverRoom, mentions); known.mentions = safeMentionIds;
    io.to(socket.data.serverRoom).emit('message-edited', { from: socket.id, messageId: id, text: safeText, textChannel: known.textChannel, editedAt: Date.now(), mentions: safeMentionIds });
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
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
