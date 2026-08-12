const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const port = Number(process.env.PORT || process.env.SERVER_PORT || 80);
const MAX_VOICE_CHANNEL_SIZE = 6;
const colors = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const voiceKey = (room, channel) => `voice:${room}:${channel}`;
const serverKey = (room) => `server:${room}`;
const app = express(); const server = http.createServer(app); const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
app.get('/', (_request, response) => response.json({ ok: true, service: 'VoiceUP Server Cloud', mode: 'signaling', maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE }));
app.get('/health', (_request, response) => response.json({ ok: true, service: 'VoiceUP Server Cloud', maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE }));
const peersIn = (key) => [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => { const peer = io.sockets.sockets.get(id)?.data || {}; return { id, name: peer.name || 'Visitante', color: peer.color || colors[0], avatar: peer.avatar || '', voiceChannel: peer.voiceChannel || 'Geral' }; });
const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', { members: peersIn(serverRoom).filter((peer) => peer.id !== excludedId) });
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, voiceChannel, name, color, avatar }) => {
    const room = String(roomId || '').trim().slice(0, 48); const channel = safeChannel(voiceChannel, 'Geral'); if (!room) return socket.emit('app-error', 'Informe um código de sala.');
    const voiceRoom = voiceKey(room, channel); if ((io.sockets.adapter.rooms.get(voiceRoom)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
    const requestedColor = colors.includes(color) ? color : colors[0]; const used = peersIn(serverKey(room)).map((peer) => peer.color); const safeColor = used.includes(requestedColor) ? colors.find((candidate) => !used.includes(candidate)) || requestedColor : requestedColor;
    const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante'; const safeAvatar = typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length <= 150000 ? avatar : '';
    socket.join(serverKey(room)); socket.join(voiceRoom); Object.assign(socket.data, { room, serverRoom: serverKey(room), voiceRoom, voiceChannel: channel, name: safeName, color: safeColor, avatar: safeAvatar });
    socket.emit('color-assigned', { color: safeColor }); const peers = peersIn(voiceRoom).filter((peer) => peer.id !== socket.id); socket.emit('room-joined', { roomId: room, voiceChannel: channel, peers }); socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar }); broadcastPresence(serverKey(room));
  });
  socket.on('switch-voice-channel', ({ voiceChannel }) => { if (!socket.data.room) return; const channel = safeChannel(voiceChannel, 'Geral'); const next = voiceKey(socket.data.room, channel); if (next === socket.data.voiceRoom) return; if ((io.sockets.adapter.rooms.get(next)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`); socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); socket.leave(socket.data.voiceRoom); socket.join(next); socket.data.voiceRoom = next; socket.data.voiceChannel = channel; const peers = peersIn(next).filter((peer) => peer.id !== socket.id); socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers }); socket.to(next).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar }); broadcastPresence(socket.data.serverRoom); });
  socket.on('text-message', ({ text, textChannel }) => { if (!socket.data.serverRoom) return; const safeText = String(text || '').trim().slice(0, 500); if (safeText) io.to(socket.data.serverRoom).emit('text-message', { from: socket.id, text: safeText, textChannel: safeChannel(textChannel, 'geral'), name: socket.data.name || 'Visitante', color: socket.data.color || colors[0] }); });
  socket.on('signal', ({ target, data }) => { if (target) io.to(target).emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || colors[0], avatar: socket.data.avatar || '', data }); });
  socket.on('latency-ping', ({ sentAt }) => socket.emit('latency-pong', { sentAt }));
  socket.on('disconnecting', () => { if (socket.data.voiceRoom) socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); if (socket.data.serverRoom) broadcastPresence(socket.data.serverRoom, socket.id); });
});
server.listen(port, '0.0.0.0', () => console.log(`VoiceUP Server Cloud ativo na porta ${port}`));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
