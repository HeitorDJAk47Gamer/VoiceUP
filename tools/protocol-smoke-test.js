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
const waitFor = (socket, event, predicate = () => true, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Timeout em ${event}`)); }, timeout);
  function onEvent(payload) { if (!predicate(payload)) return; clearTimeout(timer); socket.off(event, onEvent); resolve(payload); }
  socket.on(event, onEvent);
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
    const text = waitFor(bob, 'text-message', (packet) => packet.text === 'olá @Bob');
    alice.emit('text-message', { text: 'olá @Bob', textChannel: 'geral', messageId: 'smoke-one', createdAt: Date.now(), mentions: [bob.id, 'id-invalido'] });
    const message = await text;
    if (message.text !== 'olá @Bob' || !message.messageId || message.mentions?.length !== 1 || message.mentions[0] !== bob.id || message.mentionClientIds?.[0] !== 'smoke-bob') throw new Error('Mensagem ou menção incompatível');
    const longContent = `Trecho longo para prévia\n${'conteúdo preservado no arquivo '.repeat(24)}`;
    const textFileEvent = waitFor(bob, 'text-message', (packet) => packet.textFile?.content === longContent);
    alice.emit('text-message', { text: 'Arquivo de texto: mensagem.txt', textFile: { name: '../mensagem.txt', content: longContent, size: 1, type: 'application/octet-stream' }, textChannel: 'geral', messageId: 'smoke-text-file', createdAt: Date.now() });
    const textFileMessage = await textFileEvent;
    if (textFileMessage.textFile?.content !== longContent || textFileMessage.textFile?.name !== 'mensagem.txt' || textFileMessage.textFile?.type !== 'text/plain' || textFileMessage.textFile?.size !== Buffer.byteLength(longContent)) throw new Error('Arquivo TXT não foi sanitizado ou preservado');
    const rejectedTextFile = waitFor(alice, 'app-error', (message) => /64 KB/.test(String(message)));
    alice.emit('text-message', { text: 'arquivo inválido', textFile: { name: 'grande.txt', content: 'a'.repeat(64 * 1024 + 1) }, textChannel: 'geral', messageId: 'smoke-text-file-large' });
    if (!/64 KB/.test(await rejectedTextFile)) throw new Error('Arquivo TXT acima do limite não foi recusado');
    const edit = waitFor(bob, 'message-edited', (packet) => packet.messageId === message.messageId);
    alice.emit('edit-message', { messageId: message.messageId, text: 'olá editado', textChannel: 'geral' });
    const edited = await edit;
    if (edited.text !== 'olá editado' || edited.mentions?.length) throw new Error('Edição incompatível');
    const replyEvent = waitFor(bob, 'text-message', (packet) => packet.reply?.messageId === message.messageId);
    alice.emit('text-message', { text: 'resposta', textChannel: 'geral', messageId: 'smoke-reply', createdAt: Date.now(), reply: { messageId: message.messageId } });
    const reply = await replyEvent;
    if (reply.reply?.messageId !== message.messageId || reply.reply?.text !== 'olá editado') throw new Error('Resposta não foi validada pelo servidor');
    const reactionEvent = waitFor(bob, 'message-reaction', (packet) => packet.messageId === reply.messageId);
    alice.emit('react-message', { messageId: reply.messageId, emoji: '👍' });
    const reaction = await reactionEvent;
    if (reaction.reactions?.['👍']?.length !== 1) throw new Error('Reação não foi propagada');
    let pinValidated = false;
    if (target === 'host') {
      const pinDenied = waitFor(alice, 'app-error', (message) => /permissão|permitida/i.test(String(message)));
      alice.emit('pin-message', { messageId: reply.messageId, pinned: true });
      if (!/permissão|permitida/i.test(await pinDenied)) throw new Error('ServerHost não protegeu a fixação por cargo');
      pinValidated = true;
    } else {
      const pinEvent = waitFor(bob, 'message-pinned', (packet) => packet.messageId === reply.messageId);
      alice.emit('pin-message', { messageId: reply.messageId, pinned: true });
      if (!(await pinEvent).pinned) throw new Error('Mensagem fixada não foi propagada');
      pinValidated = true;
    }
    const charlie = connect('Charlie', 'smoke-charlie');
    await waitFor(charlie, 'connect');
    const charlieJoined = waitFor(charlie, 'room-joined');
    const historyEvent = waitFor(charlie, 'chat-history');
    charlie.emit('join-room', { roomId: 'smoke-room', voiceChannel: '__lobby__', name: 'Charlie', clientId: 'smoke-charlie' });
    await charlieJoined;
    const history = (await historyEvent).messages || [];
    if (!history.some((item) => item.messageId === reply.messageId && (target === 'host' || item.pinned) && item.reactions?.['👍']?.length === 1)) throw new Error('Histórico não preservou resposta, reação e estado de fixação');
    if (!history.some((item) => item.messageId === textFileMessage.messageId && item.textFile?.content === longContent)) throw new Error('Histórico não preservou o arquivo TXT');
    const deniedDelete = waitFor(bob, 'app-error', (message) => /próprias mensagens/i.test(String(message)));
    bob.emit('delete-message', { messageId: reply.messageId });
    if (!/próprias mensagens/i.test(await deniedDelete)) throw new Error('Servidor permitiu exclusão por outro autor');
    const deletedEvent = waitFor(bob, 'message-deleted', (packet) => packet.messageId === reply.messageId);
    alice.emit('delete-message', { messageId: reply.messageId });
    if ((await deletedEvent).messageId !== reply.messageId) throw new Error('Exclusão não foi propagada');
    const signal = waitFor(bob, 'signal');
    alice.emit('signal', { target: bob.id, data: { smoke: true } });
    if (!(await signal).data?.smoke) throw new Error('Sinalização incompatível');
    alice.disconnect(); bob.disconnect(); charlie.disconnect();
    await delay(100);
    console.log(JSON.stringify({ ok: true, target, presence: members.length, dnd: true, mentions: true, channel: 'Geral', chat: true, textFile: true, textFileRejected: true, edit: true, reply: true, reaction: true, pin: pinValidated, history: true, delete: true, signal: true }));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
  }
})();
