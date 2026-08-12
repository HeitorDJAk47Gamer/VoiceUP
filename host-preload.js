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
