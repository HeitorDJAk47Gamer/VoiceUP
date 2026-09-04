const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPlugins } = require('../plugin-runtime');

(async () => {
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-plugin-gate-'));
  const externalPluginFile = path.join(externalDirectory, 'externo.js');
  const externalStateFile = path.join(externalDirectory, 'state.json');
  try {
    fs.writeFileSync(externalPluginFile, `global.__voiceupExternalPluginExecuted = true; module.exports = { id: 'externo', name: 'Externo', onTextMessage() {} };`);
    delete global.__voiceupExternalPluginExecuted;
    let guardedRuntime = loadPlugins({ directories: [externalDirectory], stateFile: externalStateFile, emitSystemMessage: () => {} });
    let pendingPlugin = guardedRuntime.list()[0];
    assert.equal(pendingPlugin.requiresApproval, true);
    assert.equal(global.__voiceupExternalPluginExecuted, undefined, 'Plugin externo foi executado antes da aprovação.');
    let approval = await guardedRuntime.configure(pendingPlugin.id, { enabled: true, approveFingerprint: '0'.repeat(64) });
    assert.equal(approval.ok, false);
    approval = await guardedRuntime.configure(pendingPlugin.id, { enabled: true, approveFingerprint: pendingPlugin.fingerprint });
    assert.equal(approval.ok, true);
    assert.equal(approval.requiresReload, true);
    assert.equal(global.__voiceupExternalPluginExecuted, undefined, 'A aprovação executou o plugin antes da recarga solicitada.');
    guardedRuntime = loadPlugins({ directories: [externalDirectory], stateFile: externalStateFile, emitSystemMessage: () => {} });
    assert.equal(global.__voiceupExternalPluginExecuted, true);
    assert.equal(guardedRuntime.list()[0].id, 'externo');

    global.__voiceupExternalPluginExecuted = false;
    fs.appendFileSync(externalPluginFile, `\n// arquivo alterado`);
    guardedRuntime = loadPlugins({ directories: [externalDirectory], stateFile: externalStateFile, emitSystemMessage: () => {} });
    pendingPlugin = guardedRuntime.list()[0];
    assert.equal(pendingPlugin.requiresApproval, true, 'Plugin alterado reutilizou uma aprovação antiga.');
    assert.equal(global.__voiceupExternalPluginExecuted, false, 'Plugin alterado foi executado antes da nova aprovação.');
  } finally {
    delete global.__voiceupExternalPluginExecuted;
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }

  const messages = [];
  const events = [];
  const runtime = loadPlugins({
    directories: [path.join(__dirname, '..', 'plugins')],
    trustedPluginDirectories: [path.join(__dirname, '..', 'plugins')],
    emitSystemMessage: (message) => messages.push(message),
    emitPluginEvent: (event) => events.push(event),
    media: { list: () => ['alpha.mp3', 'beta.ogg'] }
  });
  const list = runtime.list();
  assert.equal(list.length, 3);
  assert(list.every((plugin) => plugin.icon.startsWith('data:image/')));
  assert(list.every((plugin) => plugin.enabled));
  assert(list.every((plugin) => plugin.schema.some((field) => field.key === 'botAvatar' && field.type === 'image')));

  const send = (text, room = 'sala', voiceChannel = 'Geral', id = 'u1', name = 'Heitor') => runtime.onTextMessage({ text, room, voiceChannel, textChannel: 'geral', user: { id, clientId: id, name }, serverIsCloud: false });
  await send('2d6 + d20');
  assert(messages.some((message) => message.pluginId === 'dados' && /rolou 2d6 \+ d20/.test(message.text) && /d20 \[/.test(message.text)));

  await send('uma mensagem que vale xp');
  await send('!xp');
  await send('!xp ranking');
  assert(messages.some((message) => message.pluginId === 'xp-chat' && /total \d+/.test(message.text)));
  assert(messages.some((message) => message.pluginId === 'xp-chat' && /🥇/.test(message.text)));
  let xpPlugin = runtime.list().find((plugin) => plugin.id === 'xp-chat');
  assert.equal(xpPlugin.adminState.users.length, 1);
  let result = await runtime.action('xp-chat', 'set-xp', { room: 'sala', id: 'u1', totalXp: 450 });
  assert(result.ok);
  xpPlugin = runtime.list().find((plugin) => plugin.id === 'xp-chat');
  assert.equal(xpPlugin.adminState.users[0].totalXp, 450);

  result = await runtime.configure('xp-chat', { settings: { minGain: 12, maxGain: 12, cooldownSeconds: 0 } });
  assert(result.ok);
  await send('mensagem com ganho fixo', 'sala', 'Geral', 'programa-unico-42', 'Rotieh');
  xpPlugin = runtime.list().find((plugin) => plugin.id === 'xp-chat');
  const persistedProfile = xpPlugin.adminState.users.find((entry) => entry.id === 'programa-unico-42');
  assert.equal(persistedProfile.totalXp, 12);
  assert.equal(persistedProfile.programId, 'programa-unico-42');

  const customBotAvatar = list.find((plugin) => plugin.id === 'musica').icon;
  result = await runtime.configure('musica', { settings: { avatar1: customBotAvatar } });
  assert(result.ok);
  await send('!m play alpha', 'sala1', 'Geral');
  await send('!music play alpha', 'sala2', 'Jogando');
  await send('!music play alpha', 'sala3', 'Ausente');
  assert.deepEqual(events.filter((event) => event.payload.action === 'play').map((event) => event.payload.botId), [1, 2, 3]);
  assert.equal(events.find((event) => event.payload.action === 'play').payload.avatar, customBotAvatar);
  await send('!music stop', 'sala2', 'Jogando');
  const stop = events.findLast((event) => event.payload.action === 'stop');
  assert.equal(stop.payload.botId, 2);
  assert.equal(stop.payload.disconnect, true);

  result = await runtime.configure('dados', { enabled: false, settings: { maxDice: 5 } });
  assert(result.ok);
  const before = messages.length;
  await send('d20');
  assert.equal(messages.length, before);
  assert.equal(runtime.list().find((plugin) => plugin.id === 'dados').settings.maxDice, 5);
  console.log('plugin-runtime-ok', list.map((plugin) => plugin.id).join(','), `messages=${messages.length}`, `events=${events.length}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
