/// <reference path="../voiceup-plugin-api.d.ts" />

/** @type {VoiceUP.PluginDefinition} */
module.exports = {
  id: 'contador-oi',
  name: 'Contador de oi',
  version: '1.0.0',
  description: 'Exemplo da API: responde !oi e guarda uma contagem por servidor.',
  settings: [
    { key: 'reply', label: 'Resposta do bot', type: 'text', default: 'Olá!' },
    { key: 'showCount', label: 'Mostrar contagem', type: 'boolean', default: true }
  ],

  onTextMessage({ text, room, textChannel, user, api }) {
    if (String(text).trim().toLowerCase() !== '!oi') return;
    const key = `count:${room}`;
    const count = api.storage.get(key, 0) + 1;
    api.storage.set(key, count);
    const suffix = api.settings.showCount ? ` Esta foi a resposta número ${count}.` : '';
    api.systemMessage(room, textChannel, `${api.settings.reply} ${user.name}!${suffix}`, {
      name: 'Bot de exemplo', color: '#56e2cf'
    });
  },

  onDisable({ api }) {
    api.log('Plugin desabilitado pelo host.');
  }
};
