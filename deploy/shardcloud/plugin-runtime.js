const fs = require('fs');
const path = require('path');

const safeText = (value, max = 500) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const safeIcon = (value) => typeof value === 'string' && /^data:image\/(?:png|webp|svg\+xml);/i.test(value) && value.length <= 60_000 ? value : '';
const clone = (value, fallback = null) => { try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; } };

function loadPlugins({ directories = [], addLog = () => {}, emitSystemMessage, emitPluginEvent = () => {}, media = {}, stateFile = '' }) {
  const loaded = [];
  const seenIds = new Set();
  const errors = [];
  let persisted = { version: 1, plugins: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object') persisted = { version: 1, plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {} };
  } catch { /* first start or invalid optional file */ }

  const persist = () => {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(persisted, null, 2), 'utf8');
    } catch (error) { addLog('error', `Não foi possível salvar as opções dos plugins: ${safeText(error.message, 160)}`); }
  };
  const pluginRecord = (id) => {
    const known = persisted.plugins[id];
    if (!known || typeof known !== 'object') persisted.plugins[id] = { enabled: true, settings: {}, data: {} };
    const record = persisted.plugins[id];
    if (typeof record.enabled !== 'boolean') record.enabled = true;
    if (!record.settings || typeof record.settings !== 'object') record.settings = {};
    if (!record.data || typeof record.data !== 'object') record.data = {};
    return record;
  };
  const normalizeSchema = (plugin) => (Array.isArray(plugin.settings) ? plugin.settings : []).filter((field) => field && /^[a-z][a-z0-9_-]{1,39}$/i.test(field.key)).slice(0, 24).map((field) => ({
    key: field.key,
    label: safeText(field.label || field.key, 56),
    description: safeText(field.description || '', 120),
    type: ['number', 'range', 'boolean', 'select', 'text'].includes(field.type) ? field.type : 'text',
    default: field.default,
    min: Number.isFinite(Number(field.min)) ? Number(field.min) : undefined,
    max: Number.isFinite(Number(field.max)) ? Number(field.max) : undefined,
    step: Number.isFinite(Number(field.step)) ? Number(field.step) : undefined,
    options: Array.isArray(field.options) ? field.options.slice(0, 20).map((option) => typeof option === 'object' ? { value: safeText(option.value, 40), label: safeText(option.label || option.value, 50) } : { value: safeText(option, 40), label: safeText(option, 50) }) : []
  }));
  const settingValue = (field, value) => {
    const candidate = value === undefined ? field.default : value;
    if (field.type === 'boolean') return candidate === true || candidate === 'true';
    if (field.type === 'number' || field.type === 'range') {
      let number = Number(candidate);
      if (!Number.isFinite(number)) number = Number(field.default) || 0;
      if (field.min !== undefined) number = Math.max(field.min, number);
      if (field.max !== undefined) number = Math.min(field.max, number);
      return field.step && field.step < 1 ? Number(number.toFixed(4)) : Math.round(number);
    }
    if (field.type === 'select') {
      const valueText = safeText(candidate, 40);
      return field.options.some((option) => option.value === valueText) ? valueText : safeText(field.default ?? field.options[0]?.value, 40);
    }
    return safeText(candidate, 120);
  };

  for (const directory of directories.filter(Boolean)) {
    const resolvedDirectory = path.resolve(directory);
    if (!fs.existsSync(resolvedDirectory)) continue;
    for (const file of fs.readdirSync(resolvedDirectory).filter((name) => name.endsWith('.js')).sort()) {
      const absolutePath = path.join(resolvedDirectory, file);
      try {
        delete require.cache[require.resolve(absolutePath)];
        const plugin = require(absolutePath);
        if (!plugin || typeof plugin !== 'object' || !/^[a-z0-9-]{2,40}$/i.test(plugin.id) || typeof plugin.onTextMessage !== 'function') throw new Error('plugin precisa exportar id e onTextMessage(contexto)');
        if (seenIds.has(plugin.id)) { addLog('plugin', `[${plugin.id}] ignorado: existe outro plugin com este id`); continue; }
        seenIds.add(plugin.id);
        const schema = normalizeSchema(plugin);
        const record = pluginRecord(plugin.id);
        for (const field of schema) record.settings[field.key] = settingValue(field, record.settings[field.key]);
        loaded.push({ id: plugin.id, name: safeText(plugin.name || plugin.id, 48), version: safeText(plugin.version || 'beta', 24), description: safeText(plugin.description || '', 140), icon: safeIcon(plugin.icon), schema, plugin });
        addLog('plugin', `[${plugin.id}] ${record.enabled ? 'carregado' : 'desabilitado'} de ${path.basename(resolvedDirectory)}`);
      } catch (error) {
        const message = `${file}: ${safeText(error.message, 180)}`;
        errors.push(message); addLog('error', `Plugin inválido: ${message}`);
      }
    }
  }
  persist();

  const entryApi = (entry) => {
    const record = pluginRecord(entry.id);
    return {
      systemMessage: (room, textChannel, text, options = {}) => emitSystemMessage({
        room,
        textChannel: safeText(textChannel || 'geral', 24) || 'geral',
        text: safeText(text),
        name: safeText(options.name || entry.name || 'VoiceUP Bot', 24) || 'VoiceUP Bot',
        color: options.color || '#a879ff',
        avatar: safeIcon(options.avatar || entry.icon),
        pluginId: entry.id
      }),
      botCommand: (room, payload = {}) => emitPluginEvent({ room, event: 'music-bot', payload: { ...payload, pluginId: entry.id }, pluginId: entry.id }),
      media: { list: () => (typeof media.list === 'function' ? media.list() : []), url: (name) => (typeof media.url === 'function' ? media.url(name) : '') },
      settings: clone(record.settings, {}),
      storage: {
        get: (key, fallback = null) => Object.prototype.hasOwnProperty.call(record.data, key) ? clone(record.data[key], fallback) : fallback,
        set: (key, value) => { const safeKey = safeText(key, 60); record.data[safeKey] = clone(value, null); persist(); return clone(record.data[safeKey]); },
        delete: (key) => { delete record.data[safeText(key, 60)]; persist(); }
      },
      log: (message) => addLog('plugin', `[${entry.id}] ${safeText(message, 180)}`)
    };
  };
  const adminState = (entry) => {
    if (typeof entry.plugin.getAdminState !== 'function') return null;
    try { return clone(entry.plugin.getAdminState({ plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) }), null); }
    catch (error) { addLog('error', `[${entry.id}] painel: ${safeText(error.message, 160)}`); return null; }
  };

  async function onTextMessage(event) {
    for (const entry of loaded) {
      if (!pluginRecord(entry.id).enabled) continue;
      try {
        await entry.plugin.onTextMessage({ ...event, plugin: { id: entry.id, name: entry.name, icon: entry.icon }, api: entryApi(entry) });
      } catch (error) { addLog('error', `[${entry.id}] ${safeText(error.message, 180)}`); }
    }
  }
  async function configure(id, next = {}) {
    const entry = loaded.find((item) => item.id === id);
    if (!entry) return { ok: false, message: 'Plugin não encontrado.' };
    const record = pluginRecord(id); const wasEnabled = record.enabled;
    if (typeof next.enabled === 'boolean') record.enabled = next.enabled;
    if (next.settings && typeof next.settings === 'object') for (const field of entry.schema) {
      if (Object.prototype.hasOwnProperty.call(next.settings, field.key)) record.settings[field.key] = settingValue(field, next.settings[field.key]);
    }
    persist();
    if (wasEnabled && !record.enabled && typeof entry.plugin.onDisable === 'function') await entry.plugin.onDisable({ plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) });
    if (!wasEnabled && record.enabled && typeof entry.plugin.onEnable === 'function') await entry.plugin.onEnable({ plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) });
    addLog('plugin', `[${id}] opções salvas; ${record.enabled ? 'habilitado' : 'desabilitado'}`);
    return { ok: true, message: `${entry.name} foi ${record.enabled ? 'salvo e habilitado' : 'salvo e desabilitado'}.`, plugin: describe(entry) };
  }
  async function action(id, actionName, payload = {}) {
    const entry = loaded.find((item) => item.id === id);
    if (!entry || typeof entry.plugin.onAdminAction !== 'function') return { ok: false, message: 'Este plugin não possui ações administrativas.' };
    try {
      const result = await entry.plugin.onAdminAction({ action: safeText(actionName, 40), payload: clone(payload, {}), plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) });
      return { ok: result?.ok !== false, message: safeText(result?.message || 'Alteração salva.', 180), plugin: describe(entry) };
    } catch (error) { return { ok: false, message: safeText(error.message || 'Falha na ação do plugin.', 180) }; }
  }
  function describe(entry) {
    const record = pluginRecord(entry.id);
    return { id: entry.id, name: entry.name, version: entry.version, description: entry.description, icon: entry.icon, enabled: record.enabled, schema: clone(entry.schema, []), settings: clone(record.settings, {}), adminState: adminState(entry) };
  }

  return {
    onTextMessage,
    configure,
    action,
    list: () => loaded.map(describe),
    errors: () => [...errors]
  };
}

module.exports = { loadPlugins };
