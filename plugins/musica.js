const queues = new Map();
const VOLUME = 0.72;

module.exports = {
  id: 'musica', name: 'Bot de musica local', version: 'beta.3',
  description: 'Um bot entra no canal de voz e transmite arquivos da pasta music do Server Host.',

  onTextMessage({ text, room, textChannel, voiceChannel, user, api, plugin, serverIsCloud }) {
    const command = String(text).trim();
    if (!/^!music\b/i.test(command)) return;
    const [, action = 'help', ...parts] = command.split(/\s+/);
    const requested = parts.join(' ').trim();
    const queue = queues.get(room) || [];
    const say = (message) => api.systemMessage(room, textChannel, message, { name: 'Musica', color: '#47a7f5', pluginId: plugin.id });
    const tracks = api.media.list();
    const lowered = requested.toLocaleLowerCase('pt-BR');
    const findTrack = () => tracks.find((track) => track.toLocaleLowerCase('pt-BR') === lowered) || tracks.find((track) => track.toLocaleLowerCase('pt-BR').includes(lowered));
    const play = (track) => {
      if (serverIsCloud) return say('O Music Bot de voz funciona no Server Host Windows. No Cloud ele precisa de um processo de bot separado.');
      api.botCommand(room, { action: 'play', fileName: track, room, voiceChannel, title: track, volume: VOLUME, pluginId: plugin.id });
      say(`Music Bot entrou no canal e iniciou: ${track}`);
    };
    const commandName = action.toLowerCase();
    if (commandName === 'help') return say('Use: !music list, !music play <nome>, !music queue, !music skip ou !music stop. O Music Bot transmite como um participante da chamada.');
    if (commandName === 'list') return say(tracks.length ? `Musicas: ${tracks.join(' | ')}` : 'A pasta music esta vazia. Adicione audio no Server Host e reinicie o servidor.');
    if (commandName === 'queue') return say(queue.length ? `Fila (${queue.length}): ${queue.map((track, index) => `${index + 1}. ${track}`).join(' | ')}` : 'A fila esta vazia.');
    if (commandName === 'stop') { queues.set(room, []); if (!serverIsCloud) api.botCommand(room, { action: 'stop', room, pluginId: plugin.id }); return say(`${user.name} parou a musica e limpou a fila.`); }
    if (commandName === 'skip') {
      queue.shift(); const next = queue[0]; queues.set(room, queue);
      if (!next) { if (!serverIsCloud) api.botCommand(room, { action: 'stop', room, pluginId: plugin.id }); return say('Nao ha outra musica na fila.'); }
      play(next); return;
    }
    if (commandName !== 'play' || !requested) return say('Use: !music play <parte do nome do arquivo>. Veja os nomes com !music list.');
    const track = findTrack();
    if (!track) return say('Nao encontrei essa musica. Use !music list para ver os arquivos disponiveis.');
    queue.push(track); queues.set(room, queue);
    if (queue.length === 1) play(track); else say(`${track} foi adicionada a fila (${queue.length} itens).`);
  }
};
