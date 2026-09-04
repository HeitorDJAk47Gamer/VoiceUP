const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { startSignalingServer, hashRoomPassword, normalizeRoomLayout } = require('../signaling-server');

const once = (socket, event, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Tempo esgotado aguardando ${event}`)); }, timeoutMs);
  const handler = (value) => { clearTimeout(timer); resolve(value); };
  socket.once(event, handler);
});
const connected = async (url) => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000 });
  await once(socket, 'connect');
  return socket;
};
const join = async (socket, payload) => {
  const result = once(socket, 'room-joined');
  socket.emit('join-room', payload);
  return result;
};

(async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-security-'));
  const botToken = crypto.randomBytes(32).toString('hex');
  const signaling = await startSignalingServer(0, {
    botToken,
    version: 'security-test',
    identityFile: path.join(temporaryDirectory, 'identities.json'),
    historyFile: path.join(temporaryDirectory, 'chat.json'),
    reportsFile: path.join(temporaryDirectory, 'reports.json'),
    musicDirectory: path.join(temporaryDirectory, 'music'),
    pluginDirectories: [],
    roomLayouts: [normalizeRoomLayout({ id: 'privada', passwordHash: hashRoomPassword('segredo'), voiceChannelSettings: [{ name: 'Geral', locked: true }] })]
  });
  const actualPort = signaling.server.address().port;
  const url = `http://127.0.0.1:${actualPort}`;
  const sockets = [];
  try {
    const health = await (await fetch(`${url}/health`)).json();
    assert.equal(health.ok, true);
    for (const sensitive of ['storage', 'plugins', 'pluginErrors', 'musicFiles', 'nodeId', 'logs', 'members', 'bans']) assert.equal(Object.hasOwn(health, sensitive), false, `/health expôs ${sensitive}`);
    const engineHandshake = `${url}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`;
    const allowedOrigin = await fetch(engineHandshake, { headers: { Origin: 'http://localhost:3000' } });
    const blockedOrigin = await fetch(engineHandshake, { headers: { Origin: 'https://evil.example' } });
    assert.equal(allowedOrigin.status, 200, 'O signaling bloqueou uma origem local autorizada.');
    assert.ok(blockedOrigin.status >= 400, 'O signaling aceitou uma origem de navegador não autorizada.');

    const fakeBot = await connected(url); sockets.push(fakeBot);
    const fakeBotRejected = once(fakeBot, 'disconnect');
    fakeBot.emit('join-room', { roomId: 'privada', voiceChannel: 'Geral', name: 'Bot falso', clientId: 'fake-bot', bot: true, botToken: 'incorreto' });
    await fakeBotRejected;

    const officialBot = await connected(url); sockets.push(officialBot);
    await join(officialBot, { roomId: 'privada', voiceChannel: 'Geral', name: 'Bot oficial', clientId: 'official-bot', bot: true, botToken });

    const observer = await connected(url); const mover = await connected(url); sockets.push(observer, mover);
    await join(observer, { roomId: 'sala-a', voiceChannel: '__lobby__', name: 'Observador', clientId: 'observer' });
    await join(mover, { roomId: 'sala-a', voiceChannel: '__lobby__', name: 'Pessoa', clientId: 'mover' });
    await join(mover, { roomId: 'sala-b', voiceChannel: '__lobby__', name: 'Pessoa', clientId: 'mover' });
    let leakedAcrossRooms = false;
    mover.on('text-message', (packet) => { if (packet?.text === 'mensagem-isolada') leakedAcrossRooms = true; });
    observer.emit('text-message', { text: 'mensagem-isolada', textChannel: 'geral' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(leakedAcrossRooms, false, 'socket continuou inscrito na sala anterior');

    const secureClient = await connected(url); sockets.push(secureClient);
    const challengePromise = once(secureClient, 'identity-challenge');
    secureClient.emit('identity-challenge-request');
    const { challenge } = await challengePromise;
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = keys.publicKey.export({ format: 'jwk' });
    const clientId = 'secure-client';
    const proof = crypto.sign('sha256', Buffer.from(`voiceup-identity-v1\n${challenge}\n${secureClient.id}\nidentidade\n${clientId}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    await join(secureClient, { roomId: 'identidade', voiceChannel: '__lobby__', name: 'Perfil protegido', clientId, capabilities: ['identity-proof-v1'], identityChallenge: challenge, identityPublicKey: publicKey, identityProof: proof });

    const impersonator = await connected(url); sockets.push(impersonator);
    const refused = once(impersonator, 'identity-proof-required');
    impersonator.emit('join-room', { roomId: 'identidade', voiceChannel: '__lobby__', name: 'Impostor', clientId });
    await refused;

    const reservedIdentity = await connected(url); sockets.push(reservedIdentity);
    await join(reservedIdentity, { roomId: 'reservada', voiceChannel: '__lobby__', name: 'Identidade reservada', clientId: '__proto__' });
    const reservedPresence = once(reservedIdentity, 'room-presence');
    reservedIdentity.emit('request-room-presence');
    assert.equal((await reservedPresence).members[0]?.clientId, '', 'Nome interno do JavaScript foi aceito como identidade.');
    reservedIdentity.emit('switch-voice-channel');
    reservedIdentity.emit('text-message');
    reservedIdentity.emit('edit-message');
    reservedIdentity.emit('server-pong');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(reservedIdentity.connected, true, 'Pacote vazio derrubou o processo de sinalização.');

    console.log(JSON.stringify({ ok: true, publicHealth: true, originRestricted: true, fakeBotRejected: true, officialBotAccepted: true, roomIsolation: true, identityProof: true, reservedIdentityBlocked: true, malformedPacketsTolerated: true }));
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => signaling.io.close(() => resolve()));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
