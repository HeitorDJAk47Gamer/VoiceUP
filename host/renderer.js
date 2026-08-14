(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[letter]));
  const history = [];
  const pageNames = { overview: 'Visão geral', people: 'Pessoas', rooms: 'Salas e canais', extensions: 'Plugins', activity: 'Atividade', settings: 'Configurações' };
  let latestStats = {};
  let noticeTimer;
  let pendingUpdate = null;
  let automaticUpdatePrompted = '';
  let pluginSnapshotKey = '';
  let dialogResolve = null;
  let settingsSaveTimer = null;
  let managedRooms = [];
  let roomSnapshotKey = '';

  const formatTime = (seconds) => {
    const value = Number(seconds || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return minutes ? `${minutes}m ${value % 60}s` : `${value}s`;
  };
  const initials = (name) => String(name || 'V').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  const imageData = (file) => new Promise((resolve, reject) => {
    if (!file || !/^image\/(?:png|webp|jpeg)$/i.test(file.type)) return reject(new Error('Escolha uma imagem PNG, WEBP ou JPG.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const image = new Image(); image.onerror = () => reject(new Error('Imagem inválida.'));
      image.onload = () => {
        const size = 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d'); const scale = Math.max(size / image.width, size / image.height); const width = image.width * scale; const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const value = canvas.toDataURL('image/webp', .78); value.length <= 60000 ? resolve(value) : reject(new Error('A imagem ainda ficou grande demais. Escolha outra foto.'));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  const showNotice = (message, type = 'success') => {
    if (!message) return;
    clearTimeout(noticeTimer);
    $('notice').textContent = String(message);
    $('notice').className = `notice ${type}`;
    noticeTimer = setTimeout(() => $('notice').classList.add('hidden'), 4200);
  };
  const closeDialog = (value = 'cancel') => {
    const modal = $('app-dialog'); if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden'); const resolve = dialogResolve; dialogResolve = null; resolve?.(value);
  };
  const showDialog = ({ title = 'Confirmar ação', message = '', detail = '', tone = 'normal', icon = '?', actions = [], wide = false } = {}) => new Promise((resolve) => {
    if (dialogResolve) closeDialog('cancel');
    dialogResolve = resolve; const modal = $('app-dialog');
    modal.classList.toggle('wide', wide);
    modal.classList.toggle('danger', tone === 'danger'); $('app-dialog-title').textContent = title; $('app-dialog-message').textContent = message; $('app-dialog-detail').textContent = detail; $('app-dialog-detail').classList.toggle('hidden', !detail); modal.querySelector('.app-dialog-icon').textContent = icon;
    const choices = actions.length ? actions : [{ value: 'ok', label: 'Confirmar', style: 'primary' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }];
    $('app-dialog-actions').innerHTML = choices.map((action) => `<button type="button" class="button ${escapeHtml(action.style || 'secondary')}" data-dialog-value="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`).join('');
    $('app-dialog-actions').querySelectorAll('[data-dialog-value]').forEach((button) => { button.onclick = () => closeDialog(button.dataset.dialogValue); });
    modal.classList.remove('hidden'); requestAnimationFrame(() => $('app-dialog-actions').querySelector('[data-dialog-value]')?.focus());
  });
  const showServerReleaseNotes = (version) => showDialog({
    title: `Novidades da versão ${version}`,
    message: 'A maior evolução desta versão foi a nova experiência visual do ServerHost e do Client.',
    detail: [
      'VISUAL',
      '• Painel completamente redesenhado, responsivo e organizado por navegação lateral.',
      '• Temas Oceano, Violeta, Floresta e Grafite, modais próprios e barras modernas.',
      '',
      'PAINEL E ADMINISTRAÇÃO',
      '• Dashboard com CPU, memória, ping, participantes, sinais, gráficos e logs em tempo real.',
      '• Pessoas conectadas, expulsão, banimento, remoção de ban e mensagens correspondentes no Client.',
      '• Reinício, desligamento sem fechar a janela, bandeja do Windows e comportamento configurável ao fechar.',
      '• Fotos de perfil dos participantes exibidas corretamente no painel de moderação.',
      '• Criação e gestão de códigos de sala, canais de voz e canais de texto com sincronização ao vivo.',
      '• Cluster experimental primário/secundário para dividir sinalização, sincronizar presença, chat e negociações WebRTC.',
      '',
      'PLUGINS',
      '• Gestão visual, ativação por chave, configurações persistentes e avatares dos bots.',
      '• Dados RPG, até três Music Bots e XP com ranking Top 5 e pontuação configurável.',
      '• API beta documentada, exemplo para desenvolvedores e catálogo público com downloads.',
      '',
      'CLIENT, CLOUD E DISTRIBUIÇÃO',
      '• Nova interface de chamadas, chat, temas, lives, GIFs, formatação e qualidade original.',
      '• Site oficial, status, plugins, privacidade, termos e pacote Cloud atualizado.',
      '• Atualizador, instaladores Client/ServerHost e compatibilidade progressiva.',
      '• Client e ServerHost agora procuram atualizações automaticamente ao abrir.'
    ].join('\n'),
    icon: '✦',
    wide: true,
    actions: [{ value: 'ok', label: 'Entendi', style: 'primary' }]
  });
  const refreshServerUpdateControls = () => {
    const button = $('check-update');
    if (pendingUpdate) {
      $('update-status').textContent = `A versão ${pendingUpdate.version} está disponível.`;
      button.textContent = `Baixar ${pendingUpdate.version}`;
    } else {
      $('update-status').textContent = 'As atualizações são consultadas automaticamente nas Releases oficiais do GitHub.';
      button.textContent = 'Procurar atualizações';
    }
  };
  const downloadPendingServerUpdate = async () => {
    if (!pendingUpdate) return;
    const button = $('check-update');
    button.disabled = true;
    $('update-status').textContent = 'Baixando o instalador…';
    const result = await window.voiceupServer.downloadUpdate();
    $('update-status').textContent = result.ok ? 'Instalador aberto.' : result.message;
    button.disabled = !result.ok;
  };
  const confirmPendingServerUpdate = async () => {
    if (!pendingUpdate) return;
    const accepted = await showDialog({ title: 'Atualização disponível', message: `Baixar o VoiceUP Server ${pendingUpdate.version}?`, detail: 'O instalador será aberto quando o download terminar.', icon: '↓', actions: [{ value: 'confirm', label: 'Baixar', style: 'primary' }, { value: 'cancel', label: 'Agora não', style: 'secondary' }] });
    if (accepted === 'confirm') await downloadPendingServerUpdate();
  };
  const promptAutomaticServerUpdate = (result) => {
    const waitUntilInterfaceIsFree = () => {
      if (!pendingUpdate || pendingUpdate.version !== result.version || automaticUpdatePrompted === result.version) return;
      if (!$('app-dialog').classList.contains('hidden')) { window.setTimeout(waitUntilInterfaceIsFree, 500); return; }
      automaticUpdatePrompted = result.version;
      void confirmPendingServerUpdate();
    };
    window.setTimeout(waitUntilInterfaceIsFree, 300);
  };
  const checkServerUpdates = async ({ automatic = false } = {}) => {
    const button = $('check-update');
    button.disabled = true;
    if (!automatic) $('update-status').textContent = 'Consultando o GitHub…';
    const result = await window.voiceupServer.checkForUpdates();
    button.disabled = false;
    if (!result.ok) {
      if (!automatic) $('update-status').textContent = result.message;
      return result;
    }
    if (!result.available) {
      if (!automatic) $('update-status').textContent = `Você já está na versão atual (${result.installedVersion}).`;
      return result;
    }
    pendingUpdate = result;
    refreshServerUpdateControls();
    if (automatic) promptAutomaticServerUpdate(result);
    return result;
  };
  const setTheme = (theme) => {
    const allowed = ['ocean', 'violet', 'forest', 'graphite'];
    document.body.dataset.theme = allowed.includes(theme) ? theme : 'ocean';
  };
  const switchPage = (page) => {
    const target = pageNames[page] ? page : 'overview';
    document.querySelectorAll('[data-page]').forEach((element) => element.classList.toggle('active', element.dataset.page === target));
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === target));
    $('page-title').textContent = pageNames[target];
    document.body.classList.remove('menu-open');
    if (target === 'activity') requestAnimationFrame(drawChart);
  };

  function drawChart() {
    const canvas = $('chart');
    const context = canvas?.getContext('2d');
    if (!context || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const key = $('metric-select').value;
    const values = history.map((item) => Number(item[key] || 0));
    const max = Math.max(1, ...values);
    const style = getComputedStyle(document.body);
    const line = style.getPropertyValue('--line').trim();
    const accent = style.getPropertyValue('--accent').trim();
    context.strokeStyle = line;
    context.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const y = height * index / 5;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    if (values.length > 1) {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `${accent}44`); gradient.addColorStop(1, `${accent}00`);
      context.beginPath();
      values.forEach((value, index) => {
        const x = index * width / (values.length - 1);
        const y = height - 14 - (value / max) * (height - 28);
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      });
      context.lineTo(width, height); context.lineTo(0, height); context.closePath(); context.fillStyle = gradient; context.fill();
      context.beginPath();
      values.forEach((value, index) => {
        const x = index * width / (values.length - 1);
        const y = height - 14 - (value / max) * (height - 28);
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      });
      context.strokeStyle = accent; context.lineWidth = 2; context.stroke();
    }
    $('chart-current').textContent = `${values.at(-1) || 0}`;
  }

  function renderMembers(stats) {
    const members = Array.isArray(stats.members) ? stats.members : [];
    const countText = `${members.length} conectado${members.length === 1 ? '' : 's'}`;
    $('member-count').textContent = countText;
    $('nav-member-count').textContent = members.length;
    $('member-list').innerHTML = members.length ? members.map((member) => {
      const avatar = member.avatar ? `<img src="${escapeHtml(member.avatar)}" alt="">` : escapeHtml(initials(member.name));
      const channel = member.voiceChannel === '__lobby__' || !member.voiceChannel ? 'fora da call' : member.voiceChannel;
      return `<div class="member"><span class="member-avatar" style="--member-color:${escapeHtml(member.color || '#56e2cf')}">${avatar}</span><span class="member-info"><b>${escapeHtml(member.name || 'Visitante')}${member.isBot ? ' · Bot' : ''}</b><small>Sala ${escapeHtml(member.room || '—')} · ${escapeHtml(channel)} · ${formatTime(member.connectedSeconds)}${member.remote ? ' · outro host' : ''}</small></span>${member.isBot || member.remote ? '' : `<span class="member-actions"><button class="button secondary" data-moderate="kick" data-member="${escapeHtml(member.id)}">Expulsar</button><button class="button danger" data-moderate="ban" data-member="${escapeHtml(member.id)}">Banir</button></span>`}</div>`;
    }).join('') : '<div class="empty">Nenhum participante conectado.</div>';
    const bans = Array.isArray(stats.bans) ? stats.bans : [];
    $('ban-list').innerHTML = bans.length ? bans.map((ban) => `<div class="member"><span class="member-avatar">!</span><span class="member-info"><b>${escapeHtml(ban.name || 'Visitante')}</b><small>${escapeHtml(new Date(ban.bannedAt).toLocaleString('pt-BR'))}</small></span><span class="member-actions"><button class="button secondary" data-unban="${escapeHtml(ban.clientId)}">Remover ban</button></span></div>`).join('') : '<div class="empty">Nenhum banimento ativo.</div>';
    document.querySelectorAll('[data-moderate]').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.moderate;
        const accepted = await showDialog({ title: action === 'ban' ? 'Banir participante' : 'Expulsar participante', message: action === 'ban' ? 'Esta pessoa perderá o acesso até que o banimento seja removido.' : 'Esta pessoa será removida do servidor agora.', detail: action === 'ban' ? 'O bloqueio usa a identidade persistente do Client, não apenas o nome.' : 'Ela poderá entrar novamente depois.', tone: 'danger', icon: action === 'ban' ? '!' : '×', actions: [{ value: 'confirm', label: action === 'ban' ? 'Banir' : 'Expulsar', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
        if (accepted !== 'confirm') return;
        button.disabled = true;
        const result = await window.voiceupServer.moderate(action, button.dataset.member);
        showNotice(result.message, result.ok ? 'success' : 'error');
        button.disabled = false;
        refresh();
      };
    });
    document.querySelectorAll('[data-unban]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        const result = await window.voiceupServer.unban(button.dataset.unban);
        showNotice(result.message, result.ok ? 'success' : 'error');
        button.disabled = false;
        refresh();
      };
    });
  }

  const parseChannels = (value) => [...new Set(String(value || '').split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 24);
  const clearRoomForm = () => {
    $('room-previous-id').value = '';
    $('room-name').value = '';
    $('room-id').value = '';
    $('room-voice-channels').value = 'Geral\nJogando\nAusente';
    $('room-text-channels').value = 'geral\nconversa\navisos';
    $('room-editor-title').textContent = 'Criar sala';
    $('room-name').focus();
  };
  const fillRoomForm = (room) => {
    $('room-previous-id').value = room.id || '';
    $('room-name').value = room.name || '';
    $('room-id').value = room.id || '';
    $('room-voice-channels').value = (room.voiceChannels || []).join('\n');
    $('room-text-channels').value = (room.textChannels || []).join('\n');
    $('room-editor-title').textContent = `Editar ${room.name || room.id}`;
    document.querySelector('[data-page="rooms"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const renderRooms = (rooms = managedRooms) => {
    managedRooms = Array.isArray(rooms) ? rooms : [];
    $('managed-room-count').textContent = `${managedRooms.length} sala${managedRooms.length === 1 ? '' : 's'}`;
    $('nav-room-count').textContent = managedRooms.length;
    $('room-list').innerHTML = managedRooms.length ? managedRooms.map((room) => `<article class="managed-room" data-room-id="${escapeHtml(room.id)}"><header><span><strong>${escapeHtml(room.name || room.id)}</strong><code>${escapeHtml(room.id)}</code></span><span class="managed-room-actions"><button class="button secondary" type="button" data-edit-room="${escapeHtml(room.id)}">Editar</button><button class="button danger" type="button" data-delete-room="${escapeHtml(room.id)}">Excluir</button></span></header><div><span><b>Voz</b>${(room.voiceChannels || []).map((channel) => `<i>◖ ${escapeHtml(channel)}</i>`).join('')}</span><span><b>Texto</b>${(room.textChannels || []).map((channel) => `<i># ${escapeHtml(channel)}</i>`).join('')}</span></div></article>`).join('') : '<div class="empty">Nenhuma sala gerenciada. Códigos livres ainda usam os canais padrão.</div>';
    document.querySelectorAll('[data-edit-room]').forEach((button) => { button.onclick = () => { const room = managedRooms.find((item) => item.id === button.dataset.editRoom); if (room) fillRoomForm(room); }; });
    document.querySelectorAll('[data-delete-room]').forEach((button) => {
      button.onclick = async () => {
        const room = managedRooms.find((item) => item.id === button.dataset.deleteRoom);
        const accepted = await showDialog({ title: 'Excluir sala gerenciada', message: `Remover ${room?.name || button.dataset.deleteRoom}?`, detail: 'Pessoas já conectadas não serão expulsas. Esse código voltará a usar os canais padrão por compatibilidade.', tone: 'danger', icon: '×', actions: [{ value: 'confirm', label: 'Excluir', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
        if (accepted !== 'confirm') return;
        const result = await window.voiceupServer.deleteRoom(button.dataset.deleteRoom);
        showNotice(result.message, result.ok ? 'success' : 'error');
        if (result.ok) { renderRooms(result.rooms); clearRoomForm(); }
      };
    });
  };

  function renderPlugins(stats) {
    const plugins = Array.isArray(stats.plugins) ? stats.plugins : [];
    const activeCount = plugins.filter((plugin) => plugin.enabled !== false).length;
    $('plugin-count').textContent = `${activeCount} ativo${activeCount === 1 ? '' : 's'}`;
    const snapshot = JSON.stringify(plugins);
    if (snapshot !== pluginSnapshotKey) {
      pluginSnapshotKey = snapshot;
      $('plugin-list').innerHTML = plugins.length ? plugins.map((plugin) => {
        const icon = plugin.icon ? `<img src="${escapeHtml(plugin.icon)}" alt="">` : `<span>${escapeHtml(initials(plugin.name || plugin.id))}</span>`;
        const fields = (plugin.schema || []).map((field) => {
          const value = plugin.settings?.[field.key] ?? field.default ?? '';
          let control = '';
          if (field.type === 'boolean') control = `<label class="plugin-toggle compact-toggle"><input type="checkbox" data-plugin-setting="${escapeHtml(field.key)}"${value ? ' checked' : ''}><i></i></label>`;
          else if (field.type === 'image') control = `<span class="plugin-avatar-editor"><span class="plugin-avatar-preview">${value ? `<img src="${escapeHtml(value)}" alt="">` : icon}</span><span><input type="file" accept="image/png,image/webp,image/jpeg" data-plugin-image-picker><input type="hidden" data-plugin-setting="${escapeHtml(field.key)}" value="${escapeHtml(value)}"><button class="button secondary" type="button" data-plugin-image-clear>Usar padrão</button></span></span>`;
          else if (field.type === 'select') control = `<select data-plugin-setting="${escapeHtml(field.key)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option.value)}"${String(value) === String(option.value) ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
          else control = `<input data-plugin-setting="${escapeHtml(field.key)}" type="${field.type === 'range' ? 'range' : field.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}"${field.min != null ? ` min="${field.min}"` : ''}${field.max != null ? ` max="${field.max}"` : ''}${field.step != null ? ` step="${field.step}"` : ''}><output>${field.type === 'range' ? escapeHtml(value) : ''}</output>`;
          return `<label class="plugin-setting"><span><b>${escapeHtml(field.label)}</b><small>${escapeHtml(field.description || '')}</small></span><span class="plugin-setting-control">${control}</span></label>`;
        }).join('');
        const xpUsers = plugin.adminState?.type === 'xp-ranking' ? (plugin.adminState.users || []) : [];
        const admin = xpUsers.length ? `<section class="plugin-admin"><h4>Pontuação por participante</h4>${xpUsers.map((user) => `<div class="xp-user"><span><b>${escapeHtml(user.name)}</b><small>Sala ${escapeHtml(user.room)} · Nv. ${Number(user.level || 1)} · ${Number(user.totalXp || 0)} XP</small></span><input type="number" min="0" step="1" value="${Number(user.totalXp || 0)}"><button class="button secondary" data-xp-save data-plugin="${escapeHtml(plugin.id)}" data-room="${escapeHtml(user.room)}" data-user="${escapeHtml(user.id)}">Salvar XP</button></div>`).join('')}</section>` : '';
        return `<article class="plugin plugin-card${plugin.enabled === false ? ' disabled' : ''}" data-plugin-card="${escapeHtml(plugin.id)}"><header><span class="plugin-icon">${icon}</span><span class="plugin-title"><strong>${escapeHtml(plugin.name || plugin.id)}</strong><small>${escapeHtml(plugin.version || 'beta')}</small><p>${escapeHtml(plugin.description || plugin.id)}</p></span><label class="plugin-toggle" title="Habilitar ou desabilitar"><input type="checkbox" data-plugin-enabled${plugin.enabled !== false ? ' checked' : ''}><i></i></label></header><details><summary>Editar opções</summary><div class="plugin-options">${fields || '<p class="helper">Este plugin não possui opções editáveis.</p>'}${admin}<div class="plugin-save-row"><button class="button primary" data-plugin-save="${escapeHtml(plugin.id)}">Salvar opções</button></div></div></details></article>`;
      }).join('') : '<div class="empty">Nenhum plugin carregado. Copie arquivos .js para a pasta e recarregue.</div>';
      document.querySelectorAll('[data-plugin-setting][type="range"]').forEach((input) => { input.oninput = () => { input.nextElementSibling.textContent = input.value; }; });
      document.querySelectorAll('[data-plugin-image-picker]').forEach((input) => {
        input.onchange = async () => {
          try { const value = await imageData(input.files?.[0]); const editor = input.closest('.plugin-avatar-editor'); editor.querySelector('[data-plugin-setting]').value = value; editor.querySelector('.plugin-avatar-preview').innerHTML = `<img src="${escapeHtml(value)}" alt="">`; }
          catch (error) { showNotice(error.message, 'error'); input.value = ''; }
        };
      });
      document.querySelectorAll('[data-plugin-image-clear]').forEach((button) => { button.onclick = () => { const editor = button.closest('.plugin-avatar-editor'); editor.querySelector('[data-plugin-setting]').value = ''; editor.querySelector('.plugin-avatar-preview').innerHTML = '<span>—</span>'; }; });
      document.querySelectorAll('[data-plugin-save]').forEach((button) => { button.onclick = () => savePluginCard(button.closest('[data-plugin-card]')); });
      document.querySelectorAll('[data-plugin-enabled]').forEach((toggle) => { toggle.onchange = () => savePluginCard(toggle.closest('[data-plugin-card]')); });
      document.querySelectorAll('[data-xp-save]').forEach((button) => {
        button.onclick = async () => {
          button.disabled = true; const input = button.previousElementSibling;
          const result = await window.voiceupServer.pluginAction(button.dataset.plugin, 'set-xp', { room: button.dataset.room, id: button.dataset.user, totalXp: Number(input.value) });
          showNotice(result.message, result.ok ? 'success' : 'error'); button.disabled = false; pluginSnapshotKey = ''; refresh();
        };
      });
    }
    const errors = Array.isArray(stats.pluginErrors) ? stats.pluginErrors : [];
    $('plugin-errors').textContent = errors.length ? `Erros encontrados: ${errors.join(' | ')}` : '';
    $('plugin-errors').classList.toggle('hidden', !errors.length);
  }

  async function savePluginCard(card) {
    if (!card) return;
    const id = card.dataset.pluginCard; const settings = {};
    card.querySelectorAll('[data-plugin-setting]').forEach((field) => { settings[field.dataset.pluginSetting] = field.type === 'checkbox' ? field.checked : field.type === 'number' || field.type === 'range' ? Number(field.value) : field.value; });
    const button = card.querySelector('[data-plugin-save]'); if (button) button.disabled = true;
    const result = await window.voiceupServer.configurePlugin(id, { enabled: card.querySelector('[data-plugin-enabled]')?.checked !== false, settings });
    showNotice(result.message, result.ok ? 'success' : 'error'); if (button) button.disabled = false; pluginSnapshotKey = ''; refresh();
  }

  function render(stats) {
    latestStats = stats;
    ['participants', 'rooms'].forEach((key) => { $(key).textContent = Number(stats[key] || 0); });
    const signals = Number(stats.signals ?? stats.events?.signals ?? 0);
    $('ping').textContent = stats.averagePing == null ? '—' : `${stats.averagePing} ms`;
    $('cpu').textContent = `${Number(stats.cpuPercent || 0).toFixed(1).replace('.0', '')}%`;
    $('memory').textContent = `${stats.memoryMb || 0} MB`;
    $('uptime').textContent = formatTime(stats.uptimeSeconds);
    $('signals-summary').textContent = `${signals} sinais`;
    const cluster = stats.cluster || {};
    $('cluster-status').textContent = !cluster.enabled ? 'Desativado' : cluster.state === 'conectado' ? `${cluster.role === 'primary' ? 'Primário' : 'Secundário'} conectado` : `${cluster.role === 'primary' ? 'Primário' : 'Secundário'} · ${cluster.state || 'aguardando'}`;
    $('cluster-status').classList.toggle('cluster-online', cluster.state === 'conectado');
    const runtimeRooms = Array.isArray(stats.roomLayouts) ? stats.roomLayouts : [];
    const runtimeRoomKey = JSON.stringify(runtimeRooms);
    if (runtimeRoomKey !== roomSnapshotKey) { roomSnapshotKey = runtimeRoomKey; renderRooms(runtimeRooms); }
    const roomsReadOnly = cluster.enabled && cluster.role === 'secondary';
    document.querySelector('.room-editor')?.classList.toggle('cluster-readonly', roomsReadOnly);
    ['room-name', 'room-id', 'room-voice-channels', 'room-text-channels', 'save-room', 'clear-room-form'].forEach((id) => { if ($(id)) $(id).disabled = roomsReadOnly; });
    document.querySelectorAll('[data-edit-room],[data-delete-room]').forEach((button) => { button.disabled = roomsReadOnly; });
    if (roomsReadOnly) $('room-editor-title').textContent = 'Estrutura sincronizada pelo host primário';
    const online = Boolean(stats.online);
    document.querySelectorAll('#host-state .status-light, #sidebar-light').forEach((light) => { light.classList.toggle('online', online); light.classList.toggle('offline', !online); });
    $('host-state').querySelector('span:last-child').textContent = online ? 'Online · porta 3000' : 'Servidor desligado';
    $('sidebar-state').textContent = online ? 'Servidor online' : 'Servidor desligado';
    $('sidebar-detail').textContent = online ? `${stats.participants || 0} conexões · porta 3000` : 'Painel ainda disponível';
    $('hero-title').textContent = online ? 'Servidor pronto para conexões' : 'Servidor desligado';
    $('hero-copy').textContent = online ? 'Compartilhe um endereço ou código para receber participantes.' : 'Use Iniciar para aceitar novas conexões sem fechar este painel.';
    const logs = Array.isArray(stats.logs) ? stats.logs : [];
    $('logs').innerHTML = logs.length ? logs.map((log) => `<div class="log"><time>${escapeHtml(log.time || '')}</time><b>${escapeHtml(String(log.level || 'info').toUpperCase())}</b><span>${escapeHtml(log.message || '')}</span></div>`).join('') : '<div class="empty">Nenhum evento ainda.</div>';
    renderMembers(stats);
    renderPlugins(stats);
    history.push({ ...stats, signals });
    if (history.length > 60) history.shift();
    drawChart();
  }

  async function refresh() {
    try { render(await window.voiceupServer.stats()); }
    catch (error) { showNotice(`Falha ao atualizar o painel: ${error.message || 'ponte indisponível'}`, 'error'); }
  }

  async function boot() {
    if (!window.voiceupServer) { showNotice('A ponte do ServerHost não foi carregada. Reinstale esta versão.', 'error'); return; }
    document.querySelectorAll('[data-view]').forEach((button) => { button.onclick = () => switchPage(button.dataset.view); });
    $('mobile-menu').onclick = () => document.body.classList.toggle('menu-open');
    try {
      const info = await window.voiceupServer.info();
      const urls = info.urls?.length ? info.urls : ['http://localhost:3000'];
      $('urls').innerHTML = urls.map((url, index) => `<div class="copy-row"><code id="host-url-${index}">${escapeHtml(url)}</code><button class="icon-button copy-button" type="button" data-copy-target="host-url-${index}" title="Copiar endereço">⧉</button></div>`).join('');
      $('connection-code').textContent = info.connectionCode || '';
      $('plugin-folder').textContent = info.pluginFolder || 'Indisponível';
      $('music-folder').textContent = info.musicFolder || 'Indisponível';
      const serverVersion = info.version || '1.1.0';
      $('app-version').textContent = serverVersion;
      const settings = await window.voiceupServer.settings();
      $('host-close-behavior').value = settings.closeBehavior || 'tray';
      $('host-theme').value = settings.theme || 'ocean';
      setTheme($('host-theme').value);
      renderRooms(await window.voiceupServer.rooms());
      const cluster = await window.voiceupServer.clusterSettings();
      $('cluster-mode').value = cluster.enabled ? cluster.role : 'off';
      $('cluster-primary-url').value = cluster.primaryUrl || '';
      $('cluster-secret').value = cluster.secret || '';
      $('cluster-node-id').value = cluster.nodeId || '';
      $('cluster-primary-row').classList.toggle('hidden', $('cluster-mode').value !== 'secondary');
      if (localStorage.getItem('voiceup-server-release-notes-seen-v1') !== serverVersion) {
        window.setTimeout(async () => {
          await showServerReleaseNotes(serverVersion);
          localStorage.setItem('voiceup-server-release-notes-seen-v1', serverVersion);
        }, 650);
      }
    } catch (error) { showNotice(`Falha ao carregar o ServerHost: ${error.message || 'erro desconhecido'}`, 'error'); }
    document.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-target]');
      if (copyButton) {
        const target = $(copyButton.dataset.copyTarget);
        const value = target?.value || target?.textContent || '';
        try { await navigator.clipboard.writeText(value); showNotice('Copiado para a área de transferência.'); }
        catch { showNotice('Não foi possível copiar automaticamente.', 'error'); }
      }
    });
    document.querySelectorAll('[data-server-control]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try { const result = await window.voiceupServer.control(button.dataset.serverControl); showNotice(result.message, result.ok ? 'success' : 'error'); }
        catch (error) { showNotice(error.message, 'error'); }
        button.disabled = false;
        refresh();
      };
    });
    document.querySelectorAll('[data-open-path]').forEach((button) => {
      button.onclick = async () => {
        const result = await window.voiceupServer.openPath(button.dataset.openPath);
        if (!result.ok) showNotice(result.message, 'error');
      };
    });
    $('reload-plugins').onclick = async () => {
      const accepted = await showDialog({ title: 'Recarregar plugins', message: 'O servidor será reiniciado para aplicar os arquivos dos plugins.', detail: 'Todas as pessoas conectadas serão desconectadas e precisarão entrar novamente.', icon: '↻', actions: [{ value: 'confirm', label: 'Recarregar', style: 'primary' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
      if (accepted !== 'confirm') return;
      $('reload-plugins').disabled = true;
      const result = await window.voiceupServer.control('reload-plugins');
      showNotice(result.message, result.ok ? 'success' : 'error');
      $('reload-plugins').disabled = false;
      refresh();
    };
    $('clear-room-form').onclick = clearRoomForm;
    $('save-room').onclick = async () => {
      const room = {
        previousId: $('room-previous-id').value,
        id: $('room-id').value,
        name: $('room-name').value,
        voiceChannels: parseChannels($('room-voice-channels').value),
        textChannels: parseChannels($('room-text-channels').value)
      };
      if (!room.id.trim() || !room.name.trim()) return showNotice('Informe o nome e o código da sala.', 'error');
      if (!room.voiceChannels.length || !room.textChannels.length) return showNotice('Crie pelo menos um canal de voz e um de texto.', 'error');
      $('save-room').disabled = true;
      const result = await window.voiceupServer.saveRoom(room);
      $('save-room').disabled = false;
      showNotice(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { renderRooms(result.rooms); clearRoomForm(); }
    };
    $('cluster-mode').onchange = () => $('cluster-primary-row').classList.toggle('hidden', $('cluster-mode').value !== 'secondary');
    $('toggle-cluster-secret').onclick = () => { const input = $('cluster-secret'); input.type = input.type === 'password' ? 'text' : 'password'; };
    $('apply-cluster').onclick = async () => {
      const mode = $('cluster-mode').value;
      const accepted = await showDialog({ title: 'Aplicar configuração do cluster', message: mode === 'off' ? 'Desativar a ligação entre hosts?' : `Ativar este ServerHost como ${mode === 'primary' ? 'primário' : 'secundário'}?`, detail: 'A sinalização será reiniciada e as pessoas conectadas precisarão entrar novamente.', icon: '⇄', actions: [{ value: 'confirm', label: 'Aplicar', style: 'primary' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
      if (accepted !== 'confirm') return;
      $('apply-cluster').disabled = true;
      const result = await window.voiceupServer.saveCluster({ enabled: mode !== 'off', role: mode === 'secondary' ? 'secondary' : 'primary', primaryUrl: $('cluster-primary-url').value, secret: $('cluster-secret').value });
      $('apply-cluster').disabled = false;
      showNotice(result.message, result.ok ? 'success' : 'error');
      refresh();
    };
    const saveHostSettings = async (notify = false) => {
      const settings = await window.voiceupServer.saveSettings({ closeBehavior: $('host-close-behavior').value, theme: $('host-theme').value });
      setTheme(settings.theme);
      if (notify) showNotice('Configurações do ServerHost salvas.');
    };
    const scheduleHostSettingsSave = () => { clearTimeout(settingsSaveTimer); settingsSaveTimer = window.setTimeout(() => void saveHostSettings(false), 220); };
    $('host-theme').onchange = () => { setTheme($('host-theme').value); drawChart(); scheduleHostSettingsSave(); };
    $('host-close-behavior').onchange = scheduleHostSettingsSave;
    $('save-settings').onclick = () => void saveHostSettings(true);
    $('check-update').onclick = async () => { if (pendingUpdate) await confirmPendingServerUpdate(); else await checkServerUpdates(); };
    $('server-release-notes').onclick = () => void showServerReleaseNotes(serverVersion);
    $('metric-select').onchange = drawChart;
    $('app-dialog').addEventListener('click', (event) => { if (event.target === $('app-dialog')) closeDialog('cancel'); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('app-dialog').classList.contains('hidden')) closeDialog('cancel'); });
    window.voiceupServer.onCloseRequest?.(async () => {
      const choice = await showDialog({
        title: 'Fechar o VoiceUP Server?',
        message: 'Você pode manter o servidor funcionando na bandeja do Windows.',
        detail: 'Encerrar o programa também desconecta todas as pessoas e para os plugins.',
        icon: '×',
        actions: [
          { value: 'tray', label: 'Manter ativo', style: 'primary' },
          { value: 'quit', label: 'Encerrar', style: 'danger' },
          { value: 'cancel', label: 'Cancelar', style: 'secondary' }
        ]
      });
      await window.voiceupServer.respondClose(choice);
    });
    if (window.ResizeObserver) new ResizeObserver(drawChart).observe($('chart'));
    await refresh();
    window.setTimeout(() => void checkServerUpdates({ automatic: true }), 1200);
    window.setInterval(refresh, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
