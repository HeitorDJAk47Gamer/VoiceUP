const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const safeText = (value, max = 500) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const safeIcon = (value) => typeof value === 'string' && /^data:image\/(?:png|webp|svg\+xml);/i.test(value) && value.length <= 60_000 ? value : '';
const clone = (value, fallback = null) => { try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; } };

function loadPlugins({ directories = [], trustedPluginHashes = [], trustedPluginDirectories = [], addLog = () => {}, emitSystemMessage, emitPluginEvent = () => {}, media = {}, stateFile = '' }) {
  const loaded = [];
  const seenIds = new Set();
  const seenFingerprints = new Set();
  const errors = [];
  const trustedHashes = new Set((Array.isArray(trustedPluginHashes) ? trustedPluginHashes : []).map((value) => String(value || '').toLowerCase()).filter((value) => /^[a-f0-9]{64}$/.test(value)));
  const trustedDirectories = (Array.isArray(trustedPluginDirectories) ? trustedPluginDirectories : []).map((value) => path.resolve(String(value || ''))).filter(Boolean);
  let persisted = { version: 2, plugins: {}, approvals: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object') persisted = { version: 2, plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {}, approvals: parsed.approvals && typeof parsed.approvals === 'object' ? parsed.approvals : {} };
  } catch { /* first start or invalid optional file */ }

  const persist = () => {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(persisted, null, 2), 'utf8');
    } catch (error) { addLog('error', `Não foi possível salvar as opções dos plugins: ${safeText(error.message, 160)}`); }
  };
  const pluginRecord = (id, defaultEnabled = true) => {
    const known = persisted.plugins[id];
    if (!known || typeof known !== 'object') persisted.plugins[id] = { enabled: defaultEnabled, settings: {}, data: {} };
    const record = persisted.plugins[id];
    if (typeof record.enabled !== 'boolean') record.enabled = defaultEnabled;
    if (!record.settings || typeof record.settings !== 'object') record.settings = {};
    if (!record.data || typeof record.data !== 'object') record.data = {};
    return record;
  };
  const normalizeSchema = (plugin) => {
    const declared = Array.isArray(plugin.settings) ? [...plugin.settings] : [];
    if (!declared.some((field) => field?.key === 'botAvatar')) declared.unshift({ key: 'botAvatar', label: 'Foto do bot', description: 'Imagem usada pelo bot nas mensagens e, quando aplicável, na call.', type: 'image', default: '' });
    return declared.filter((field) => field && /^[a-z][a-z0-9_-]{1,39}$/i.test(field.key)).slice(0, 24).map((field) => ({
    key: field.key,
    label: safeText(field.label || field.key, 56),
    description: safeText(field.description || '', 120),
    type: ['number', 'range', 'boolean', 'select', 'text', 'image'].includes(field.type) ? field.type : 'text',
    default: field.default,
    min: Number.isFinite(Number(field.min)) ? Number(field.min) : undefined,
    max: Number.isFinite(Number(field.max)) ? Number(field.max) : undefined,
    step: Number.isFinite(Number(field.step)) ? Number(field.step) : undefined,
    options: Array.isArray(field.options) ? field.options.slice(0, 20).map((option) => typeof option === 'object' ? { value: safeText(option.value, 40), label: safeText(option.label || option.value, 50) } : { value: safeText(option, 40), label: safeText(option, 50) }) : []
    }));
  };
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
    if (field.type === 'image') return safeIcon(candidate);
    return safeText(candidate, 120);
  };

  for (const directory of directories.filter(Boolean)) {
    const resolvedDirectory = path.resolve(directory);
    if (!fs.existsSync(resolvedDirectory)) continue;
    for (const file of fs.readdirSync(resolvedDirectory).filter((name) => name.endsWith('.js')).sort()) {
      const absolutePath = path.join(resolvedDirectory, file);
      try {
        const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);
        const trustedDirectory = trustedDirectories.some((directory) => absolutePath === directory || absolutePath.startsWith(`${directory}${path.sep}`));
        const trusted = trustedDirectory || trustedHashes.has(fingerprint);
        const approved = persisted.approvals[fingerprint]?.approved === true;
        if (!trusted && !approved) {
          const pendingId = `pending-${fingerprint.slice(0, 16)}`;
          const record = pluginRecord(pendingId, false); record.enabled = false;
          loaded.push({ id: pendingId, name: path.basename(file, '.js'), version: 'Aguardando aprovação', description: 'Plugin externo bloqueado antes da execução. Confira a origem e a impressão SHA-256 para aprová-lo.', icon: '', schema: [], plugin: null, pending: true, trusted: false, fingerprint, fileName: file });
          addLog('plugin', `[${file}] externo bloqueado; aguardando aprovação SHA-256 ${fingerprint.slice(0, 12)}…`);
          continue;
        }
        delete require.cache[require.resolve(absolutePath)];
        const plugin = require(absolutePath);
        if (!plugin || typeof plugin !== 'object' || !/^[a-z0-9-]{2,40}$/i.test(plugin.id) || typeof plugin.onTextMessage !== 'function') throw new Error('plugin precisa exportar id e onTextMessage(contexto)');
        if (seenIds.has(plugin.id)) { addLog('plugin', `[${plugin.id}] ignorado: existe outro plugin com este id`); continue; }
        seenIds.add(plugin.id);
        const schema = normalizeSchema(plugin);
        const record = pluginRecord(plugin.id);
        for (const field of schema) record.settings[field.key] = settingValue(field, record.settings[field.key]);
        loaded.push({ id: plugin.id, name: safeText(plugin.name || plugin.id, 48), version: safeText(plugin.version || 'beta', 24), description: safeText(plugin.description || '', 140), icon: safeIcon(plugin.icon), schema, plugin, pending: false, trusted, fingerprint, fileName: file });
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
        avatar: safeIcon(options.avatarSetting || record.settings.botAvatar || options.avatar || entry.icon),
        pluginId: entry.id
      }),
      botCommand: (room, payload = {}) => emitPluginEvent({ room, event: 'music-bot', payload: { ...payload, avatar: safeIcon(payload.avatar || record.settings.botAvatar || entry.icon), pluginId: entry.id }, pluginId: entry.id }),
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
    if (!entry.plugin || entry.pending) return null;
    if (typeof entry.plugin.getAdminState !== 'function') return null;
    try { return clone(entry.plugin.getAdminState({ plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) }), null); }
    catch (error) { addLog('error', `[${entry.id}] painel: ${safeText(error.message, 160)}`); return null; }
  };

  async function onTextMessage(event) {
    for (const entry of loaded) {
      if (entry.pending || !entry.plugin || !pluginRecord(entry.id).enabled) continue;
      try {
        await entry.plugin.onTextMessage({ ...event, plugin: { id: entry.id, name: entry.name, icon: entry.icon }, api: entryApi(entry) });
      } catch (error) { addLog('error', `[${entry.id}] ${safeText(error.message, 180)}`); }
    }
  }
  async function configure(id, next = {}) {
    const entry = loaded.find((item) => item.id === id);
    if (!entry) return { ok: false, message: 'Plugin não encontrado.' };
    if (entry.pending) {
      if (next.enabled !== true || String(next.approveFingerprint || '') !== entry.fingerprint) return { ok: false, message: 'A aprovação do arquivo externo foi cancelada ou não corresponde ao SHA-256 exibido.' };
      persisted.approvals[entry.fingerprint] = { approved: true, fileName: entry.fileName, approvedAt: new Date().toISOString() };
      persist();
      addLog('plugin', `[${entry.fileName}] aprovado explicitamente com SHA-256 ${entry.fingerprint}`);
      return { ok: true, requiresReload: true, message: `${entry.name} foi aprovado. Recarregue os plugins para iniciar esse arquivo.`, plugin: describe(entry) };
    }
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
    if (!entry || entry.pending || !entry.plugin || typeof entry.plugin.onAdminAction !== 'function') return { ok: false, message: 'Este plugin não possui ações administrativas.' };
    try {
      const result = await entry.plugin.onAdminAction({ action: safeText(actionName, 40), payload: clone(payload, {}), plugin: { id: entry.id, name: entry.name }, api: entryApi(entry) });
      return { ok: result?.ok !== false, message: safeText(result?.message || 'Alteração salva.', 180), plugin: describe(entry) };
    } catch (error) { return { ok: false, message: safeText(error.message || 'Falha na ação do plugin.', 180) }; }
  }
  function describe(entry) {
    const record = pluginRecord(entry.id, !entry.pending);
    return { id: entry.id, name: entry.name, version: entry.version, description: entry.description, icon: entry.icon, enabled: entry.pending ? false : record.enabled, schema: clone(entry.schema, []), settings: clone(record.settings, {}), adminState: adminState(entry), trusted: entry.trusted === true, external: entry.trusted !== true, requiresApproval: entry.pending === true, fingerprint: entry.fingerprint || '', fileName: entry.fileName || '' };
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
