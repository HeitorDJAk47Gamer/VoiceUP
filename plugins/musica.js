const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#47a7f5"/><circle cx="24" cy="43" r="9" fill="#eaf7ff"/><circle cx="46" cy="38" r="9" fill="#eaf7ff"/><path d="M31 42V16l23-5v26M31 23l23-5" fill="none" stroke="#173956" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>').toString('base64')}`;
const queues = new Map();
const assignments = new Map();
const keyFor = (room, voiceChannel) => `${room}:${voiceChannel || 'Geral'}`;
const botFor = (key, maxBots) => {
  if (assignments.has(key)) return assignments.get(key);
  const used = new Set(assignments.values());
  for (let number = 1; number <= maxBots; number += 1) if (!used.has(number)) { assignments.set(key, number); return number; }
  return 0;
};

module.exports = {
  id: 'musica', name: 'Music Bot local', version: 'beta.6', icon: ICON,
  description: 'Até três bots independentes transmitem arquivos da pasta music em calls diferentes com !m.',
  settings: [
    { key: 'avatar1', label: 'Foto do Music Bot 1', description: 'Avatar individual do primeiro bot.', type: 'image', default: '' },
    { key: 'avatar2', label: 'Foto do Music Bot 2', description: 'Avatar individual do segundo bot.', type: 'image', default: '' },
    { key: 'avatar3', label: 'Foto do Music Bot 3', description: 'Avatar individual do terceiro bot.', type: 'image', default: '' },
    { key: 'maxBots', label: 'Quantidade de Music Bots', description: 'Instâncias simultâneas disponíveis para calls diferentes.', type: 'range', default: 3, min: 1, max: 3, step: 1 },
    { key: 'volume', label: 'Volume padrão dos bots', description: 'Volume usado na reprodução local do arquivo.', type: 'range', default: 72, min: 0, max: 100, step: 1 }
  ],

  onTextMessage({ text, room, textChannel, voiceChannel, user, api, plugin, serverIsCloud }) {
    const command = String(text).trim();
    if (!/^!(?:m|music)\b/i.test(command)) return;
    const [, action = 'help', ...parts] = command.split(/\s+/); const requested = parts.join(' ').trim();
    const key = keyFor(room, voiceChannel); const queue = queues.get(key) || [];
    const configuredAvatar = (botId = 1) => api.settings[`avatar${botId}`] || api.settings.botAvatar || ICON;
    const say = (message, botId = 0) => api.systemMessage(room, textChannel, message, { name: botId ? `Music Bot ${botId}` : 'Music Bot', color: '#47a7f5', avatarSetting: configuredAvatar(botId || 1), pluginId: plugin.id });
    const tracks = api.media.list(); const lowered = requested.toLocaleLowerCase('pt-BR');
    const findTrack = () => tracks.find((track) => track.toLocaleLowerCase('pt-BR') === lowered) || tracks.find((track) => track.toLocaleLowerCase('pt-BR').includes(lowered));
    const play = (track) => {
      if (serverIsCloud) return say('O Music Bot de voz precisa de um processo de áudio separado nesta hospedagem Cloud.');
      const botId = botFor(key, api.settings.maxBots);
      if (!botId) return say(`Os ${api.settings.maxBots} Music Bots já estão ocupados em outras calls.`);
      api.botCommand(room, { action: 'play', botId, botName: `Music Bot ${botId}`, avatar: configuredAvatar(botId), fileName: track, room, voiceChannel, title: track, volume: api.settings.volume / 100 });
      say(`Music Bot ${botId} entrou em ${voiceChannel || 'Geral'} e iniciou: ${track}`, botId);
    };
    const commandName = action.toLowerCase();
    if (commandName === 'help') return say('Use: !m list, !m play <nome>, !m queue, !m skip ou !m stop. O comando !music continua como atalho compatível. Há até 3 bots para calls diferentes.');
    if (commandName === 'list') return say(tracks.length ? `Músicas: ${tracks.join(' | ')}` : 'A pasta music está vazia. Adicione áudio no Server Host e reinicie o servidor.');
    if (commandName === 'queue') return say(queue.length ? `Fila (${queue.length}): ${queue.map((track, index) => `${index + 1}. ${track}`).join(' | ')}` : 'A fila está vazia.');
    if (commandName === 'stop') {
      queues.delete(key); const botId = assignments.get(key); assignments.delete(key);
      if (!serverIsCloud && botId) api.botCommand(room, { action: 'stop', botId, room, voiceChannel, disconnect: true });
      return say(`${user.name} parou a música, limpou a lista e desconectou o bot da call.`);
    }
    if (commandName === 'skip') {
      queue.shift(); const next = queue[0]; queues.set(key, queue);
      if (!next) { const botId = assignments.get(key); assignments.delete(key); if (!serverIsCloud && botId) api.botCommand(room, { action: 'stop', botId, room, voiceChannel, disconnect: true }); return say('Não há outra música na fila. O bot saiu da call.'); }
      play(next); return;
    }
    if (commandName !== 'play' || !requested) return say('Use: !m play <parte do nome do arquivo>. Veja os nomes com !m list.');
    if (!voiceChannel || voiceChannel === '__lobby__') return say('Entre em uma call antes de chamar o Music Bot.');
    const track = findTrack(); if (!track) return say('Não encontrei essa música. Use !m list para ver os arquivos disponíveis.');
    queue.push(track); queues.set(key, queue); if (queue.length === 1) play(track); else say(`${track} foi adicionada à fila (${queue.length} itens).`);
  },

  onDisable({ api }) {
    for (const [key, botId] of assignments) { const [room, ...channel] = key.split(':'); api.botCommand(room, { action: 'stop', botId, room, voiceChannel: channel.join(':'), disconnect: true }); }
    assignments.clear(); queues.clear();
  },
  getAdminState() { return { type: 'music-bots', active: [...assignments.entries()].map(([key, botId]) => ({ key, botId, queueSize: queues.get(key)?.length || 0 })) }; }
};
