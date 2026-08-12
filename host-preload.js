const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceupServer', {
  info: () => ipcRenderer.invoke('server-info'),
  stats: () => ipcRenderer.invoke('server-stats'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  moderate: (action, id) => ipcRenderer.invoke('server:moderate', { action, id }),
  unban: (clientId) => ipcRenderer.invoke('server:unban', clientId),
  control: (action) => ipcRenderer.invoke('server:control', action),
  settings: () => ipcRenderer.invoke('server:settings'),
  saveSettings: (settings) => ipcRenderer.invoke('server:save-settings', settings)
});

window.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('.wrap');
  if (!root) return;
  const control = document.createElement('section');
  control.className = 'section';
  control.innerHTML = `<div class="toolbar"><h2>Controle do servidor</h2><span id="host-state" class="note" style="margin-left:auto">Carregando...</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button data-server-control="start" style="background:#56e2cf;color:#102026;border:0;border-radius:8px;padding:8px 11px;font-weight:700">Iniciar</button><button data-server-control="restart" style="background:#6676ea;color:#fff;border:0;border-radius:8px;padding:8px 11px;font-weight:700">Reiniciar</button><button data-server-control="stop" style="background:#553344;color:#ffd5dd;border:0;border-radius:8px;padding:8px 11px;font-weight:700">Desligar sem fechar painel</button></div>
    <label style="display:grid;gap:6px;max-width:340px;margin-top:16px;font-size:12px;color:#b9c6d9">Ao clicar no X do programa<select id="host-close-behavior" style="background:#101625;color:#e8edf8;border:1px solid #40506c;border-radius:7px;padding:8px"><option value="tray">Manter ativo na bandeja do Windows</option><option value="ask">Perguntar o que fazer</option><option value="quit">Encerrar o programa</option></select></label><small id="host-control-message" class="note"></small>`;
  root.querySelector('.grid')?.after(control);

  const moderation = document.createElement('section');
  moderation.className = 'section';
  moderation.innerHTML = '<h2>Moderação</h2><div id="member-list" class="logs" style="height:auto;max-height:220px">Carregando participantes...</div><h2 style="margin-top:18px">Banimentos</h2><div id="ban-list" class="logs" style="height:auto;max-height:150px">Nenhum banimento.</div><p class="note">Expulsar desconecta a pessoa da sala. Banir bloqueia o identificador salvo no Client até você remover o banimento.</p>';
  root.querySelector('.section:last-child')?.before(moderation);

  const updateSection = document.createElement('section');
  updateSection.className = 'section';
  updateSection.innerHTML = '<div class="toolbar"><h2>Atualizações</h2><button id="check-update" style="margin-left:auto;background:#6676ea;color:#fff;border:0;border-radius:8px;padding:8px 11px;font-weight:600;cursor:pointer">Procurar atualizações</button></div><div id="update-status" class="note">Consulte as Releases oficiais do GitHub.</div>';
  root.querySelector('.grid')?.before(updateSection);

  const pluginSection = document.createElement('section');
  pluginSection.className = 'section';
  pluginSection.innerHTML = '<h2>Plugins e músicas do servidor (beta)</h2><div id="plugin-list" class="note">Carregando plugins...</div><div id="plugin-folder" class="url" style="margin-top:10px"></div><div id="music-folder" class="url" style="margin-top:8px"></div><p class="note">Adicione arquivos .js em plugins e MP3/OGG/WAV/M4A/AAC em music. Reinicie o Server Host após alterar arquivos. Instale somente plugins confiáveis.</p>';
  root.querySelector('.section:last-child')?.before(pluginSection);

  const message = (text) => { control.querySelector('#host-control-message').textContent = text || ''; };
  const renderPlugins = (stats) => { const plugins = stats.plugins || []; pluginSection.querySelector('#plugin-list').innerHTML = plugins.length ? plugins.map((plugin) => `<div style="margin:7px 0"><b style="color:#56e2cf">${plugin.name}</b> <span style="color:#99a6bc">${plugin.version}</span><br><span>${plugin.description || plugin.id}</span></div>`).join('') : 'Nenhum plugin carregado.'; };
  const renderMembers = (stats) => {
    const members = stats.members || [];
    moderation.querySelector('#member-list').innerHTML = members.length ? members.map((member) => `<div class="log" style="align-items:center;border-bottom:1px solid #29354a;padding:8px 0"><span style="width:10px;height:10px;border-radius:50%;background:${member.color};display:inline-block;flex:none"></span><span style="flex:1"><b style="color:#e8edf8">${member.name}</b><br><small style="color:#8fa0b7">${member.room} · ${member.voiceChannel} · ${member.connectedSeconds}s</small></span>${member.isBot ? '<small>Bot</small>' : `<button data-moderate="kick" data-member="${member.id}" style="background:#433243;color:#ffd3dd;border:0;border-radius:7px;padding:6px 8px">Expulsar</button><button data-moderate="ban" data-member="${member.id}" style="background:#6b2e3c;color:#fff;border:0;border-radius:7px;padding:6px 8px">Banir</button>`}</div>`).join('') : '<span>Nenhum participante conectado.</span>';
    moderation.querySelector('#ban-list').innerHTML = (stats.bans || []).length ? stats.bans.map((ban) => `<div class="log" style="align-items:center;padding:6px 0"><span style="flex:1"><b>${ban.name || 'Visitante'}</b><br><small>${ban.bannedAt || ''}</small></span><button data-unban="${ban.clientId}" style="background:#275c62;color:#d9fff8;border:0;border-radius:7px;padding:6px 8px">Remover ban</button></div>`).join('') : '<span>Nenhum banimento.</span>';
    moderation.querySelectorAll('[data-moderate]').forEach((button) => button.addEventListener('click', async () => { const action = button.dataset.moderate; if (!window.confirm(`${action === 'ban' ? 'Banir' : 'Expulsar'} este participante?`)) return; const result = await window.voiceupServer.moderate(action, button.dataset.member); message(result.message); }));
    moderation.querySelectorAll('[data-unban]').forEach((button) => button.addEventListener('click', async () => { const result = await window.voiceupServer.unban(button.dataset.unban); message(result.message); }));
  };
  control.querySelectorAll('[data-server-control]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; const result = await window.voiceupServer.control(button.dataset.serverControl); message(result.message); button.disabled = false; }));
  const closeSelect = control.querySelector('#host-close-behavior');
  window.voiceupServer.settings().then((settings) => { closeSelect.value = settings.closeBehavior || 'tray'; });
  closeSelect.addEventListener('change', async () => { await window.voiceupServer.saveSettings({ closeBehavior: closeSelect.value }); message('Preferência de fechamento salva.'); });
  window.voiceupServer.info().then((info) => { pluginSection.querySelector('#plugin-folder').textContent = `Plugins: ${info.pluginFolder || 'indisponível'}`; pluginSection.querySelector('#music-folder').textContent = `Músicas: ${info.musicFolder || 'indisponível'}`; });
  const poll = async () => { const stats = await window.voiceupServer.stats(); renderPlugins(stats); renderMembers(stats); control.querySelector('#host-state').textContent = stats.online ? '● Online' : '● Desligado'; control.querySelector('#host-state').style.color = stats.online ? '#56e2cf' : '#ff8b72'; };
  poll(); setInterval(poll, 1500);
  let pendingUpdate = null;
  const updateButton = updateSection.querySelector('#check-update'); const updateStatus = updateSection.querySelector('#update-status');
  updateButton.addEventListener('click', async () => {
    if (pendingUpdate) { if (!window.confirm(`Baixar e abrir o instalador VoiceUP Server ${pendingUpdate.version}?`)) return; updateButton.disabled = true; updateStatus.textContent = 'Baixando o instalador...'; const download = await window.voiceupServer.downloadUpdate(); updateStatus.textContent = download.ok ? 'Instalador aberto. Siga os passos para atualizar.' : download.message; if (!download.ok) updateButton.disabled = false; return; }
    updateButton.disabled = true; updateStatus.textContent = 'Consultando a última release no GitHub...'; const result = await window.voiceupServer.checkForUpdates(); updateButton.disabled = false;
    if (!result.ok) { updateStatus.textContent = result.message; return; } if (!result.available) { updateStatus.textContent = `Você já está na versão mais recente (${result.installedVersion}).`; return; }
    pendingUpdate = result; updateStatus.textContent = `A versão ${result.version} está pronta para baixar.`; updateButton.textContent = `Baixar ${result.version}`;
  });
});
