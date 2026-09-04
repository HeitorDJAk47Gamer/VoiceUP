const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const packageInfo = require('./package.json');
const { loadPlugins } = require('./plugin-runtime');
const { createPersistentChatStore, createBugReportStore } = require('./persistent-storage');
const { createSiteRouter } = require('./site-assets');

const port = Number(process.env.PORT || process.env.SERVER_PORT || 80);
const positiveInteger = (value, fallback) => { const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; };
const nonNegativeInteger = (value, fallback) => { const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback; };
const MAX_HUMAN_VOICE_CHANNEL_SIZE = Math.max(2, positiveInteger(process.env.VOICEUP_MAX_HUMANS_PER_CALL, 12));
const MAX_VOICE_CHANNEL_SIZE = Math.max(MAX_HUMAN_VOICE_CHANNEL_SIZE, positiveInteger(process.env.VOICEUP_MAX_MEMBERS_PER_CALL, 15));
const MAX_IDENTITY_RECORDS = Math.min(200000, Math.max(1000, positiveInteger(process.env.VOICEUP_MAX_IDENTITIES, 50000)));
const LOBBY_CHANNEL = '__lobby__';
const colors = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const safeIdentity = (value) => {
  const identity = String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  return ['__proto__', 'prototype', 'constructor'].includes(identity.toLowerCase()) ? '' : identity;
};
const safeDataImage = (value, max = 150000) => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= max ? value : '';
const safeSecretEqual = (left, right) => {
  const first = Buffer.from(String(left || ''), 'utf8'); const second = Buffer.from(String(right || ''), 'utf8');
  return first.length > 0 && first.length === second.length && crypto.timingSafeEqual(first, second);
};
const identityProofText = (challenge, socketId, room, clientId) => `voiceup-identity-v1\n${challenge}\n${socketId}\n${room}\n${clientId}`;
const safeMessageId = (value, socketId) => {
  const owner = String(socketId || 'client').replace(/[^a-z0-9_-]/gi, '').slice(0, 36);
  const raw = String(value || Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, '').slice(0, 72);
  return raw.startsWith(`msg-${owner}-`) ? raw : `msg-${owner}-${raw}`;
};
const voiceKey = (room, channel) => `voice:${room}:${channel}`;
const serverKey = (room) => `server:${room}`;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '48kb' }));
app.use((_request, response, next) => {
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('Referrer-Policy', 'no-referrer');
  response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), display-capture=()');
  response.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'");
  if (String(_request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || _request.secure) response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
const server = http.createServer(app);
const configuredOrigins = new Set(String(process.env.VOICEUP_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean));
configuredOrigins.add('https://voiceup.shardweb.app');
const allowedOrigin = (origin) => {
  const value = String(origin || '').replace(/\/$/, '');
  if (!value || value === 'null' || value === 'file:/' || value === 'file://') return true;
  if (configuredOrigins.has(value)) return true;
  try { const target = new URL(value); return ['http:', 'https:'].includes(target.protocol) && ['localhost', '127.0.0.1', '::1'].includes(target.hostname); }
  catch { return false; }
};
const io = new Server(server, {
  cors: { origin: (origin, callback) => callback(allowedOrigin(origin) ? null : new Error('Origem não autorizada.'), allowedOrigin(origin)), methods: ['GET', 'POST'] },
  allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin)),
  maxHttpBufferSize: 256 * 1024,
  perMessageDeflate: false
});
const startedAt = Date.now();
const counters = { connections: 0, joins: 0, messages: 0, edits: 0, signals: 0 };
const releaseCache = { expiresAt: 0, value: null };
const releaseDownloads = require('./release-downloads');
const pluginLogs = [];
const dataDirectory = path.resolve(process.env.VOICEUP_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data'));
const databaseFile = path.join(dataDirectory, 'voiceup.db');
const chatStore = createPersistentChatStore({ filePath: databaseFile, legacyFilePath: path.join(dataDirectory, 'chat-history.json'), maxPerRoom: positiveInteger(process.env.VOICEUP_CHAT_MAX_PER_ROOM, 300), retentionDays: nonNegativeInteger(process.env.VOICEUP_CHAT_RETENTION_DAYS, 30) });
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
const identityFile = path.join(dataDirectory, 'client-identities.json');
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
}
catch { /* first start */ }
const persistIdentityRegistry = () => {
  try { fs.mkdirSync(path.dirname(identityFile), { recursive: true }); fs.writeFileSync(identityFile, JSON.stringify(identityRegistry, null, 2), 'utf8'); }
  catch (error) { addPluginLog('error', `Não foi possível salvar as identidades protegidas: ${String(error.message || '').slice(0, 140)}`); }
};
const issueIdentityChallenge = (socket) => {
  const challenge = crypto.randomBytes(32).toString('base64url');
  socket.data.identityChallenge = challenge; socket.data.identityChallengeAt = Date.now();
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
    if (!crypto.verify('sha256', Buffer.from(identityProofText(challenge, socket.id, room, identity)), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) return { ok: false, reason: 'assinatura recusada' };
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
const consumeRate = (socket, bucket, limit, windowMs) => {
  socket.data.rateLimits ||= new Map(); const now = Date.now(); const recent = (socket.data.rateLimits.get(bucket) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) { if (now - Number(socket.data.lastRateWarningAt || 0) > 2500) { socket.data.lastRateWarningAt = now; socket.emit('app-error', 'Muitas ações em pouco tempo. Aguarde alguns segundos.'); } socket.data.rateLimits.set(bucket, recent); return false; }
  recent.push(now); socket.data.rateLimits.set(bucket, recent); return true;
};
const safeClientPlatform = (value) => typeof value === 'string' && ['windows', 'linux', 'android', 'selfweb'].includes(value) ? value : '';
const safePresenceStatus = (value) => ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online';
const safeAudioState = (value) => ({ micMuted: value?.micMuted === true, outputMuted: value?.outputMuted === true });
const safeMediaState = (value) => ({ screen: value?.screen === true, camera: value?.camera === true });
const voiceActivityByRoom = new Map();
const peersIn = (key) => [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
  const peer = io.sockets.sockets.get(id)?.data || {};
  return { id, clientId: peer.clientId || '', name: peer.name || 'Visitante', color: peer.color || colors[0], avatar: peer.avatar || '', status: safePresenceStatus(peer.status), platform: safeClientPlatform(peer.platform), voiceChannel: peer.voiceChannel === LOBBY_CHANNEL ? '' : (peer.voiceChannel || 'Geral'), voiceupAudioState: safeAudioState(peer.voiceupAudioState), ...(peer.voiceupMediaState ? { voiceupMediaState: safeMediaState(peer.voiceupMediaState) } : {}) };
});
const roomPresencePacket = (serverRoom, excludedId) => {
  const members = peersIn(serverRoom).filter((peer) => peer.id !== excludedId);
  const serverTime = Date.now();
  const starts = voiceActivityByRoom.get(serverRoom) || new Map();
  const occupied = new Set(members.map((member) => member.voiceChannel).filter(Boolean));
  for (const channel of starts.keys()) if (!occupied.has(channel)) starts.delete(channel);
  for (const channel of occupied) if (!starts.has(channel)) starts.set(channel, serverTime);
  if (starts.size) voiceActivityByRoom.set(serverRoom, starts); else voiceActivityByRoom.delete(serverRoom);
  return { members, serverTime, voiceActivity: [...starts].map(([voiceChannel, startedAt]) => ({ voiceChannel, startedAt })) };
};
const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', roomPresencePacket(serverRoom, excludedId));
const leaveCurrentMembership = (socket) => {
  const previousServerRoom = socket.data.serverRoom; const previousVoiceRoom = socket.data.voiceRoom;
  if (previousVoiceRoom) { if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(previousVoiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name || 'Visitante' }); socket.leave(previousVoiceRoom); }
  if (previousServerRoom) socket.leave(previousServerRoom);
  Object.assign(socket.data, { room: '', serverRoom: '', voiceRoom: '', voiceChannel: LOBBY_CHANNEL });
  if (previousServerRoom) broadcastPresence(previousServerRoom, socket.id);
};
// A reconnect creates a fresh Socket.IO id.  Keep one active session for a
// persisted client profile so a stale network socket cannot appear as a second
// participant in the room.
const duplicateSessionsFor = (room, identity, socketId) => {
  if (!identity) return [];
  return [...io.sockets.sockets.values()].filter((candidate) => candidate.id !== socketId
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
const officialPluginHashes = ['dados.js', 'musica.js', 'xp-chat.js'].map((file) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'plugins', file))).digest('hex'); } catch { return ''; }
}).filter(Boolean);
const operatorPluginHashes = String(process.env.VOICEUP_TRUSTED_PLUGIN_HASHES || '').split(',').map((value) => value.trim().toLowerCase()).filter((value) => /^[a-f0-9]{64}$/.test(value));
const plugins = loadPlugins({
  directories: [path.join(__dirname, 'plugins')],
  trustedPluginHashes: [...officialPluginHashes, ...operatorPluginHashes],
  stateFile: process.env.PLUGIN_STATE_FILE || path.join(__dirname, 'data', 'plugin-settings.json'),
  addLog: addPluginLog,
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
function publicStats() {
  const stats = aggregateStats();
  return { ok: stats.ok, service: stats.service, version: stats.version, mode: stats.mode, uptimeSeconds: stats.uptimeSeconds, connections: stats.connections, rooms: stats.rooms, voiceChannels: stats.voiceChannels, memoryMb: stats.memoryMb, maxHumanVoiceChannelSize: stats.maxHumanVoiceChannelSize, maxVoiceChannelSize: stats.maxVoiceChannelSize, joins: stats.counters.joins, signals: stats.counters.signals };
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
app.use(createSiteRouter(__dirname));
app.get('/downloads/selfweb', (_request, response) => releaseDownloads.download('selfweb', response));
app.get('/downloads/android', (_request, response) => releaseDownloads.download('android', response));
app.get('/downloads/linux/:target', (request, response) => {
  const target = String(request.params.target || '');
  if (target === 'guide') return response.type('text/plain').sendFile(path.join(__dirname, 'downloads/VoiceUP-Linux-LEIA-ME.txt'));
  if (target === 'checksums') { try { const catalog=releaseDownloads.catalog().payload; return response.type('text/plain').send(catalog.artifacts.filter(file=>file.platform==='linux').map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n'); } catch { return response.sendStatus(503); } }
  if (!['client','server'].includes(target)) return response.sendStatus(404);
  return releaseDownloads.download(target === 'client' ? 'linux' : 'linux-server', response);
});
app.get('/api/linux-release', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try { const client=releaseDownloads.entryFor('linux'); const server=releaseDownloads.entryFor('linux-server');
    response.json({ok:true,available:true,version:packageInfo.version,platform:'linux',arch:'x64',format:'AppImage',clientUrl:'/downloads/linux/client',serverUrl:'/downloads/linux/server',checksumsUrl:'/downloads/linux/checksums'});
  } catch { response.json({ok:true,available:false,version:packageInfo.version,platform:'linux'}); }
});
const downloadablePlugins = new Map([['dados', 'dados.js'], ['musica', 'musica.js'], ['xp-chat', 'xp-chat.js']]);
app.get('/downloads/plugins/:plugin', (request, response) => {
  const fileName = downloadablePlugins.get(String(request.params.plugin || '').toLowerCase());
  if (!fileName) return response.status(404).json({ ok: false, message: 'Plugin não encontrado.' });
  response.set('Cache-Control', 'public, max-age=300');
  return response.download(path.join(__dirname, 'plugins', fileName), fileName);
});
app.get('/health', (_request, response) => { response.set('Cache-Control', 'no-store'); response.json(publicStats()); });
app.get('/stats', (_request, response) => { response.set('Cache-Control', 'no-store'); response.json(publicStats()); });
app.get(['/admin/health', '/api/admin/health'], (request, response) => {
  const configuredToken = String(process.env.VOICEUP_ADMIN_TOKEN || '');
  if (configuredToken.length < 24) return response.status(404).json({ ok: false, message: 'Não encontrado.' });
  const suppliedToken = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!safeSecretEqual(suppliedToken, configuredToken)) { response.set('WWW-Authenticate', 'Bearer'); return response.status(401).json({ ok: false, message: 'Não autorizado.' }); }
  response.set('Cache-Control', 'no-store');
  return response.json({ ...aggregateStats(), plugins: plugins.list(), pluginErrors: plugins.errors(), pluginLogs, musicFiles: musicFiles() });
});
app.get('/api/status', (_request, response) => {
  const stats = publicStats();
  response.set('Cache-Control', 'no-store');
  response.json(stats);
});
app.get('/api/mobile-release', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try { const file=releaseDownloads.entryFor('android'); response.json({ok:true,platform:'android',version:packageInfo.version,fileName:file.name,sha256:file.sha256,minAndroid:'6.0',downloadUrl:'/downloads/android'}); }
  catch { response.status(503).json({ok:false,message:'APK verificado indisponível.'}); }
});
app.get('/api/release-integrity', (_request, response) => {
  response.set('Cache-Control', 'no-store').set('Access-Control-Allow-Origin','*');
  try { response.json(releaseDownloads.catalog().envelope); } catch { response.sendStatus(503); }
});
app.get('/api/release', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try { const {payload}=releaseDownloads.catalog(); response.json({ok:true,version:payload.version,pageUrl:`https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/tag/v${payload.version}`,clientUrl:releaseDownloads.entryFor('client').url,serverUrl:releaseDownloads.entryFor('server').url}); }
  catch { try {response.json(await latestRelease());} catch {response.status(503).json({ok:false,message:'Downloads temporariamente indisponíveis.'});} }
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
  socket.on('identity-challenge-request', () => { if (consumeRate(socket, 'identity-challenge', 8, 60000)) issueIdentityChallenge(socket); });
  socket.on('join-room', (payload = {}) => {
    if (!payload || typeof payload !== 'object' || !consumeRate(socket, 'join', 12, 60000)) return;
    const { roomId, roomPassword, voiceChannel, name, color, avatar, clientId, status, capabilities } = payload;
    const room = String(roomId || '').trim().slice(0, 48);
    const channel = safeChannel(voiceChannel, 'Geral');
    if (!room) return socket.emit('app-error', 'Informe um código de sala.');
    if (!verifyRoomPassword(room, roomPassword)) { socket.emit('room-password-required', { roomId: room, message: 'Esta sala é privada. Informe a senha correta.' }); return socket.emit('app-error', 'Esta sala é privada. Informe a senha correta.'); }
    const identity = safeIdentity(clientId);
    const safeCapabilities = Array.isArray(capabilities) ? [...new Set(capabilities.map((value) => String(value || '').trim().slice(0, 48)).filter(Boolean))].slice(0, 16) : [];
    const supportsIdentityProof = safeCapabilities.includes('identity-proof-v1');
    let identityFingerprint = '';
    if (supportsIdentityProof) {
      const proof = verifyIdentityProof(socket, payload, room, identity);
      if (!proof.ok) { socket.emit('identity-proof-required', { message: `Não foi possível confirmar a identidade deste perfil (${proof.reason}).` }); issueIdentityChallenge(socket); return; }
      identityFingerprint = proof.fingerprint;
    } else if (identity && identityRegistry.clients[identity]?.fingerprint) {
      socket.emit('identity-proof-required', { message: 'Este perfil já usa identidade protegida. Atualize o VoiceUP para continuar com ele.' });
      return;
    }
    const voiceRoom = voiceKey(room, channel);
    const staleSessions = duplicateSessionsFor(room, identity, socket.id);
    const staleSessionIds = new Set(staleSessions.map((candidate) => candidate.id));
    const activeVoicePeers = peersIn(voiceRoom).filter((peer) => peer.id !== socket.id && !staleSessionIds.has(peer.id));
    if (channel !== LOBBY_CHANNEL && activeVoicePeers.length >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
    const requestedColor = colors.includes(color) ? color : colors[0];
    const used = peersIn(serverKey(room)).filter((peer) => !staleSessionIds.has(peer.id)).map((peer) => peer.color);
    const safeColor = used.includes(requestedColor) ? colors.find((candidate) => !used.includes(candidate)) || requestedColor : requestedColor;
    const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
    const safeAvatar = safeDataImage(avatar);
    leaveCurrentMembership(socket);
    socket.join(serverKey(room)); socket.join(voiceRoom);
    Object.assign(socket.data, { room, serverRoom: serverKey(room), voiceRoom, voiceChannel: channel, name: safeName, color: safeColor, avatar: safeAvatar, status: safePresenceStatus(status), platform: safeClientPlatform(payload.platform), clientId: identity, identityFingerprint, identityVerified: Boolean(identityFingerprint), capabilities: safeCapabilities, joinedAt: Date.now() });
    replaceDuplicateSessions(staleSessions);
    counters.joins += 1;
    socket.emit('color-assigned', { color: safeColor });
    socket.emit('server-profile', { ...serverProfile });
    socket.emit('room-layout', { id: room, name: room, managed: false, private: Boolean(roomPasswords[room]), voiceChannels: ['Geral', 'Jogando', 'Ausente'], textChannels: ['geral', 'conversa', 'avisos'], voiceChannelSettings: ['Geral', 'Jogando', 'Ausente'].map((channel, position) => ({ id: channel.toLowerCase(), name: channel, position, humans: MAX_HUMAN_VOICE_CHANNEL_SIZE, total: MAX_VOICE_CHANNEL_SIZE })), limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE } });
    const peers = channel === LOBBY_CHANNEL ? [] : peersIn(voiceRoom).filter((peer) => peer.id !== socket.id && !staleSessionIds.has(peer.id));
    socket.emit('room-joined', { roomId: room, voiceChannel: channel, peers, limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE }, serverProfile: { ...serverProfile } });
    socket.emit('chat-history', { messages: historyFor(room) });
    if (channel !== LOBBY_CHANNEL) socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar, clientId: identity, status: socket.data.status, platform: safeClientPlatform(socket.data.platform) });
    broadcastPresence(serverKey(room));
  });
  socket.on('request-room-presence', () => { if (socket.data.serverRoom && consumeRate(socket, 'presence-request', 20, 10000)) socket.emit('room-presence', roomPresencePacket(socket.data.serverRoom)); });
  socket.on('presence-update', ({ status, platform } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'presence-update', 20, 30000)) return;
    const nextStatus = status === undefined ? socket.data.status : safePresenceStatus(status);
    const nextPlatform = safeClientPlatform(platform) || safeClientPlatform(socket.data.platform);
    if (nextStatus === socket.data.status && nextPlatform === socket.data.platform) return;
    socket.data.status = nextStatus;
    socket.data.platform = nextPlatform;
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('media-state-update', (value = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'media-state-update', 40, 10000)) return;
    const state = safeMediaState(value);
    const previous = socket.data.voiceupMediaState;
    if (previous && state.screen === previous.screen && state.camera === previous.camera) return;
    socket.data.voiceupMediaState = state;
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('audio-state-update', (value = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'audio-state-update', 40, 10000)) return;
    const state = safeAudioState(value);
    const previous = safeAudioState(socket.data.voiceupAudioState);
    if (state.micMuted === previous.micMuted && state.outputMuted === previous.outputMuted) return;
    socket.data.voiceupAudioState = state;
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('switch-voice-channel', ({ voiceChannel } = {}) => {
    if (!socket.data.room || !consumeRate(socket, 'voice-switch', 16, 30000)) return;
    const channel = safeChannel(voiceChannel, 'Geral'); const next = voiceKey(socket.data.room, channel);
    if (next === socket.data.voiceRoom) return;
    if (channel !== LOBBY_CHANNEL && (io.sockets.adapter.rooms.get(next)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
    if (socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
    socket.leave(socket.data.voiceRoom); socket.join(next); socket.data.voiceRoom = next; socket.data.voiceChannel = channel;
    const peers = channel === LOBBY_CHANNEL ? [] : peersIn(next).filter((peer) => peer.id !== socket.id);
    socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers, limits: { humansPerCall: MAX_HUMAN_VOICE_CHANNEL_SIZE, membersPerCall: MAX_VOICE_CHANNEL_SIZE }, serverProfile: { ...serverProfile } });
    if (channel !== LOBBY_CHANNEL) socket.to(next).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar, clientId: socket.data.clientId || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform) });
    broadcastPresence(socket.data.serverRoom);
  });
  socket.on('text-message', ({ text, textChannel, messageId, createdAt, mentions, reply } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'text', 30, 10000)) return;
    const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
    const safeTextChannel = safeChannel(textChannel, 'geral'); const id = safeMessageId(messageId, socket.id); const sentAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
    const safeMentionIds = safeMentions(socket.data.serverRoom, mentions);
    const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds);
    const replyPacket = safeReply(socket.data.room, reply);
    socket.data.chatMessages ||= new Map(); socket.data.chatMessages.set(id, { textChannel: safeTextChannel, mentions: safeMentionIds, mentionClientIds });
    if (socket.data.chatMessages.size > 250) socket.data.chatMessages.delete(socket.data.chatMessages.keys().next().value);
    counters.messages += 1;
    const packet = { from: socket.id, authorClientId: socket.data.clientId || '', authorIdentityFingerprint: socket.data.identityFingerprint || '', messageId: id, createdAt: sentAt, text: safeText, textChannel: safeTextChannel, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', mentions: safeMentionIds, mentionClientIds, reply: replyPacket, reactions: {}, pinned: false };
    rememberMessage(socket.data.room, packet); io.to(socket.data.serverRoom).emit('text-message', packet);
    plugins.onTextMessage({ text: safeText, room: socket.data.room, textChannel: safeTextChannel, voiceChannel: socket.data.voiceChannel, user: { id: socket.id, clientId: socket.data.clientId || '', name: socket.data.name || 'Visitante', color: socket.data.color || colors[0] }, serverIsCloud: true });
  });
  socket.on('edit-message', ({ messageId, text, textChannel, mentions } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'message-edit', 24, 10000)) return;
    const id = String(messageId || ''); const stored = messageById(socket.data.room, id); const known = socket.data.chatMessages?.get(id); const safeText = String(text || '').trim().slice(0, 500);
    const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
    if ((!known && !ownsMessage) || !safeText || safeChannel(textChannel, 'geral') !== (stored?.textChannel || known?.textChannel)) return socket.emit('app-error', 'Não foi possível editar essa mensagem.');
    counters.edits += 1; const safeMentionIds = safeMentions(socket.data.serverRoom, mentions); const mentionClientIds = stableMentionIds(socket.data.serverRoom, safeMentionIds); if (known) Object.assign(known, { mentions: safeMentionIds, mentionClientIds });
    const editedAt = Date.now(); if (stored) { Object.assign(stored, { text: safeText, editedAt, mentions: safeMentionIds, mentionClientIds }); chatStore.save(socket.data.room, stored); }
    io.to(socket.data.serverRoom).emit('message-edited', { from: socket.id, messageId: id, text: safeText, textChannel: stored?.textChannel || known.textChannel, editedAt, mentions: safeMentionIds, mentionClientIds });
  });
  socket.on('react-message', ({ messageId, emoji } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'message-reaction', 40, 10000)) return;
    const stored = messageById(socket.data.room, messageId); const safeEmoji = String(emoji || '').trim().slice(0, 12);
    if (!stored || !safeEmoji) return socket.emit('app-error', 'Não foi possível reagir a essa mensagem.');
    stored.reactions ||= {}; const actor = socket.data.identityFingerprint ? `key:${socket.data.identityFingerprint}` : (socket.data.clientId || socket.id); const actors = new Set(Array.isArray(stored.reactions[safeEmoji]) ? stored.reactions[safeEmoji] : []);
    if (actors.has(actor)) actors.delete(actor); else actors.add(actor);
    if (actors.size) stored.reactions[safeEmoji] = [...actors]; else delete stored.reactions[safeEmoji];
    chatStore.save(socket.data.room, stored);
    io.to(socket.data.serverRoom).emit('message-reaction', { messageId: stored.messageId, textChannel: stored.textChannel, reactions: stored.reactions });
  });
  socket.on('pin-message', ({ messageId, pinned } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'message-pin', 20, 10000)) return;
    const stored = messageById(socket.data.room, messageId); if (!stored) return socket.emit('app-error', 'Mensagem não encontrada.');
    stored.pinned = Boolean(pinned); stored.pinnedBy = socket.data.clientId || socket.id;
    chatStore.save(socket.data.room, stored);
    io.to(socket.data.serverRoom).emit('message-pinned', { messageId: stored.messageId, textChannel: stored.textChannel, pinned: stored.pinned, pinnedBy: stored.pinnedBy });
  });
  socket.on('delete-message', ({ messageId } = {}) => {
    if (!socket.data.serverRoom || !consumeRate(socket, 'message-delete', 20, 10000)) return;
    const stored = messageById(socket.data.room, messageId);
    const ownsMessage = stored && (stored.authorIdentityFingerprint ? stored.authorIdentityFingerprint === socket.data.identityFingerprint : (stored.authorClientId && socket.data.clientId ? stored.authorClientId === socket.data.clientId : stored.from === socket.id));
    if (!ownsMessage) return socket.emit('app-error', 'Você só pode apagar suas próprias mensagens.');
    forgetMessage(socket.data.room, stored.messageId); socket.data.chatMessages?.delete(stored.messageId);
    io.to(socket.data.serverRoom).emit('message-deleted', { messageId: stored.messageId, textChannel: stored.textChannel });
  });
  socket.on('signal', ({ target, data } = {}) => {
    if (!target || !socket.data.serverRoom || !consumeRate(socket, 'signal', 360, 10000)) return;
    try { if (Buffer.byteLength(JSON.stringify(data || {}), 'utf8') > 64 * 1024) return socket.emit('app-error', 'Pacote de conexão grande demais.'); } catch { return; }
    const targetSocket = io.sockets.sockets.get(String(target));
    if (!targetSocket || targetSocket.data.serverRoom !== socket.data.serverRoom) return;
    counters.signals += 1;
    targetSocket.emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', status: safePresenceStatus(socket.data.status), platform: safeClientPlatform(socket.data.platform), data });
  });
  socket.on('latency-ping', ({ sentAt } = {}) => { if (consumeRate(socket, 'latency', 20, 10000)) socket.emit('latency-pong', { sentAt }); });
  socket.on('disconnecting', () => {
    if (socket.data.voiceRoom && socket.data.voiceChannel !== LOBBY_CHANNEL) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name });
    if (socket.data.serverRoom) broadcastPresence(socket.data.serverRoom, socket.id);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`VoiceUP Server Cloud ${packageInfo.version} ativo na porta ${port}`));
function shutdown() { chatStore.close(); reportStore.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
