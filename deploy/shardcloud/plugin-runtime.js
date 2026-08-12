const fs = require('fs');
const path = require('path');
const safeText = (value, max = 500) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function loadPlugins({ directories = [], addLog = () => {}, emitSystemMessage }) {
  const loaded = []; const seenIds = new Set(); const errors = [];
  const api = { systemMessage: (room, textChannel, text, options = {}) => emitSystemMessage({ room, textChannel: safeText(textChannel || 'geral', 24) || 'geral', text: safeText(text), name: safeText(options.name || 'VoiceUP Bot', 24) || 'VoiceUP Bot', color: options.color || '#a879ff', pluginId: options.pluginId || '' }), log: (id, message) => addLog('plugin', `[${id}] ${safeText(message, 180)}`) };
  for (const directory of directories.filter(Boolean)) { if (!fs.existsSync(directory)) continue; for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js')).sort()) { const filePath = path.join(directory, file); try { delete require.cache[require.resolve(filePath)]; const plugin = require(filePath); if (!plugin || typeof plugin !== 'object' || !/^[a-z0-9-]{2,40}$/i.test(plugin.id) || typeof plugin.onTextMessage !== 'function') throw new Error('plugin precisa exportar id e onTextMessage(contexto)'); if (seenIds.has(plugin.id)) { addLog('plugin', `[${plugin.id}] ignorado: id duplicado`); continue; } seenIds.add(plugin.id); loaded.push({ id: plugin.id, name: safeText(plugin.name || plugin.id, 48), version: safeText(plugin.version || 'beta', 24), description: safeText(plugin.description || '', 140), plugin }); addLog('plugin', `[${plugin.id}] carregado`); } catch (error) { const message = `${file}: ${safeText(error.message, 180)}`; errors.push(message); addLog('error', `Plugin inválido: ${message}`); } } }
  return { onTextMessage: async (event) => { for (const entry of loaded) try { await entry.plugin.onTextMessage({ ...event, plugin: { id: entry.id, name: entry.name }, api }); } catch (error) { addLog('error', `[${entry.id}] ${safeText(error.message, 180)}`); } }, list: () => loaded.map(({ id, name, version, description }) => ({ id, name, version, description })), errors: () => [...errors] };
}
module.exports = { loadPlugins };
