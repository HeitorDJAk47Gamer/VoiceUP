const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');
const { startSignalingServer } = require('../signaling-server');

// Keep automated validation away from the 3191/3192 ports used by the
// portable two-host test folder that may already be open on the same PC.
const ports = { primary: 3291, secondary: 3292 };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const event = (socket, name, timeout = 7000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout em ${name}`)), timeout);
  socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
});
const closeServer = (running) => new Promise((resolve) => {
  if (!running) return resolve();
  running.closeFederation?.(); running.io.close(); running.server.close(() => resolve());
  setTimeout(resolve, 1200).unref();
});

(async () => {
  let primary; let secondary; let alice; let bob;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-cluster-'));
  try {
    const secret = 'voiceup-cluster-smoke-secret';
    primary = await startSignalingServer(ports.primary, {
      bansFile: path.join(scratch, 'primary-bans.json'),
      cluster: { enabled: true, role: 'primary', nodeId: 'primary-smoke', publicUrl: `http://127.0.0.1:${ports.primary}`, secret, failover: true, smartDistribution: false, heartbeatMs: 1000 }
    });
    alice = io(`http://127.0.0.1:${ports.primary}`, { transports: ['websocket'], reconnection: false });
    await event(alice, 'connect');
    const aliceInitialRoute = event(alice, 'cluster-route');
    const aliceJoin = event(alice, 'room-joined');
    alice.emit('join-room', { roomId: 'cluster-room', voiceChannel: '__lobby__', name: 'Alice', clientId: 'cluster-alice', platform: 'windows', status: 'dnd', capabilities: ['cluster-routing', 'webrtc-telemetry'] });
    await aliceJoin;
    if ((await aliceInitialRoute).alternates?.length) throw new Error('Primário anunciou um alternativo antes do secundário existir');
    const aliceUpdatedRoute = event(alice, 'cluster-route');
    secondary = await startSignalingServer(ports.secondary, {
      bansFile: path.join(scratch, 'secondary-bans.json'),
      cluster: { enabled: true, role: 'secondary', nodeId: 'secondary-smoke', primaryUrl: `http://127.0.0.1:${ports.primary}`, publicUrl: `http://127.0.0.1:${ports.secondary}`, secret, failover: true, smartDistribution: false, heartbeatMs: 1000 }
    });
    const updatedRoute = await aliceUpdatedRoute;
    if (!updatedRoute.alternates?.some((node) => node.url === `http://127.0.0.1:${ports.secondary}`)) throw new Error('Client já conectado não recebeu a rota do secundário');
    await wait(250);
    bob = io(`http://127.0.0.1:${ports.secondary}`, { transports: ['websocket'], reconnection: false });
    await event(bob, 'connect');
    const bobJoin = event(bob, 'room-joined');
    bob.emit('join-room', { roomId: 'cluster-room', voiceChannel: '__lobby__', name: 'Bob', clientId: 'cluster-bob', platform: 'android', status: 'idle', capabilities: ['cluster-routing', 'webrtc-telemetry'] });
    await bobJoin; await wait(250);
    const aliceCall = event(alice, 'room-joined'); alice.emit('switch-voice-channel', { voiceChannel: 'Geral' }); await aliceCall;
    const bobCall = event(bob, 'room-joined'); bob.emit('switch-voice-channel', { voiceChannel: 'Geral' });
    const bobPeers = (await bobCall).peers || [];
    const aliceRemote = bobPeers.find((peer) => peer.name === 'Alice');
    if (!aliceRemote?.id?.startsWith('fed:primary-smoke:')) throw new Error('Presença P2P do host primário não chegou ao secundário');
    if (aliceRemote.platform !== 'windows' || aliceRemote.status !== 'dnd') throw new Error('Plataforma/status do primário não chegou ao secundário');
    await wait(180);
    const primaryStats = primary.getStats();
    const bobRemote = primaryStats.members.find((member) => member.name === 'Bob' && member.remote);
    if (!bobRemote?.id?.startsWith('fed:secondary-smoke:')) throw new Error('Presença do host secundário não chegou ao primário');
    if (bobRemote.platform !== 'android' || bobRemote.status !== 'idle') throw new Error('Plataforma/status do secundário não chegou ao primário');
    const platformUpdate = event(bob, 'room-presence');
    alice.emit('presence-update', {status:'idle'});
    const remotePlatform = (await platformUpdate).members?.find((member) => member.clientId === 'cluster-alice');
    if (remotePlatform?.platform !== 'windows' || remotePlatform?.status !== 'idle') throw new Error('Mudança de status perdeu a plataforma no cluster');
    const primaryPresence = event(alice, 'room-presence'); alice.emit('request-room-presence');
    const secondaryPresence = event(bob, 'room-presence'); bob.emit('request-room-presence');
    const primaryCallStart = (await primaryPresence).voiceActivity?.find((entry) => entry.voiceChannel === 'Geral')?.startedAt;
    const secondaryCallStart = (await secondaryPresence).voiceActivity?.find((entry) => entry.voiceChannel === 'Geral')?.startedAt;
    if (!primaryCallStart || primaryCallStart !== secondaryCallStart) throw new Error('O início da call não foi compartilhado entre hosts');
    const remoteMutePresence = event(bob, 'room-presence');
    alice.emit('audio-state-update', { micMuted: true, outputMuted: true });
    const remoteMuteState = (await remoteMutePresence).members?.find((member) => member.clientId === 'cluster-alice')?.voiceupAudioState;
    if (!remoteMuteState?.micMuted || !remoteMuteState?.outputMuted) throw new Error('Os indicadores de mute não chegaram ao outro host');
    for (const state of [{ screen: true, camera: true }, { screen: false, camera: true }, { screen: false, camera: false }]) {
      const remoteMediaPresence = event(bob, 'room-presence');
      alice.emit('media-state-update', state);
      const remoteMediaState = (await remoteMediaPresence).members?.find((member) => member.clientId === 'cluster-alice')?.voiceupMediaState;
      if (!remoteMediaState || remoteMediaState.screen !== state.screen || remoteMediaState.camera !== state.camera) throw new Error('Os indicadores independentes de live e câmera não chegaram ao outro host');
    }
    const receivedSignal = event(bob, 'signal');
    alice.emit('signal', { target: bobRemote.id, data: { clusterSmoke: true } });
    if (!(await receivedSignal).data?.clusterSmoke) throw new Error('Sinal WebRTC não atravessou o cluster');
    alice.emit('webrtc-stats', { sampledAt: Date.now(), peers: [{ peerId: bobRemote.id, connectionState: 'connected', rttMs: 42, inboundKbps: 96, outboundKbps: 128, localCandidateType: 'host', remoteCandidateType: 'srflx', protocol: 'udp', codec: 'audio/opus' }] });
    bob.emit('webrtc-stats', { sampledAt: Date.now(), peers: [{ peerId: aliceRemote.id, connectionState: 'connected', rttMs: 45, inboundKbps: 128, outboundKbps: 96, localCandidateType: 'srflx', remoteCandidateType: 'host', protocol: 'udp', codec: 'audio/opus' }] });
    await wait(220);
    const telemetry = primary.getStats();
    if (telemetry.webrtc.supportedClients < 2 || telemetry.bandwidth.totalKbps < 400) throw new Error('Telemetria ou banda não foi agregada entre hosts');
    const action = event(bob, 'server-action');
    const moderation = primary.ban(bobRemote.id, { durationMinutes: 10, reason: 'Teste automático' });
    if (!moderation.ok || (await action).action !== 'banned') throw new Error('Banimento remoto não atravessou o cluster');
    await wait(200);
    if (!secondary.getStats().bans.some((ban) => ban.clientId === 'cluster-bob' && ban.expiresAt)) throw new Error('Banimento temporário não foi sincronizado');
    const redirectNotice = event(alice, 'cluster-redirect');
    const migration = primary.redirectClientsForShutdown();
    if (!migration.ok || migration.redirected !== 1) throw new Error('Primário não preparou a migração do Client conectado');
    const redirect = await redirectNotice;
    if (redirect.url !== `http://127.0.0.1:${ports.secondary}`) throw new Error('Primário anunciou um destino de failover incorreto');
    alice.disconnect();
    alice = io(redirect.url, { transports: ['websocket'], reconnection: false });
    await event(alice, 'connect');
    const migratedJoin = event(alice, 'room-joined');
    alice.emit('join-room', { roomId: 'cluster-room', voiceChannel: 'Geral', name: 'Alice', clientId: 'cluster-alice', platform: 'windows', status: 'dnd', capabilities: ['cluster-routing', 'webrtc-telemetry'] });
    await migratedJoin;
    await closeServer(primary); primary = null; await wait(1300);
    if (secondary.getStats().cluster.state !== 'failover ativo') throw new Error('Host secundário não entrou em failover');
    if (!secondary.getStats().members.some((member) => member.clientId === 'cluster-alice' && !member.remote)) throw new Error('Client não permaneceu conectado ao secundário após o failover');
    console.log(JSON.stringify({ ok: true, crossHostPresence: true, signaling: true, telemetry: true, bandwidthKbps: telemetry.bandwidth.totalKbps, temporaryBan: true, routeRefresh: true, gracefulRedirect: true, clientMigration: true, failover: true }));
  } catch (error) {
    console.error(error.stack || error.message); process.exitCode = 1;
  } finally {
    alice?.disconnect(); bob?.disconnect(); await closeServer(primary); await closeServer(secondary);
  }
})();
