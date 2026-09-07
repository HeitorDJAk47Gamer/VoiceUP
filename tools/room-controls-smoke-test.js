const { io } = require('socket.io-client');
const { startSignalingServer } = require('../signaling-server');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 3193;
const waitFor = (socket, name, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout em ${name}`)), timeout);
  socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
});
const closeServer = (running) => new Promise((resolve) => { running.io.close(); running.server.close(resolve); setTimeout(resolve, 1000).unref(); });

(async () => {
  let running; let alice; let bob;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-room-controls-'));
  try {
    running = await startSignalingServer(port, {
      punishmentsFile: path.join(scratch, 'chat-punishments.json'),
      chatCooldownSeconds: 2,
      roomLayouts: [{
        id: 'managed', name: 'Sala gerenciada',
        voiceChannelSettings: [
          { name: 'Lobby', userLimit: 1, bitrateKbps: 96, region: 'brazil' },
          { name: 'Privado', locked: true }
        ],
        textChannelSettings: [
          { name: 'avisos', readOnly: true },
          { name: 'lento', slowModeSeconds: 5 },
          { name: 'livre', slowModeSeconds: 0 }
        ]
      }]
    });
    alice = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    bob = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    await Promise.all([waitFor(alice, 'connect'), waitFor(bob, 'connect')]);
    const aliceJoin = waitFor(alice, 'room-joined'); alice.emit('join-room', { roomId: 'managed', voiceChannel: '__lobby__', name: 'Alice', clientId: 'rooms-alice' }); await aliceJoin;
    const bobJoin = waitFor(bob, 'room-joined'); bob.emit('join-room', { roomId: 'managed', voiceChannel: '__lobby__', name: 'Bob', clientId: 'rooms-bob' }); await bobJoin;
    const aliceCall = waitFor(alice, 'room-joined'); alice.emit('switch-voice-channel', { voiceChannel: 'Lobby' }); await aliceCall;
    const limitError = waitFor(bob, 'app-error'); bob.emit('switch-voice-channel', { voiceChannel: 'Lobby' }); if (!/limite de 1/i.test(await limitError)) throw new Error('Limite por canal não foi aplicado');
    const lockError = waitFor(bob, 'app-error'); bob.emit('switch-voice-channel', { voiceChannel: 'Privado' }); if (!/fechado/i.test(await lockError)) throw new Error('Canal fechado não foi aplicado');
    const readOnlyError = waitFor(alice, 'app-error'); alice.emit('text-message', { text: 'não deveria', textChannel: 'avisos' }); if (!/somente leitura/i.test(await readOnlyError)) throw new Error('Somente leitura não foi aplicado');
    const firstText = waitFor(bob, 'text-message'); alice.emit('text-message', { text: 'primeira', textChannel: 'lento' }); await firstText;
    const slowError = waitFor(alice, 'app-error'); alice.emit('text-message', { text: 'segunda', textChannel: 'lento' }); if (!/cooldown/i.test(await slowError)) throw new Error('Cooldown do canal não foi aplicado');
    const globalFirstText = waitFor(bob, 'text-message'); alice.emit('text-message', { text: 'global primeira', textChannel: 'livre' }); await globalFirstText;
    const globalSlowError = waitFor(alice, 'app-error'); alice.emit('text-message', { text: 'global segunda', textChannel: 'livre' }); if (!/cooldown/i.test(await globalSlowError)) throw new Error('Cooldown global não foi aplicado');
    const punishmentNotice = waitFor(alice, 'app-error');
    const punished = running.punishChat(alice.id, { durationMinutes: 10, reason: 'teste automatizado' });
    if (!punished.ok || !/castigo/i.test(await punishmentNotice)) throw new Error('Castigo não foi aplicado ao participante');
    const punishmentBlock = waitFor(alice, 'app-error'); alice.emit('text-message', { text: 'bloqueada', textChannel: 'livre' }); if (!/castigo/i.test(await punishmentBlock)) throw new Error('Participante castigado conseguiu usar o chat');
    if (running.getStats().chatPunishments.length !== 1) throw new Error('Castigo não apareceu nas estatísticas');
    const persistedPunishments = JSON.parse(fs.readFileSync(path.join(scratch, 'chat-punishments.json'), 'utf8'));
    if (persistedPunishments[0]?.clientId !== 'rooms-alice') throw new Error('Castigo não foi persistido para a identidade correta');
    const unpunished = running.unpunishChat('rooms-alice');
    if (!unpunished.ok || running.getStats().chatPunishments.length !== 0) throw new Error('Castigo não foi removido');
    if (JSON.parse(fs.readFileSync(path.join(scratch, 'chat-punishments.json'), 'utf8')).length !== 0) throw new Error('A remoção do castigo não foi persistida em disco');
    const layout = running.getStats().roomLayouts[0];
    if (layout.voiceChannelSettings[0].bitrateKbps !== 96 || layout.voiceChannelSettings[0].region !== 'brazil') throw new Error('Configuração detalhada do canal foi perdida');
    console.log(JSON.stringify({ ok: true, limit: true, locked: true, readOnly: true, channelCooldown: true, globalCooldown: true, chatPunishment: true, bitrate: layout.voiceChannelSettings[0].bitrateKbps, region: layout.voiceChannelSettings[0].region }));
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
  finally { alice?.disconnect(); bob?.disconnect(); if (running) await closeServer(running); fs.rmSync(scratch, { recursive: true, force: true }); }
})();
