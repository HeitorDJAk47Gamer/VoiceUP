const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');
const { startSignalingServer } = require('../signaling-server');

const port = 3395;
const waitFor = (socket, event, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout em ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const stop = (running) => new Promise((resolve) => {
  if (!running) return resolve();
  running.io.close();
  running.server.close(() => resolve());
  setTimeout(resolve, 1000).unref();
});

(async () => {
  let running; let first; let replacement; let otherProfile;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-session-dedup-'));
  try {
    running = await startSignalingServer(port, {
      historyFile: path.join(scratch, 'chat-history.json'),
      reportsFile: path.join(scratch, 'bug-reports.json'),
      bansFile: path.join(scratch, 'bans.json')
    });
    const url = `http://127.0.0.1:${port}`;
    first = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(first, 'connect');
    const firstJoin = waitFor(first, 'room-joined');
    first.emit('join-room', { roomId: 'dedup-room', voiceChannel: 'Geral', name: 'Primeira janela', clientId: 'same-profile' });
    await firstJoin;

    replacement = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(replacement, 'connect');
    const replaced = waitFor(first, 'session-replaced');
    const firstDisconnected = waitFor(first, 'disconnect');
    const replacementJoin = waitFor(replacement, 'room-joined');
    replacement.emit('join-room', { roomId: 'dedup-room', voiceChannel: 'Geral', name: 'Nova janela', clientId: 'same-profile' });
    await replacementJoin;
    await replaced;
    const reason = await firstDisconnected;
    if (reason !== 'io server disconnect') throw new Error(`Sessão antiga não foi encerrada pelo servidor (${reason || 'sem motivo'})`);

    const presence = waitFor(replacement, 'room-presence');
    replacement.emit('request-room-presence');
    const members = (await presence).members || [];
    if (members.length !== 1 || members[0]?.id !== replacement.id || members[0]?.clientId !== 'same-profile') {
      throw new Error(`Presença duplicada após reconexão: ${JSON.stringify(members)}`);
    }

    // The two launchers in the test package use different user-data folders.
    // They must remain separate accounts even though a duplicate of the same
    // profile is rejected above.
    otherProfile = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(otherProfile, 'connect');
    const otherJoin = waitFor(otherProfile, 'room-joined');
    otherProfile.emit('join-room', { roomId: 'dedup-room', voiceChannel: 'Geral', name: 'Outra conta', clientId: 'separate-profile' });
    await otherJoin;
    const twoProfiles = waitFor(replacement, 'room-presence');
    replacement.emit('request-room-presence');
    const membersWithOtherProfile = (await twoProfiles).members || [];
    const identities = new Set(membersWithOtherProfile.map((member) => member.clientId));
    if (membersWithOtherProfile.length !== 2 || !identities.has('same-profile') || !identities.has('separate-profile')) {
      throw new Error(`Contas distintas não coexistiram: ${JSON.stringify(membersWithOtherProfile)}`);
    }
    console.log(JSON.stringify({ ok: true, singleSession: true, replacementId: replacement.id, memberCount: members.length, separateProfiles: membersWithOtherProfile.length }));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    first?.disconnect(); replacement?.disconnect(); otherProfile?.disconnect();
    await stop(running);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})();
