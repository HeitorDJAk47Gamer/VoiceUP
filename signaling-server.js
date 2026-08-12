const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const AVATAR_COLORS = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const MAX_VOICE_CHANNEL_SIZE = 6;
const safeChannel = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const voiceKey = (room, channel) => `voice:${room}:${channel}`;
const serverKey = (room) => `server:${room}`;

function startSignalingServer(port = 3000) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  const startedAt = Date.now();
  const events = { connections: 0, signals: 0, joins: 0, messages: 0 };
  const logs = [];
  const addLog = (level, message) => { logs.unshift({ time: new Date().toLocaleTimeString('pt-BR'), level, message }); if (logs.length > 80) logs.pop(); };
  const peersIn = (key) => [...(io.sockets.adapter.rooms.get(key) || [])].filter((id) => id !== undefined).map((id) => { const peer = io.sockets.sockets.get(id)?.data || {}; return { id, name: peer.name || 'Visitante', color: peer.color || AVATAR_COLORS[0], avatar: peer.avatar || '', voiceChannel: peer.voiceChannel || 'Geral' }; });
  const broadcastPresence = (serverRoom, excludedId) => io.to(serverRoom).emit('room-presence', { members: peersIn(serverRoom).filter((peer) => peer.id !== excludedId) });

  app.get('/health', (_req, res) => res.json({ ok: true, app: 'VoiceUp Server', maxVoiceChannelSize: MAX_VOICE_CHANNEL_SIZE }));
  io.on('connection', (socket) => {
    events.connections += 1; addLog('info', 'Novo cliente conectado');
    socket.on('join-room', ({ roomId, voiceChannel, name, color, avatar }) => {
      const room = String(roomId || '').trim().slice(0, 48);
      const voiceChannelName = safeChannel(voiceChannel, 'Geral');
      const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
      const serverRoom = serverKey(room); const voiceRoom = voiceKey(room, voiceChannelName);
      if (!room) return socket.emit('app-error', 'Informe um código de sala.');
      if ((io.sockets.adapter.rooms.get(voiceRoom)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
      const usedColors = peersIn(serverRoom).map((peer) => peer.color);
      const requestedColor = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
      const safeColor = usedColors.includes(requestedColor) ? AVATAR_COLORS.find((candidate) => !usedColors.includes(candidate)) || requestedColor : requestedColor;
      const safeAvatar = typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length <= 150000 ? avatar : '';
      socket.join(serverRoom); socket.join(voiceRoom);
      Object.assign(socket.data, { room, serverRoom, voiceRoom, voiceChannel: voiceChannelName, name: safeName, color: safeColor, avatar: safeAvatar });
      socket.emit('color-assigned', { color: safeColor }); events.joins += 1; addLog('join', `${safeName} entrou em ${room} / ${voiceChannelName}`);
      const peers = peersIn(voiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: room, voiceChannel: voiceChannelName, peers });
      socket.to(voiceRoom).emit('peer-joined', { id: socket.id, name: safeName, color: safeColor, avatar: safeAvatar });
      broadcastPresence(serverRoom);
    });
    socket.on('switch-voice-channel', ({ voiceChannel }) => {
      if (!socket.data.room) return;
      const channel = safeChannel(voiceChannel, 'Geral'); const nextVoiceRoom = voiceKey(socket.data.room, channel);
      if (nextVoiceRoom === socket.data.voiceRoom) return;
      if ((io.sockets.adapter.rooms.get(nextVoiceRoom)?.size || 0) >= MAX_VOICE_CHANNEL_SIZE) return socket.emit('app-error', `O canal de voz já possui o limite de ${MAX_VOICE_CHANNEL_SIZE} pessoas.`);
      socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); socket.leave(socket.data.voiceRoom);
      socket.join(nextVoiceRoom); socket.data.voiceRoom = nextVoiceRoom; socket.data.voiceChannel = channel;
      const peers = peersIn(nextVoiceRoom).filter((peer) => peer.id !== socket.id);
      socket.emit('room-joined', { roomId: socket.data.room, voiceChannel: channel, peers });
      socket.to(nextVoiceRoom).emit('peer-joined', { id: socket.id, name: socket.data.name, color: socket.data.color, avatar: socket.data.avatar });
      broadcastPresence(socket.data.serverRoom);
      addLog('channel', `${socket.data.name} mudou para ${channel}`);
    });
    socket.on('text-message', ({ text, textChannel }) => {
      if (!socket.data.serverRoom) return;
      const safeText = String(text || '').trim().slice(0, 500); if (!safeText) return;
      events.messages += 1;
      io.to(socket.data.serverRoom).emit('text-message', { from: socket.id, text: safeText, textChannel: safeChannel(textChannel, 'geral'), name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0] });
    });
    socket.on('signal', ({ target, data }) => { if (target) { events.signals += 1; io.to(target).emit('signal', { from: socket.id, name: socket.data.name || 'Visitante', color: socket.data.color || AVATAR_COLORS[0], avatar: socket.data.avatar || '', data }); } });
    socket.on('latency-ping', ({ sentAt }) => socket.emit('latency-pong', { sentAt }));
    socket.on('server-pong', ({ sentAt }) => { const ping = Date.now() - Number(sentAt); if (Number.isFinite(ping) && ping >= 0 && ping < 10000) socket.data.ping = ping; });
    socket.on('disconnecting', () => { if (socket.data.voiceRoom) { addLog('leave', `${socket.data.name || 'Cliente'} saiu da sala`); socket.to(socket.data.voiceRoom).emit('peer-left', { id: socket.id, name: socket.data.name }); } if (socket.data.serverRoom) broadcastPresence(socket.data.serverRoom, socket.id); });
  });
  const getStats = () => { const voiceRooms = [...io.sockets.adapter.rooms.entries()].filter(([key, value]) => key.startsWith('voice:') && value.size > 0); const pings = [...io.sockets.sockets.values()].map((socket) => socket.data.ping).filter(Number.isFinite); io.emit('server-ping', Date.now()); return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), participants: io.sockets.sockets.size, rooms: voiceRooms.length, averagePing: pings.length ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length) : null, events, logs }; };
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { addLog('info', `Servidor iniciado na porta ${port}`); resolve({ server, io, port, getStats }); }); });
}
module.exports = { startSignalingServer };
