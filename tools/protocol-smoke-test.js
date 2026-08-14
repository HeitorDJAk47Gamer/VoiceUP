const path = require('path');
const { spawn } = require('child_process');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] === 'host' ? 'host' : 'cloud';
const port = target === 'host' ? 3182 : 3181;
const entry = target === 'host' ? path.join(root, 'tools', 'start-host-smoke.js') : path.join(root, 'deploy', 'shardcloud', 'index.js');
const server = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
const waitFor = (socket, event, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout em ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const connect = (name, clientId) => io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, auth: {}, autoConnect: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cloud não iniciou')), 7000);
      server.stdout.on('data', (chunk) => { if (/ativo na porta|host-smoke-ready/.test(String(chunk))) { clearTimeout(timer); resolve(); } });
      server.stderr.on('data', (chunk) => reject(new Error(String(chunk))));
    });
    const alice = connect('Alice', 'smoke-alice');
    const bob = connect('Bob', 'smoke-bob');
    await Promise.all([waitFor(alice, 'connect'), waitFor(bob, 'connect')]);
    const aliceJoined = waitFor(alice, 'room-joined');
    alice.emit('join-room', { roomId: 'smoke-room', voiceChannel: '__lobby__', name: 'Alice', clientId: 'smoke-alice' });
    await aliceJoined;
    const bobJoined = waitFor(bob, 'room-joined');
    bob.emit('join-room', { roomId: 'smoke-room', voiceChannel: '__lobby__', name: 'Bob', clientId: 'smoke-bob' });
    await bobJoined;
    const presence = waitFor(alice, 'room-presence');
    alice.emit('request-room-presence');
    const members = (await presence).members || [];
    if (members.length !== 2) throw new Error(`Presença esperada: 2; recebida: ${members.length}`);
    if (members.some((member) => member.status !== 'online')) throw new Error('Cliente antigo não recebeu status online padrão');
    const dndPresence = waitFor(bob, 'room-presence');
    alice.emit('presence-update', { status: 'dnd' });
    const dndMembers = (await dndPresence).members || [];
    if (dndMembers.find((member) => member.id === alice.id)?.status !== 'dnd') throw new Error('Status DND não foi propagado');
    const aliceCall = waitFor(alice, 'room-joined');
    alice.emit('switch-voice-channel', { voiceChannel: 'Geral' });
    await aliceCall;
    const peerJoined = waitFor(alice, 'peer-joined');
    const bobCall = waitFor(bob, 'room-joined');
    bob.emit('switch-voice-channel', { voiceChannel: 'Geral' });
    await Promise.all([peerJoined, bobCall]);
    const text = waitFor(bob, 'text-message');
    alice.emit('text-message', { text: 'olá @Bob', textChannel: 'geral', messageId: 'smoke-one', createdAt: Date.now(), mentions: [bob.id, 'id-invalido'] });
    const message = await text;
    if (message.text !== 'olá @Bob' || !message.messageId || message.mentions?.length !== 1 || message.mentions[0] !== bob.id) throw new Error('Mensagem ou menção incompatível');
    const edit = waitFor(bob, 'message-edited');
    alice.emit('edit-message', { messageId: message.messageId, text: 'olá editado', textChannel: 'geral' });
    const edited = await edit;
    if (edited.text !== 'olá editado' || edited.mentions?.length) throw new Error('Edição incompatível');
    const signal = waitFor(bob, 'signal');
    alice.emit('signal', { target: bob.id, data: { smoke: true } });
    if (!(await signal).data?.smoke) throw new Error('Sinalização incompatível');
    alice.disconnect(); bob.disconnect();
    await delay(100);
    console.log(JSON.stringify({ ok: true, target, presence: members.length, dnd: true, mentions: true, channel: 'Geral', chat: true, edit: true, signal: true }));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
  }
})();
