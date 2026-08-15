const assert = require('assert');
const path = require('path');
const { loadPlugins } = require('../plugin-runtime');

(async () => {
  const messages = [];
  const events = [];
  const runtime = loadPlugins({
    directories: [path.join(__dirname, '..', 'plugins')],
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
