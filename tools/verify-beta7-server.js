const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io: connect } = require('socket.io-client');
const { startSignalingServer, hashRoomPassword } = require('../signaling-server');

const waitEvent = (socket, event, timeout = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Tempo esgotado: ${event}`)); }, timeout);
  const listener = (packet) => { clearTimeout(timer); resolve(packet); };
  socket.once(event, listener);
});

const availablePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});

const closeServer = (instance) => new Promise((resolve) => {
  try { instance.io.close(() => instance.server.close(() => resolve())); }
  catch { resolve(); }
  setTimeout(resolve, 1500).unref?.();
});

const makeClient = async (url) => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  await waitEvent(socket, 'connect');
  return socket;
};

const join = async (socket, input) => {
  const joined = waitEvent(socket, 'room-joined');
  socket.emit('join-room', input);
  return joined;
};

(async () => {
  const port = await availablePort();
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-beta7-'));
  const historyFile = path.join(testDirectory, 'chat-history.json');
  const reportsFile = path.join(testDirectory, 'bug-reports.json');
  const common = {
    historyFile, reportsFile,
    pluginDirectories: [path.join(testDirectory, 'plugins')],
    musicDirectory: path.join(testDirectory, 'music'),
    roomLayouts: [{ id: 'privada', name: 'Privada', passwordHash: hashRoomPassword('segredo'), voiceChannelSettings: [{ name: 'Geral', userLimit: 2 }], textChannels: ['geral'] }]
  };
  let instance = await startSignalingServer(port, common);
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  try {
    const wrong = await makeClient(url); sockets.push(wrong);
    const passwordRequired = waitEvent(wrong, 'room-password-required');
    wrong.emit('join-room', { roomId: 'privada', roomPassword: 'errada', voiceChannel: 'Geral', name: 'Errado', clientId: 'wrong' });
    await passwordRequired;
    wrong.disconnect();

    const first = await makeClient(url); const second = await makeClient(url); const third = await makeClient(url);
    sockets.push(first, second, third);
    await join(first, { roomId: 'privada', roomPassword: 'segredo', voiceChannel: 'Geral', name: 'Primeiro', clientId: 'first' });
    await join(second, { roomId: 'privada', roomPassword: 'segredo', voiceChannel: 'Geral', name: 'Segundo', clientId: 'second' });
    const limitError = waitEvent(third, 'app-error');
    third.emit('join-room', { roomId: 'privada', roomPassword: 'segredo', voiceChannel: 'Geral', name: 'Terceiro', clientId: 'third' });
    if (!/limite/i.test(String(await limitError))) throw new Error('O limite da call não foi aplicado.');

    const received = waitEvent(second, 'text-message');
    first.emit('text-message', { text: 'Mensagem persistente beta 7', textChannel: 'geral', messageId: 'persist-beta7', createdAt: Date.now() });
    const message = await received;
    if (message.text !== 'Mensagem persistente beta 7') throw new Error('Mensagem divergente.');

    const reportResponse = await fetch(`${url}/api/bug-reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'teste', description: 'Relatório automático da beta 7.', version: '1.1.2-beta.7' }) });
    if (reportResponse.status !== 201) throw new Error(`Relatório HTTP ${reportResponse.status}`);

    for (const socket of sockets) socket.disconnect();
    await closeServer(instance);
    instance = await startSignalingServer(port, common);
    const restored = await makeClient(url); sockets.push(restored);
    const history = waitEvent(restored, 'chat-history');
    await join(restored, { roomId: 'privada', roomPassword: 'segredo', voiceChannel: 'Geral', name: 'Retorno', clientId: 'return' });
    const restoredHistory = await history;
    if (!(restoredHistory.messages || []).some((entry) => entry.text === 'Mensagem persistente beta 7')) throw new Error('Histórico não foi restaurado do disco.');
    const health = await fetch(`${url}/health`).then((response) => response.json());
    if (health.maxHumanVoiceChannelSize !== 12 || health.maxVoiceChannelSize !== 15) throw new Error('Limites globais incorretos.');
    if (health.storage.chat.messages !== 1 || health.storage.reports.reports !== 1) throw new Error('Contadores persistentes incorretos.');
    console.log(JSON.stringify({ ok: true, password: true, callLimit: true, persistence: true, reports: true, limits: { humans: 12, total: 15 }, testDirectory }, null, 2));
  } finally {
    for (const socket of sockets) socket.disconnect();
    await closeServer(instance);
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
