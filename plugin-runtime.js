const fs = require('fs');
const path = require('path');

const safeText = (value, max = 500) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function loadPlugins({ directories = [], addLog = () => {}, emitSystemMessage, emitPluginEvent = () => {}, media = {} }) {
  const loaded = [];
  const seenIds = new Set();
  const errors = [];
  const context = {
    systemMessage: (room, textChannel, text, options = {}) => emitSystemMessage({
      room,
      textChannel: safeText(textChannel || 'geral', 24) || 'geral',
      text: safeText(text),
      name: safeText(options.name || 'VoiceUP Bot', 24) || 'VoiceUP Bot',
      color: options.color || '#a879ff',
      pluginId: options.pluginId || ''
    }),
    broadcast: (room, event, payload = {}) => emitPluginEvent({ room, event: safeText(event, 48), payload, pluginId: payload.pluginId || '' }),
    media: { list: () => (typeof media.list === 'function' ? media.list() : []), url: (name) => (typeof media.url === 'function' ? media.url(name) : '') },
    log: (pluginId, message) => addLog('plugin', `[${pluginId}] ${safeText(message, 180)}`)
  };

  for (const directory of directories.filter(Boolean)) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js')).sort()) {
      const absolutePath = path.join(directory, file);
      try {
        delete require.cache[require.resolve(absolutePath)];
        const plugin = require(absolutePath);
        if (!plugin || typeof plugin !== 'object' || !/^[a-z0-9-]{2,40}$/i.test(plugin.id) || typeof plugin.onTextMessage !== 'function') throw new Error('plugin precisa exportar id e onTextMessage(contexto)');
        if (seenIds.has(plugin.id)) { addLog('plugin', `[${plugin.id}] ignorado: existe outro plugin com este id`); continue; }
        seenIds.add(plugin.id);
        loaded.push({ id: plugin.id, name: safeText(plugin.name || plugin.id, 48), version: safeText(plugin.version || 'beta', 24), description: safeText(plugin.description || '', 140), plugin });
        addLog('plugin', `[${plugin.id}] carregado de ${path.basename(directory)}`);
      } catch (error) {
        const message = `${file}: ${safeText(error.message, 180)}`;
        errors.push(message); addLog('error', `Plugin inválido: ${message}`);
      }
    }
  }

  async function onTextMessage(event) {
    for (const entry of loaded) {
      try {
        await entry.plugin.onTextMessage({ ...event, plugin: { id: entry.id, name: entry.name }, api: context });
      } catch (error) {
        addLog('error', `[${entry.id}] ${safeText(error.message, 180)}`);
      }
    }
  }

  return {
    onTextMessage,
    list: () => loaded.map(({ id, name, version, description }) => ({ id, name, version, description })),
    errors: () => [...errors]
  };
}

module.exports = { loadPlugins };
