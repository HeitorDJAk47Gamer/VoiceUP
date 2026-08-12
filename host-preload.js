const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceupServer', {
  info: () => ipcRenderer.invoke('server-info'),
  stats: () => ipcRenderer.invoke('server-stats'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download')
});

window.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('.wrap');
  if (!root) return;
  const section = document.createElement('section');
  section.className = 'section';
  section.innerHTML = '<div class="toolbar"><h2>Atualizacoes</h2><button id="check-update" style="margin-left:auto;background:#6676ea;color:#fff;border:0;border-radius:8px;padding:8px 11px;font-weight:600;cursor:pointer">Procurar atualizacoes</button></div><div id="update-status" class="note">Consulte as Releases oficiais do GitHub.</div>';
  root.querySelector('.grid')?.before(section);
  const pluginSection = document.createElement('section');
  pluginSection.className = 'section';
  pluginSection.innerHTML = '<h2>Plugins e músicas do servidor (beta)</h2><div id="plugin-list" class="note">Carregando plugins...</div><div id="plugin-folder" class="url" style="margin-top:10px"></div><div id="music-folder" class="url" style="margin-top:8px"></div><p class="note">Adicione arquivos .js em plugins e MP3/OGG/WAV/M4A/AAC em music. Reinicie o Server Host após alterar arquivos. Instale somente plugins confiáveis.</p>';
  root.querySelector('.section:last-child')?.before(pluginSection);
  const pluginList = pluginSection.querySelector('#plugin-list');
  const pluginFolder = pluginSection.querySelector('#plugin-folder');
  const musicFolder = pluginSection.querySelector('#music-folder');
  ipcRenderer.invoke('server-info').then((info) => { pluginFolder.textContent = `Plugins: ${info.pluginFolder || 'indisponível'}`; musicFolder.textContent = `Músicas: ${info.musicFolder || 'indisponível'}`; });
  const renderPlugins = (stats) => {
    const plugins = stats.plugins || [];
    pluginList.innerHTML = plugins.length ? plugins.map((plugin) => `<div style="margin:7px 0"><b style="color:#56e2cf">${plugin.name}</b> <span style="color:#99a6bc">${plugin.version}</span><br><span>${plugin.description || plugin.id}</span></div>`).join('') : 'Nenhum plugin carregado.';
  };
  setInterval(() => ipcRenderer.invoke('server-stats').then(renderPlugins), 1500);
  ipcRenderer.invoke('server-stats').then(renderPlugins);
  let pendingUpdate = null;
  const button = section.querySelector('#check-update');
  const status = section.querySelector('#update-status');
  button.addEventListener('click', async () => {
    if (pendingUpdate) {
      if (!window.confirm(`Baixar e abrir o instalador VoiceUP Server ${pendingUpdate.version}?`)) return;
      button.disabled = true;
      status.textContent = 'Baixando o instalador...';
      const download = await ipcRenderer.invoke('update:download');
      status.textContent = download.ok ? 'Instalador aberto. Siga os passos para atualizar.' : download.message;
      if (!download.ok) button.disabled = false;
      return;
    }
    button.disabled = true;
    status.textContent = 'Consultando a ultima release no GitHub...';
    const result = await ipcRenderer.invoke('update:check');
    button.disabled = false;
    if (!result.ok) { status.textContent = result.message; return; }
    if (!result.available) { status.textContent = `Voce ja esta na versao mais recente (${result.installedVersion}).`; return; }
    pendingUpdate = result;
    status.textContent = `A versao ${result.version} esta pronta para baixar.`;
    button.textContent = `Baixar ${result.version}`;
  });
});
