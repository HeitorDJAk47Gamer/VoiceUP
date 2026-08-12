const queues = new Map();
const isYouTube = (value) => /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(value);
const isLocal = (value) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);

module.exports = {
  id: 'musica',
  name: 'Bot de música',
  version: 'beta.1',
  description: 'Mantém uma fila de links do YouTube ou áudio local. Comandos: !music play, !music queue e !music skip.',

  onTextMessage({ text, room, textChannel, user, api, serverIsCloud, plugin }) {
    const command = String(text).trim();
    if (!/^!music\b/i.test(command)) return;
    const [, action = 'help', ...parts] = command.split(/\s+/);
    const value = parts.join(' ').trim();
    const queue = queues.get(room) || [];
    const say = (message) => api.systemMessage(room, textChannel, message, { name: 'Música', color: '#47a7f5', pluginId: plugin.id });
    if (action.toLowerCase() === 'help') return say('Comandos: !music play <link>, !music queue, !music skip. Aceita links do YouTube ou HTTP localhost no Server Host.');
    if (action.toLowerCase() === 'queue') return say(queue.length ? `Fila (${queue.length}): ${queue.map((item, index) => `${index + 1}. ${item.source}`).join(' | ')}` : 'A fila está vazia.');
    if (action.toLowerCase() === 'skip') { const skipped = queue.shift(); queues.set(room, queue); return say(skipped ? `${user.name} pulou: ${skipped.source}` : 'Não há música na fila.'); }
    if (action.toLowerCase() !== 'play' || !value) return say('Use: !music play <link do YouTube ou URL local>.');
    if (!isYouTube(value) && !(isLocal(value) && !serverIsCloud)) return say(serverIsCloud ? 'No Cloud beta use somente links HTTPS do YouTube.' : 'Use um link do YouTube ou http://localhost:porta/arquivo.mp3.');
    queue.push({ source: value, requestedBy: user.name, at: Date.now() }); queues.set(room, queue);
    say(`${user.name} adicionou à fila: ${value}. Reprodução de áudio do bot será adicionada numa próxima fase; esta beta valida e sincroniza a fila.`);
  }
};
