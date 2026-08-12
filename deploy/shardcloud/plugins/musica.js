module.exports = {
  id: 'musica', name: 'Bot de musica local', version: 'beta.3',
  description: 'Comandos reservados para o Music Bot do Server Host Windows.',
  onTextMessage({ text, room, textChannel, api, plugin }) {
    if (!/^!music\b/i.test(String(text).trim())) return;
    api.systemMessage(room, textChannel, 'O Music Bot que transmite audio para o canal funciona no Server Host Windows. No Cloud ele exigiria um processo de bot separado.', { name: 'Musica', color: '#47a7f5', pluginId: plugin.id });
  }
};
