'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { startSignalingServer, normalizeRoomLayout } = require('../signaling-server');
const { normalizeAccessControl, upsertRole } = require('../server-access-control');
const { groupMembersByRole } = require('../public/channel-roster');

const once = (socket, event, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Tempo esgotado aguardando ${event}`)); }, timeoutMs);
  const handler = (value) => { clearTimeout(timer); resolve(value); };
  socket.once(event, handler);
});
const connected = async (url) => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000 });
  await once(socket, 'connect'); return socket;
};
const join = async (socket, name, voiceChannel = '__lobby__') => {
  const joined = once(socket, 'room-joined');
  socket.emit('join-room', { roomId: 'laboratorio', name, clientId: `test-${name}`, voiceChannel });
  return joined;
};

(async () => {
  const role = upsertRole(normalizeAccessControl(), { name: 'Criadores', color: '#5de0cf', position: 25, displaySeparately: true, permissions: [] });
  assert.equal(role.ok, true);
  assert.equal(role.role.displaySeparately, true, 'O cargo não preservou a opção de separar membros.');
  const groups = groupMembersByRole([{ id: 'b', name: 'Bia', roleIds: [role.role.id] }, { id: 'a', name: 'Ana', roleIds: [] }], [role.role]);
  assert.deepEqual(groups.map((group) => group.role?.id || 'members'), [role.role.id, 'members']);

  const layout = normalizeRoomLayout({
    id: 'laboratorio', name: 'Laboratório',
    voiceChannelSettings: [{ name: 'Geral' }, { name: 'Criar call', kind: 'dynamic', userLimit: 2 }, { name: 'Palco', kind: 'stage' }],
    textChannelSettings: [{ name: 'geral' }, { name: 'ideias', kind: 'forum', forumTags: ['ajuda', 'beta'], forumSort: 'newest' }]
  });
  assert.equal(layout.voiceChannelSettings.find((channel) => channel.name === 'Criar call').kind, 'dynamic');
  assert.equal(layout.voiceChannelSettings.find((channel) => channel.name === 'Palco').kind, 'stage');
  assert.deepEqual(layout.textChannelSettings.find((channel) => channel.name === 'ideias').forumTags, ['ajuda', 'beta']);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-channel-types-'));
  const signaling = await startSignalingServer(0, {
    identityFile: path.join(directory, 'identities.json'), historyFile: path.join(directory, 'chat.json'), reportsFile: path.join(directory, 'reports.json'),
    musicDirectory: path.join(directory, 'music'), pluginDirectories: [], roomLayouts: [layout]
  });
  const url = `http://127.0.0.1:${signaling.server.address().port}`; const sockets = [];
  try {
    const creator = await connected(url); sockets.push(creator);
    const created = await join(creator, 'Ana', 'Criar call');
    assert.equal(created.voiceChannel, 'Ana', 'A call temporária não recebeu o nome de quem entrou no canal dinâmico.');
    const temporaryCall = created.voiceChannel;

    const viewer = await connected(url); sockets.push(viewer);
    const initialLayout = once(viewer, 'room-layout'); await join(viewer, 'Bia');
    assert.ok((await initialLayout).voiceChannels.includes(temporaryCall), 'A call temporária não foi enviada aos membros da sala.');
    const viewerJoinedTemporary = once(viewer, 'room-joined');
    viewer.emit('switch-voice-channel', { voiceChannel: temporaryCall });
    assert.equal((await viewerJoinedTemporary).voiceChannel, temporaryCall, 'Outra pessoa não conseguiu entrar na call temporária criada.');
    creator.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(viewer.connected, true, 'O participante restante perdeu a conexão quando o criador saiu.');

    const observer = await connected(url); sockets.push(observer);
    const occupiedLayout = once(observer, 'room-layout'); await join(observer, 'Caio');
    assert.ok((await occupiedLayout).voiceChannels.includes(temporaryCall), 'A call temporária foi removida enquanto ainda havia alguém nela.');

    const removedLayout = once(observer, 'room-layout');
    viewer.emit('switch-voice-channel', { voiceChannel: '__lobby__' });
    assert.equal((await removedLayout).voiceChannels.includes(temporaryCall), false, 'A call temporária não foi removida ao ficar vazia.');

    const missingThread = once(viewer, 'app-error'); viewer.emit('text-message', { textChannel: 'ideias', text: 'sem tópico' });
    assert.match(await missingThread, /tópico/i);
    const forumMessage = once(viewer, 'text-message'); viewer.emit('text-message', { textChannel: 'ideias', text: 'primeira ideia', forumThreadId: 'thread-primeira-ideia', forumTitle: 'Primeira ideia' });
    const packet = await forumMessage;
    assert.deepEqual({ textChannel: packet.textChannel, forumThreadId: packet.forumThreadId, forumTitle: packet.forumTitle }, { textChannel: 'ideias', forumThreadId: 'primeira-ideia', forumTitle: 'Primeira ideia' });
    console.log(JSON.stringify({ ok: true, roleGrouping: true, dynamicChannelLifecycle: true, forumThreadsValidated: true, stageLayoutPreserved: true }));
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => signaling.io.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
