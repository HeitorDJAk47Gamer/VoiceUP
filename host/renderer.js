(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[letter]));
  const history = [];
  const pageNames = { overview: 'Visão geral', people: 'Pessoas', access: 'Cargos e acesso', rooms: 'Salas e canais', extensions: 'Plugins', activity: 'Atividade', settings: 'Configurações' };
  let latestStats = {};
  let latestInfo = {};
  let noticeTimer;
  let pendingUpdate = null;
  let releaseNotesVersion = '1.2.2-beta.1';
  let updateProgressCanMinimize = true;
  let updateProgressValue = 0;
  let automaticUpdatePrompted = '';
  let pluginSnapshotKey = '';
  let dialogResolve = null;
  let settingsSaveTimer = null;
  let hostServerIcon = '';
  let publicAccessAcknowledged = false;
  let managedRooms = [];
  let roomSnapshotKey = '';
  let voiceChannelDraft = [];
  let textChannelDraft = [];
  let categoryDraft = [];
  let accessSnapshotKey = '';
  let accessControl = { roles: [], assignments: [] };
  let permissionDefinitions = [];
  const updateHardwareAccelerationUi = (settings = {}) => {
    const toggle = $('host-hardware-acceleration');
    const restart = $('host-hardware-restart');
    if (toggle && typeof settings.hardwareAcceleration === 'boolean') toggle.checked = settings.hardwareAcceleration;
    if (restart) restart.classList.toggle('hidden', settings.restartRequired !== true);
  };
  const roomTemplates = {
    community: { name: 'Comunidade VoiceUP', voice: ['Geral', 'Bate-papo', 'Ausente'], text: ['geral', 'apresentacoes', 'avisos', 'midia'] },
    gaming: { name: 'Servidor de jogos', voice: ['Lobby', 'Jogando 1', 'Jogando 2', 'Ausente'], text: ['geral', 'procurando-grupo', 'clips', 'avisos'] },
    rpg: { name: 'Mesa de RPG', voice: ['Mesa principal', 'Intervalo', 'Narrador'], text: ['geral', 'rolagens', 'fichas', 'lore', 'avisos'] },
    study: { name: 'Estudo e trabalho', voice: ['Reunião', 'Foco', 'Pausa'], text: ['geral', 'tarefas', 'materiais', 'avisos'] }
  };

  const formatTime = (seconds) => {
    const value = Number(seconds || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return minutes ? `${minutes}m ${value % 60}s` : `${value}s`;
  };
  const formatBytes = (bytes) => {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    if (value < 1073741824) return `${(value / 1048576).toFixed(value < 10485760 ? 1 : 0)} MB`;
    return `${(value / 1073741824).toFixed(2)} GB`;
  };
  const initials = (name) => String(name || 'V').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  const pingQuality = (value) => {
    const ping = Number(value);
    if (!Number.isFinite(ping) || ping < 0) return { level: 0, label: 'Medindo ping' };
    if (ping <= 60) return { level: 4, label: `${Math.round(ping)} ms · excelente` };
    if (ping <= 120) return { level: 3, label: `${Math.round(ping)} ms · bom` };
    if (ping <= 220) return { level: 2, label: `${Math.round(ping)} ms · moderado` };
    return { level: 1, label: `${Math.round(ping)} ms · alto` };
  };
  const pingBars = (value, compact = false) => {
    const ping = pingQuality(value);
    return `<span class="ping-bars${compact ? ' compact' : ''}" data-level="${ping.level}" title="${escapeHtml(ping.label)}" aria-label="${escapeHtml(ping.label)}"><i></i><i></i><i></i><i></i>${compact ? '' : `<em>${Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : '—'}</em>`}</span>`;
  };
  const imageData = (file) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Escolha uma imagem.'));
    // Não dependemos da extensão ou do tipo informado pelo Windows: se o
    // navegador conseguir decodificar o arquivo como imagem, ele é convertido
    // para WebP pequeno e seguro para os participantes receberem.
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error('Este arquivo não contém uma imagem compatível.')); };
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const size = 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d'); const scale = Math.max(size / image.width, size / image.height); const width = image.width * scale; const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const value = canvas.toDataURL('image/webp', .78); value.length <= 60000 ? resolve(value) : reject(new Error('A imagem ainda ficou grande demais. Escolha outra foto.'));
    };
    image.src = sourceUrl;
  });
  const renderHostServerIconPreview = () => {
    const preview = $('host-server-icon-preview');
    if (!preview) return;
    preview.innerHTML = hostServerIcon ? `<img src="${escapeHtml(hostServerIcon)}" alt="">` : 'V';
  };
  const showNotice = (message, type = 'success') => {
    if (!message) return;
    clearTimeout(noticeTimer);
    $('notice').textContent = String(message);
    $('notice').className = `notice ${type}`;
    noticeTimer = setTimeout(() => $('notice').classList.add('hidden'), 4200);
  };
  const setBackupStatus = (title, detail, tone = '') => {
    const box = $('backup-status');
    if (!box) return;
    box.className = `backup-status${tone ? ` ${tone}` : ''}`;
    box.querySelector('span').textContent = tone === 'error' ? '!' : tone === 'success' ? '✓' : '◷';
    box.querySelector('b').textContent = String(title || 'Backup do servidor');
    box.querySelector('small').textContent = String(detail || 'O arquivo contém dados privados do servidor. Guarde-o em um local seguro.');
  };
  const renderBackupMetadata = (status = {}) => {
    if (status.lastRestoreAt) {
      const when = new Date(status.lastRestoreAt).toLocaleString('pt-BR');
      setBackupStatus('Servidor restaurado de um backup', `${status.lastRestoreFile || 'Arquivo verificado'} · ${when}. Cópia anterior: ${status.lastRollbackFile || 'salva automaticamente'}.`, 'success');
      return;
    }
    if (status.lastBackupAt) {
      const when = new Date(status.lastBackupAt).toLocaleString('pt-BR');
      setBackupStatus('Último backup criado', `${status.lastBackupFile || 'Arquivo verificado'} · ${when} · ${formatBytes(status.lastBackupBytes)}.`, 'success');
    }
  };
  const closeDialog = (value = 'cancel') => {
    const modal = $('app-dialog'); if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden'); const resolve = dialogResolve; dialogResolve = null; resolve?.(value);
  };
  const showDialog = ({ title = 'Confirmar ação', message = '', detail = '', tone = 'normal', icon = '?', actions = [], wide = false, fields = [], returnFields = false } = {}) => new Promise((resolve) => {
    if (dialogResolve) closeDialog('cancel');
    dialogResolve = resolve; const modal = $('app-dialog');
    modal.classList.toggle('wide', wide);
    modal.classList.toggle('danger', tone === 'danger'); $('app-dialog-title').textContent = title; $('app-dialog-message').textContent = message; $('app-dialog-detail').textContent = detail; $('app-dialog-detail').classList.toggle('hidden', !detail); modal.querySelector('.app-dialog-icon').textContent = icon;
    const fieldBox = $('app-dialog-fields');
    fieldBox.innerHTML = fields.map((field) => `<label><span>${escapeHtml(field.label || field.name)}</span>${field.type === 'select' ? `<select data-dialog-field="${escapeHtml(field.name)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option.value)}"${String(option.value) === String(field.value ?? '') ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>` : field.type === 'textarea' ? `<textarea data-dialog-field="${escapeHtml(field.name)}" rows="3" maxlength="${Number(field.maxlength || 160)}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(field.value || '')}</textarea>` : `<input data-dialog-field="${escapeHtml(field.name)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}">`}</label>`).join('');
    fieldBox.classList.toggle('hidden', !fields.length);
    const choices = actions.length ? actions : [{ value: 'ok', label: 'Confirmar', style: 'primary' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }];
    $('app-dialog-actions').innerHTML = choices.map((action) => `<button type="button" class="button ${escapeHtml(action.style || 'secondary')}" data-dialog-value="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`).join('');
    $('app-dialog-actions').querySelectorAll('[data-dialog-value]').forEach((button) => { button.onclick = () => { const value = button.dataset.dialogValue; if (!returnFields || value === 'cancel') return closeDialog(value); const values = {}; fieldBox.querySelectorAll('[data-dialog-field]').forEach((input) => { values[input.dataset.dialogField] = input.value; }); closeDialog({ value, fields: values }); }; });
    modal.classList.remove('hidden'); requestAnimationFrame(() => $('app-dialog-actions').querySelector('[data-dialog-value]')?.focus());
  });
  const showServerReleaseNotes = (version) => {
    const releaseHistory = window.voiceupBetaReleaseHistory?.version === version
      ? window.voiceupBetaReleaseHistory
      : window.voiceupReleaseHistory;
    return showDialog({
      title: `Novidades da versão ${version}`,
      message: releaseHistory.locales['pt-BR'].subtitle,
      detail: releaseHistory.locales['pt-BR'].notes.map(note => `• ${note}`).join('\n\n'),
      icon: '✦',
      wide: true,
      actions: [{ value: 'ok', label: 'Entendi', style: 'primary' }]
    });
  };
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
    $('update-status').textContent = 'Baixando e verificando o pacote…';
    const result = await window.voiceupServer.downloadUpdate();
    $('update-status').textContent = result.ok ? (result.silent ? 'Instalação silenciosa iniciada. O ServerHost será reiniciado.' : 'Pacote verificado aberto.') : result.message;
    button.disabled = !result.ok;
  };
  const confirmPendingServerUpdate = async () => {
    if (!pendingUpdate) return;
    const accepted = await showDialog({ title: 'Atualização disponível', message: `Baixar o VoiceUP Server ${pendingUpdate.version}?`, detail: 'A assinatura será conferida e, no Windows, a instalação ocorrerá silenciosamente sem apagar suas salas, cargos, plugins ou configurações.', icon: '↓', actions: [{ value: 'confirm', label: 'Atualizar', style: 'primary' }, { value: 'cancel', label: 'Agora não', style: 'secondary' }] });
    if (accepted === 'confirm') await downloadPendingServerUpdate();
  };
  const minimizeUpdateProgress = () => {
    if (!updateProgressCanMinimize) return;
    $('update-progress')?.classList.add('hidden');
    $('update-progress-chip')?.classList.remove('hidden');
  };
  const showUpdateProgress = (progress = {}) => {
    const phase = String(progress.phase || 'checking');
    const titles = { checking: 'Preparando a atualização', downloading: 'Baixando a nova versão', verifying: 'Verificando o pacote', installing: 'Instalando a atualização', error: 'Não foi possível atualizar' };
    const rawPercent = Number(progress.percent);
    const determinate = progress.percent !== null && progress.percent !== undefined && Number.isFinite(rawPercent);
    updateProgressValue = determinate ? Math.max(0, Math.min(100, rawPercent)) : updateProgressValue;
    updateProgressCanMinimize = progress.minimizable !== false;
    $('update-progress-title').textContent = titles[phase] || 'Atualizando VoiceUP';
    $('update-retry')?.classList.toggle('hidden', phase !== 'error');
    $('update-progress-message').textContent = progress.message || 'Aguarde um instante…';
    $('update-progress-bar').style.width = determinate ? `${updateProgressValue}%` : '34%';
    $('update-progress-bar').classList.toggle('indeterminate', !determinate);
    $('update-progress-detail').textContent = phase === 'installing' ? 'O ServerHost será fechado apenas quando o instalador silencioso estiver pronto.' : phase === 'error' ? 'Você pode minimizar esta janela e tentar novamente pelas Configurações.' : 'Você pode minimizar esta janela e continuar usando o painel.';
    $('update-progress-minimize').classList.toggle('hidden', !updateProgressCanMinimize);
    $('update-progress-chip-value').textContent = determinate ? `${Math.round(updateProgressValue)}%` : '…';
    $('update-progress-chip').classList.toggle('error', phase === 'error');
    $('update-progress').classList.remove('hidden');
    $('update-progress-chip').classList.add('hidden');
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
    if (result.packageUnavailable) {
      if (!automatic) $('update-status').textContent = result.message || 'A atualização publicada ainda não possui um pacote verificado para este sistema.';
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
      const roles = (Array.isArray(member.roles) ? member.roles : []).filter((role) => role.id !== 'member');
      const roleMarkup = roles.map((role) => `<i class="inline-role" style="--role-color:${escapeHtml(role.color)}">${escapeHtml(role.name)}</i>`).join('');
      return `<div class="member"><span class="member-avatar" style="--member-color:${escapeHtml(member.color || '#56e2cf')}">${avatar}${globalThis.voiceupPlatform.badge(member.platform, member.status)}</span><span class="member-info"><b>${escapeHtml(member.name || 'Visitante')}${member.isBot ? ' · Bot' : ''}${roleMarkup}</b><small>Sala ${escapeHtml(member.room || '—')} · ${escapeHtml(channel)} · ${formatTime(member.connectedSeconds)}${member.remote ? ' · outro host' : ''}${member.identityVerified === false && !member.isBot ? ' · identidade antiga' : ''}</small></span>${pingBars(member.ping)}${member.isBot ? '' : `<span class="member-actions"><button class="button secondary" data-moderate="kick" data-member="${escapeHtml(member.id)}">Expulsar</button><button class="button warning" data-moderate="punish" data-member="${escapeHtml(member.id)}">Castigar</button><button class="button danger" data-moderate="ban" data-member="${escapeHtml(member.id)}">Banir</button></span>`}</div>`;
    }).join('') : '<div class="empty">Nenhum participante conectado.</div>';
    const bans = Array.isArray(stats.bans) ? stats.bans : [];
    $('ban-list').innerHTML = bans.length ? bans.map((ban) => {
      const expiry = ban.expiresAt ? `Expira ${new Date(ban.expiresAt).toLocaleString('pt-BR')}` : 'Permanente';
      const reason = ban.reason ? ` · ${ban.reason}` : '';
      return `<div class="member"><span class="member-avatar">!</span><span class="member-info"><b>${escapeHtml(ban.name || 'Visitante')}</b><small>${escapeHtml(expiry + reason)}</small></span><span class="member-actions"><button class="button secondary" data-unban="${escapeHtml(ban.clientId)}">Remover ban</button></span></div>`;
    }).join('') : '<div class="empty">Nenhum banimento ativo.</div>';
    const punishments = Array.isArray(stats.chatPunishments) ? stats.chatPunishments : [];
    $('punishment-list').innerHTML = punishments.length ? punishments.map((punishment) => {
      const expiry = punishment.expiresAt ? `Expira ${new Date(punishment.expiresAt).toLocaleString('pt-BR')}` : 'Permanente';
      const reason = punishment.reason ? ` · ${punishment.reason}` : '';
      return `<div class="member"><span class="member-avatar punishment-avatar">⌁</span><span class="member-info"><b>${escapeHtml(punishment.name || 'Visitante')}</b><small>${escapeHtml(expiry + reason)}</small></span><span class="member-actions"><button class="button secondary" data-unpunish="${escapeHtml(punishment.clientId)}">Remover castigo</button></span></div>`;
    }).join('') : '<div class="empty">Nenhum castigo ativo.</div>';
    document.querySelectorAll('[data-moderate]').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.moderate;
        const timed = action === 'ban' || action === 'punish';
        const punishing = action === 'punish';
        const accepted = await showDialog({ title: punishing ? 'Castigar no chat' : action === 'ban' ? 'Banir participante' : 'Expulsar participante', message: punishing ? 'A pessoa continuará na call, mas não poderá enviar nem editar mensagens.' : action === 'ban' ? 'Escolha por quanto tempo esta identidade ficará bloqueada.' : 'Esta pessoa será removida do servidor agora.', detail: timed ? 'A punição usa a identidade persistente do Client, não apenas o nome, e expira automaticamente.' : 'Ela poderá entrar novamente depois.', tone: action === 'kick' ? 'danger' : 'normal', icon: punishing ? '⌁' : action === 'ban' ? '!' : '×', fields: timed ? [{ name: 'durationMinutes', label: 'Duração', type: 'select', value: '60', options: [{ value: '10', label: '10 minutos' }, { value: '60', label: '1 hora' }, { value: '1440', label: '1 dia' }, { value: '10080', label: '7 dias' }, { value: '43200', label: '30 dias' }, { value: '0', label: 'Permanente' }] }, { name: 'reason', label: 'Motivo (opcional)', type: 'textarea', maxlength: 160, placeholder: punishing ? 'Explique por que a pessoa não pode usar o chat' : 'Explique por que a pessoa foi banida' }] : [], returnFields: timed, actions: [{ value: 'confirm', label: punishing ? 'Aplicar castigo' : action === 'ban' ? 'Banir' : 'Expulsar', style: action === 'punish' ? 'primary' : 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
        if ((timed ? accepted?.value : accepted) !== 'confirm') return;
        button.disabled = true;
        const result = await window.voiceupServer.moderate(action, button.dataset.member, timed ? { durationMinutes: Number(accepted.fields.durationMinutes), reason: accepted.fields.reason } : {});
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
    document.querySelectorAll('[data-unpunish]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        const result = await window.voiceupServer.unpunish(button.dataset.unpunish);
        showNotice(result.message, result.ok ? 'success' : 'error');
        button.disabled = false;
        refresh();
      };
    });
  }

  const roleBadge = (role) => `<span class="role-badge" style="--role-color:${escapeHtml(role?.color || '#56e2cf')}"><i></i>${escapeHtml(role?.name || 'Membro')}</span>`;
  const renderPermissionEditor = (selected = []) => {
    const active = new Set(Array.isArray(selected) ? selected : []);
    $('permission-editor').innerHTML = permissionDefinitions.map((permission) => `<label><input type="checkbox" value="${escapeHtml(permission.id)}"${active.has(permission.id) ? ' checked' : ''}><span><b>${escapeHtml(permission.label)}</b><small>${escapeHtml(permission.description)}</small></span></label>`).join('') || '<div class="empty">Permissões indisponíveis nesta versão.</div>';
  };
  const clearRoleForm = () => {
    $('role-previous-id').value = '';
    $('role-name').value = '';
    $('role-color').value = '#56e2cf';
    $('role-color-value').textContent = '#56e2cf';
    $('role-position').value = '10';
    $('role-editor-title').textContent = 'Criar cargo';
    $('delete-role').classList.add('hidden');
    renderPermissionEditor([]);
  };
  const fillRoleForm = (role) => {
    if (!role) return;
    $('role-previous-id').value = role.id || '';
    $('role-name').value = role.name || '';
    $('role-color').value = role.color || '#56e2cf';
    $('role-color-value').textContent = role.color || '#56e2cf';
    $('role-position').value = Number(role.position || 0);
    $('role-editor-title').textContent = `Editar ${role.name || 'cargo'}`;
    $('delete-role').classList.toggle('hidden', Boolean(role.protected));
    renderPermissionEditor(role.permissions || []);
  };
  const accessActionLabel = (action) => ({
    'session.joined': 'Entrou no servidor', 'session.left': 'Saiu do servidor', 'server.settings.changed': 'Alterou configurações do servidor',
    'server.settings.change': 'Tentou alterar configurações do servidor', 'channel.created': 'Criou canal', 'channel.updated': 'Configurou canal',
    'member.moved': 'Moveu participante', 'member.roles.changed': 'Alterou cargos', 'role.saved': 'Salvou cargo',
    'role.deleted': 'Removeu cargo', 'moderation.kick': 'Expulsou participante', 'moderation.ban': 'Baniu participante',
    'moderation.punish': 'Aplicou castigo', 'moderation.unban': 'Removeu ban', 'moderation.unpunish': 'Removeu castigo',
    'room.created': 'Criou sala', 'room.updated': 'Alterou sala', 'room.deleted': 'Removeu sala', 'message.pin': 'Fixou mensagem'
  }[action] || String(action || 'Ação do servidor'));
  const renderAccessControl = (stats = {}) => {
    const nextAccess = stats.accessControl || { roles: [], assignments: [] };
    const nextPermissions = Array.isArray(stats.permissionDefinitions) ? stats.permissionDefinitions : [];
    const memberSnapshot = (stats.members || []).map((member) => ({ id: member.id, clientId: member.clientId, name: member.name, identityVerified: member.identityVerified, roleIds: member.roleIds }));
    const audits = Array.isArray(stats.securityAudit) ? stats.securityAudit : [];
    const key = JSON.stringify({ access: nextAccess, permissions: nextPermissions, members: memberSnapshot, auditIds: audits.map((entry) => entry.id) });
    if (key === accessSnapshotKey) return;
    accessSnapshotKey = key;
    accessControl = nextAccess;
    permissionDefinitions = nextPermissions;
    const roles = Array.isArray(accessControl.roles) ? accessControl.roles : [];
    $('access-role-count').textContent = `${roles.length} cargo${roles.length === 1 ? '' : 's'}`;
    $('role-list').innerHTML = roles.length ? roles.map((role) => `<button class="role-card" type="button" data-edit-role="${escapeHtml(role.id)}"><span>${roleBadge(role)}${role.protected ? '<em>Padrão</em>' : ''}</span><small>${role.permissions?.length ? `${role.permissions.length} permissões` : 'Sem permissões administrativas'} · posição ${Number(role.position || 0)}</small></button>`).join('') : '<div class="empty">Nenhum cargo cadastrado.</div>';
    document.querySelectorAll('[data-edit-role]').forEach((button) => { button.onclick = () => fillRoleForm(roles.find((role) => role.id === button.dataset.editRole)); });
    if (!$('role-previous-id').value) renderPermissionEditor([]);

    const assignedByClient = new Map((accessControl.assignments || []).map((entry) => [String(entry.clientId), entry]));
    const known = new Map();
    for (const assignment of accessControl.assignments || []) known.set(String(assignment.clientId), { clientId: assignment.clientId, name: assignment.lastName || 'Perfil salvo', identityVerified: true, connected: false, roleIds: assignment.roleIds || [] });
    for (const member of stats.members || []) {
      if (member.isBot) continue;
      const keyId = member.clientId ? String(member.clientId) : `socket:${member.id}`;
      known.set(keyId, { ...member, connected: true, roleIds: assignedByClient.get(String(member.clientId))?.roleIds || member.roleIds || [] });
    }
    const people = [...known.values()].sort((left, right) => Number(right.connected) - Number(left.connected) || String(left.name).localeCompare(String(right.name), 'pt-BR'));
    const assignableRoles = roles.filter((role) => role.id !== 'member');
    $('role-member-list').innerHTML = people.length ? people.map((member) => {
      const persistent = Boolean(member.clientId) && member.identityVerified !== false && !member.remote && !String(member.clientId).startsWith('socket:');
      const selected = new Set(member.roleIds || []);
      const badges = (member.roleIds || []).map((id) => roles.find((role) => role.id === id)).filter(Boolean).map(roleBadge).join('') || roleBadge(roles.find((role) => role.id === 'member'));
      const unavailableReason = member.remote ? ' · gerenciado pelo outro host' : (persistent ? '' : ' · sem identidade protegida');
      return `<article class="role-member" data-role-client="${escapeHtml(persistent ? member.clientId : '')}"><header><span><b>${escapeHtml(member.name || 'Visitante')}</b><small>${member.connected ? '● conectado agora' : 'perfil salvo'}${unavailableReason}</small></span><span class="role-member-badges">${badges}</span></header><div class="role-choice-list">${assignableRoles.map((role) => `<label><input type="checkbox" value="${escapeHtml(role.id)}"${selected.has(role.id) ? ' checked' : ''}${persistent ? '' : ' disabled'}>${roleBadge(role)}</label>`).join('') || '<small>Crie um cargo editável primeiro.</small>'}</div><small class="role-assignment-autosave" aria-live="polite"></small></article>`;
    }).join('') : '<div class="empty">Nenhuma identidade conhecida. Atribuições aparecerão quando alguém entrar.</div>';
    document.querySelectorAll('.role-member[data-role-client]').forEach((card) => {
      const clientId = card.dataset.roleClient;
      if (!clientId) return;
      const inputs = [...card.querySelectorAll('.role-choice-list input[type="checkbox"]')];
      inputs.forEach((input) => {
        input.onchange = async () => {
          const roleIds = inputs.filter((choice) => choice.checked).map((choice) => choice.value);
          const status = card.querySelector('.role-assignment-autosave');
          inputs.forEach((choice) => { choice.disabled = true; });
          card.setAttribute('aria-busy', 'true');
          if (status) status.innerHTML = '<span aria-hidden="true">↻</span>Salvando cargos…';
          const name = card.querySelector('header b')?.textContent || '';
          const result = await window.voiceupServer.assignRoles(clientId, roleIds, name);
          card.removeAttribute('aria-busy');
          if (!result.ok) showNotice(result.message || 'Não foi possível alterar os cargos.', 'error');
          accessSnapshotKey = '';
          await refresh();
        };
      });
    });
    $('security-audit-list').innerHTML = audits.length ? audits.map((entry) => {
      const target = entry.target?.name || entry.target?.channel || entry.target?.roomId || entry.target?.clientId || '';
      const detail = Object.entries(entry.details || {}).filter(([, value]) => value !== '' && value !== 0).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
      return `<article class="security-audit-entry ${escapeHtml(entry.outcome || 'allowed')}"><i></i><span><b>${escapeHtml(accessActionLabel(entry.action))}${target ? ` · ${escapeHtml(target)}` : ''}</b><small>${escapeHtml(entry.actor?.name || 'ServerHost')} · ${escapeHtml(new Date(entry.at || Date.now()).toLocaleString('pt-BR'))}${detail ? ` · ${escapeHtml(detail)}` : ''}</small></span><em>${entry.outcome === 'denied' ? 'Negada' : entry.outcome === 'failed' ? 'Falhou' : 'Permitida'}</em></article>`;
    }).join('') : '<div class="empty">Nenhuma ação de segurança registrada.</div>';
  };

  const defaultChannel = (name, type, position) => type === 'voice'
    ? { id: `${name}-${position}`, name, type, kind: 'voice', position, category: '', visibleRoleIds: [], userLimit: 0, bitrateKbps: 64, region: 'auto', locked: false }
    : { id: `${name}-${position}`, name, type, kind: 'text', position, category: '', visibleRoleIds: [], topic: '', slowModeSeconds: 0, readOnly: false, forumTags: [], forumSort: 'recent' };
  const channelDraft = (values, names, type) => (Array.isArray(values) && values.length ? values : names.map((name, index) => defaultChannel(name, type, index))).map((channel, index) => ({ ...defaultChannel(channel.name || `${type === 'voice' ? 'Voz' : 'texto'} ${index + 1}`, type, index), ...channel, type, position: index }));
  const syncLegacyChannelFields = () => {
    $('room-voice-channels').value = voiceChannelDraft.map((channel) => channel.name).join('\n');
    $('room-text-channels').value = textChannelDraft.map((channel) => channel.name).join('\n');
  };
  const channelCard = (channel, index, type, total) => {
    const voice = type === 'voice';
    const detail = voice
      ? `<label><span>Formato</span><select data-channel-field="kind"><option value="voice"${channel.kind !== 'stage' && channel.kind !== 'dynamic' ? ' selected' : ''}>Canal de voz</option><option value="stage"${channel.kind === 'stage' ? ' selected' : ''}>Canal de Palco</option><option value="dynamic"${channel.kind === 'dynamic' ? ' selected' : ''}>Canal dinâmico</option></select><small>${channel.kind === 'dynamic' ? 'Cria uma call com o nome da pessoa e apaga após a última saída.' : channel.kind === 'stage' ? 'Canal de apresentação em voz.' : 'Call padrão.'}</small></label><label><span>Limite</span><input data-channel-field="userLimit" type="number" min="0" max="99" value="${Number(channel.userLimit || 0)}"><small>0 usa o limite global</small></label><label><span>Bitrate</span><select data-channel-field="bitrateKbps">${[32,48,64,96,128,192,256,384,510].map((value) => `<option value="${value}"${Number(channel.bitrateKbps) === value ? ' selected' : ''}>${value} Kbps</option>`).join('')}</select></label><label><span>Região</span><select data-channel-field="region"><option value="auto">Automática</option><option value="brazil"${channel.region === 'brazil' ? ' selected' : ''}>Brasil</option><option value="us-east"${channel.region === 'us-east' ? ' selected' : ''}>EUA Leste</option><option value="eu-central"${channel.region === 'eu-central' ? ' selected' : ''}>Europa Central</option></select></label><label class="channel-check"><input data-channel-field="locked" type="checkbox"${channel.locked ? ' checked' : ''}><span>Canal fechado</span></label>`
      : `<label><span>Formato</span><select data-channel-field="kind"><option value="text"${channel.kind !== 'forum' ? ' selected' : ''}>Canal de texto</option><option value="forum"${channel.kind === 'forum' ? ' selected' : ''}>Fórum</option></select><small>${channel.kind === 'forum' ? 'Conversa organizada por tópicos.' : 'Chat contínuo.'}</small></label><label class="channel-topic"><span>Tópico</span><input data-channel-field="topic" maxlength="240" value="${escapeHtml(channel.topic || '')}" placeholder="Descrição do canal"></label><label><span>Cooldown (s)</span><input data-channel-field="slowModeSeconds" type="number" min="0" max="21600" step="1" value="${Number(channel.slowModeSeconds || 0)}"><small>0 desativa neste canal</small></label><label class="channel-check"><input data-channel-field="readOnly" type="checkbox"${channel.readOnly ? ' checked' : ''}><span>Somente leitura</span></label><label class="channel-topic"><span>Tags do fórum</span><input data-channel-field="forumTags" maxlength="240" value="${escapeHtml(Array.isArray(channel.forumTags) ? channel.forumTags.join(', ') : channel.forumTags || '')}" placeholder="ajuda, beta, jogo"></label><label><span>Ordem dos tópicos</span><select data-channel-field="forumSort"><option value="recent"${channel.forumSort !== 'newest' ? ' selected' : ''}>Atividade recente</option><option value="newest"${channel.forumSort === 'newest' ? ' selected' : ''}>Mais novos</option></select></label>`;
    return `<article class="channel-editor-card" data-channel-index="${index}" data-channel-type="${type}"><header><span class="channel-kind">${voice ? '◖' : '#'}</span><input class="channel-name-input" data-channel-field="name" maxlength="24" value="${escapeHtml(channel.name)}" aria-label="Nome do canal"><span class="channel-order"><button type="button" data-channel-action="up"${index === 0 ? ' disabled' : ''} title="Mover para cima">↑</button><button type="button" data-channel-action="down"${index === total - 1 ? ' disabled' : ''} title="Mover para baixo">↓</button><button type="button" data-channel-action="delete" title="Remover">×</button></span></header><div class="channel-fields"><label><span>Categoria</span><input data-channel-field="category" maxlength="36" value="${escapeHtml(channel.category || '')}" placeholder="Opcional"></label>${detail}</div></article>`;
  };
  const renderChannelEditors = () => {
    $('voice-channel-editor').innerHTML = voiceChannelDraft.map((channel, index) => channelCard(channel, index, 'voice', voiceChannelDraft.length)).join('') || '<div class="empty">Adicione pelo menos uma call.</div>';
    $('text-channel-editor').innerHTML = textChannelDraft.map((channel, index) => channelCard(channel, index, 'text', textChannelDraft.length)).join('') || '<div class="empty">Adicione pelo menos um chat.</div>';
    syncLegacyChannelFields();
  };
  const setRoomDraft = (room = {}) => {
    categoryDraft = (Array.isArray(room.categorySettings) ? room.categorySettings : (room.categories || []).map((name, position) => ({ id: `category-${position + 1}`, name, position }))).map((category, position) => ({ id: category.id || `category-${position + 1}`, name: String(category.name || '').slice(0, 36), position: Number.isFinite(Number(category.position)) ? Number(category.position) : position })).filter((category) => category.name);
    voiceChannelDraft = channelDraft(room.voiceChannelSettings, room.voiceChannels || ['Geral', 'Jogando', 'Ausente'], 'voice');
    textChannelDraft = channelDraft(room.textChannelSettings, room.textChannels || ['geral', 'conversa', 'avisos'], 'text');
    renderChannelEditors();
  };
  const clearRoomForm = () => {
    $('room-previous-id').value = '';
    $('room-name').value = '';
    $('room-id').value = '';
    $('room-password').value = '';
    $('room-password-clear').checked = false;
    setRoomDraft({ voiceChannels: ['Geral', 'Jogando', 'Ausente'], textChannels: ['geral', 'conversa', 'avisos'] });
    $('room-editor-title').textContent = 'Criar sala';
    $('room-name').focus();
  };
  const fillRoomForm = (room) => {
    $('room-previous-id').value = room.id || '';
    $('room-name').value = room.name || '';
    $('room-id').value = room.id || '';
    $('room-password').value = '';
    $('room-password').placeholder = room.private ? 'Senha atual preservada' : 'Nova senha (opcional)';
    $('room-password-clear').checked = false;
    setRoomDraft(room);
    $('room-editor-title').textContent = `Editar ${room.name || room.id}`;
    document.querySelector('[data-page="rooms"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const renderRooms = (rooms = managedRooms) => {
    managedRooms = Array.isArray(rooms) ? rooms : [];
    $('managed-room-count').textContent = `${managedRooms.length} sala${managedRooms.length === 1 ? '' : 's'}`;
    $('nav-room-count').textContent = managedRooms.length;
    $('room-list').innerHTML = managedRooms.length ? managedRooms.map((room) => `<article class="managed-room" data-room-id="${escapeHtml(room.id)}"><header><span><strong>${escapeHtml(room.name || room.id)}${room.private ? ' · 🔒 privada' : ''}</strong><code>${escapeHtml(room.id)}</code></span><span class="managed-room-actions"><button class="button secondary" type="button" data-edit-room="${escapeHtml(room.id)}">Editar</button><button class="button danger" type="button" data-delete-room="${escapeHtml(room.id)}">Excluir</button></span></header><div><span><b>Voz</b>${(room.voiceChannelSettings || (room.voiceChannels || []).map((name) => ({ name }))).map((channel) => `<i>◖ ${escapeHtml(channel.name)} · ${Number(channel.humans || channel.userLimit || latestStats.maxHumanVoiceChannelSize || 12)} máx.</i>`).join('')}</span><span><b>Texto</b>${(room.textChannels || []).map((channel) => `<i># ${escapeHtml(channel)}</i>`).join('')}</span></div></article>`).join('') : '<div class="empty">Nenhuma sala gerenciada. Códigos livres ainda usam os canais padrão.</div>';
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
    const entry = (latestStats.plugins || []).find((plugin) => plugin.id === id);
    const enabling = card.querySelector('[data-plugin-enabled]')?.checked !== false;
    let approveFingerprint = '';
    if (entry?.requiresApproval && enabling) {
      const accepted = await showDialog({
        title: 'Aprovar plugin externo?',
        message: `${entry.fileName || entry.name} ainda não foi executado pelo VoiceUP.`,
        detail: `SHA-256: ${entry.fingerprint}\n\nApenas aprove arquivos obtidos de uma fonte em que você confia. Plugins JavaScript aprovados podem acessar dados e recursos do processo do ServerHost. Se o arquivo mudar, uma nova aprovação será exigida.`,
        tone: 'danger', icon: '!', wide: true,
        actions: [{ value: 'confirm', label: 'Conferi o SHA-256 e aprovo', style: 'danger' }, { value: 'cancel', label: 'Manter bloqueado', style: 'secondary' }]
      });
      if (accepted !== 'confirm') { card.querySelector('[data-plugin-enabled]').checked = false; return; }
      approveFingerprint = entry.fingerprint;
    }
    const button = card.querySelector('[data-plugin-save]'); if (button) button.disabled = true;
    const result = await window.voiceupServer.configurePlugin(id, { enabled: enabling, settings, approveFingerprint });
    showNotice(result.message, result.ok ? 'success' : 'error'); if (button) button.disabled = false; pluginSnapshotKey = ''; refresh();
  }

  const formatBandwidth = (value) => {
    const kbps = Math.max(0, Number(value || 0));
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`;
    return `${Math.round(kbps)} Kbps`;
  };
  const connectionRoute = (connection = {}) => {
    const local = connection.localCandidateType || '?';
    const remote = connection.remoteCandidateType || '?';
    return `${local} → ${remote}${connection.protocol ? ` · ${connection.protocol.toUpperCase()}` : ''}`;
  };
  const renderWebrtcDiagnostics = (stats = {}) => {
    const telemetry = stats.webrtc || {};
    const connections = Array.isArray(telemetry.connections) ? telemetry.connections : [];
    const members = Array.isArray(stats.members) ? stats.members.filter((member) => !member.isBot) : [];
    const supported = Number(telemetry.supportedClients || 0);
    const total = supported + Number(telemetry.unsupportedClients || 0);
    $('bandwidth-in').textContent = formatBandwidth(stats.bandwidth?.inboundKbps);
    $('bandwidth-out').textContent = formatBandwidth(stats.bandwidth?.outboundKbps);
    $('telemetry-clients').textContent = `${supported}/${total}`;

    const uniqueEdges = new Map();
    for (const connection of connections) {
      const pair = [String(connection.sourceId || ''), String(connection.targetId || '')].filter(Boolean).sort();
      if (pair.length !== 2 || pair[0] === pair[1]) continue;
      const key = pair.join('|');
      const previous = uniqueEdges.get(key);
      if (!previous || Number(connection.sampledAt || 0) >= Number(previous.sampledAt || 0)) uniqueEdges.set(key, connection);
    }
    $('p2p-edge-count').textContent = `${uniqueEdges.size} conex${uniqueEdges.size === 1 ? 'ão' : 'ões'}`;

    const nodeIndex = new Map(members.map((member) => [String(member.id), member]));
    for (const connection of connections) {
      if (connection.sourceId && !nodeIndex.has(String(connection.sourceId))) nodeIndex.set(String(connection.sourceId), { id: connection.sourceId, name: connection.sourceName || 'Client' });
      if (connection.targetId && !nodeIndex.has(String(connection.targetId))) nodeIndex.set(String(connection.targetId), { id: connection.targetId, name: connection.targetName || 'Client' });
    }
    const nodes = [...nodeIndex.values()].slice(0, 64).map((member, index, list) => {
      const angle = list.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index / list.length) - Math.PI / 2;
      return { ...member, x: 50 + Math.cos(angle) * (list.length > 2 ? 38 : 27), y: 50 + Math.sin(angle) * (list.length > 2 ? 34 : 0) };
    });
    const coordinates = new Map(nodes.map((node) => [String(node.id), node]));
    if (!nodes.length) {
      $('p2p-map').innerHTML = '<div class="empty">Aguardando Clients compatíveis enviarem telemetria…</div>';
    } else {
      const lines = [...uniqueEdges.values()].map((connection) => {
        const source = coordinates.get(String(connection.sourceId)); const target = coordinates.get(String(connection.targetId));
        if (!source || !target) return '';
        const title = `${connection.sourceName || source.name} ↔ ${connection.targetName || target.name} · ${Number.isFinite(Number(connection.rttMs)) ? `${Math.round(connection.rttMs)} ms` : 'RTT indisponível'} · ${formatBandwidth(Number(connection.inboundKbps || 0) + Number(connection.outboundKbps || 0))}`;
        const state = ['connected', 'completed'].includes(String(connection.connectionState || connection.iceConnectionState)) ? 'connected' : 'pending';
        return `<line class="p2p-edge ${state}" x1="${source.x * 10}" y1="${source.y * 5.6}" x2="${target.x * 10}" y2="${target.y * 5.6}"><title>${escapeHtml(title)}</title></line>`;
      }).join('');
      const nodeMarkup = nodes.map((node) => `<span class="p2p-node${node.remote ? ' remote' : ''}" style="--x:${node.x}%;--y:${node.y}%;--node-color:${escapeHtml(node.color || 'var(--accent)')}" title="${escapeHtml(`${node.name || 'Client'}${node.voiceChannel ? ` · ${node.voiceChannel}` : ''}${node.remote ? ' · host remoto' : ''}`)}"><i>${node.avatar ? `<img src="${escapeHtml(node.avatar)}" alt="">` : escapeHtml(initials(node.name))}</i><b>${escapeHtml(node.name || 'Client')}</b></span>`).join('');
      $('p2p-map').innerHTML = `<svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-label="Conexões P2P">${lines}</svg>${nodeMarkup}${uniqueEdges.size ? '' : '<small class="p2p-waiting">Clients visíveis, aguardando uma conexão WebRTC ativa.</small>'}`;
    }

    $('webrtc-table').innerHTML = connections.length ? `<div class="webrtc-table-head"><span>Conexão</span><span>Estado</span><span>Qualidade</span><span>Banda</span><span>Rota</span></div>${connections.slice(0, 128).map((connection) => {
      const state = String(connection.connectionState || connection.iceConnectionState || 'unknown');
      const loss = Number(connection.packetsLost || 0);
      const quality = `${Number.isFinite(Number(connection.rttMs)) ? `${Math.round(connection.rttMs)} ms` : '—'}${Number.isFinite(Number(connection.jitterMs)) ? ` · jitter ${Number(connection.jitterMs).toFixed(1)} ms` : ''}${loss ? ` · ${Math.round(loss)} perdidos` : ''}`;
      return `<div class="webrtc-row"><span><b>${escapeHtml(connection.sourceName || 'Client')}</b><small>→ ${escapeHtml(connection.targetName || 'Client')}</small></span><span><i class="connection-state ${escapeHtml(state)}"></i>${escapeHtml(state)}</span><span>${escapeHtml(quality)}</span><span><b>↓ ${escapeHtml(formatBandwidth(connection.inboundKbps))}</b><small>↑ ${escapeHtml(formatBandwidth(connection.outboundKbps))}</small></span><span title="${escapeHtml(connection.codec || '')}">${escapeHtml(connectionRoute(connection))}<small>${escapeHtml(connection.codec || 'codec não reportado')}</small></span></div>`;
    }).join('')}` : '<div class="empty">Nenhuma conexão WebRTC foi reportada nos últimos 15 segundos.</div>';
  };
  const renderClusterNodes = (cluster = {}) => {
    const nodes = Array.isArray(cluster.nodes) ? cluster.nodes : [];
    if (!cluster.enabled) { $('cluster-nodes').innerHTML = '<div class="empty">Ative o cluster para acompanhar os nós.</div>'; return; }
    $('cluster-nodes').innerHTML = nodes.length ? nodes.map((node) => {
      const participants = Number(node.participants || 0); const capacity = Math.max(1, Number(node.capacity || 100)); const percent = Math.min(100, Math.round(participants / capacity * 100));
      const state = node.state === 'online' ? 'online' : 'offline';
      return `<article class="cluster-node ${state}"><header><span><i></i><b>${escapeHtml(node.local ? 'Este host' : node.nodeId || 'Host remoto')}</b></span><em>${escapeHtml(node.local ? cluster.role === 'secondary' ? 'Secundário' : 'Primário' : cluster.role === 'secondary' ? 'Primário' : 'Secundário')}</em></header><div class="cluster-node-load"><span style="--load:${percent}%"></span></div><div><span><small>Participantes</small><b>${participants}/${capacity}</b></span><span><small>CPU</small><b>${Number(node.cpuPercent || 0).toFixed(1)}%</b></span><span><small>Memória</small><b>${Math.round(Number(node.memoryMb || 0))} MB</b></span><span><small>Score</small><b>${Number(node.score || 0).toFixed(2)}</b></span></div>${node.publicUrl ? `<code>${escapeHtml(node.publicUrl)}</code>` : '<code>URL pública não definida</code>'}</article>`;
    }).join('') : '<div class="empty">Cluster ativo, aguardando heartbeat do outro host.</div>';
  };

  function render(stats) {
    latestStats = stats;
    ['participants', 'rooms'].forEach((key) => { $(key).textContent = Number(stats[key] || 0); });
    $('call-limit').textContent = `canais em uso · ${Number(stats.maxHumanVoiceChannelSize || 12)} pessoas/call`;
    const signals = Number(stats.signals ?? stats.events?.signals ?? 0);
    $('ping').innerHTML = pingBars(stats.averagePing);
    $('cpu').textContent = `${Number(stats.cpuPercent || 0).toFixed(1).replace('.0', '')}%`;
    $('memory').textContent = `${stats.memoryMb || 0} MB`;
    $('uptime').textContent = formatTime(stats.uptimeSeconds);
    $('signals-summary').textContent = `${signals} sinais`;
    const storage = stats.storage || {};
    const storageCategories = storage.categories || {};
    $('storage-total').textContent = formatBytes(storage.totalBytes || 0);
    const storageLabels = { chats: 'Chats', reports: 'Relatórios', bans: 'Banimentos', punishments: 'Castigos', security: 'Segurança', settings: 'Configurações', plugins: 'Plugins', music: 'Músicas', other: 'Outros' };
    $('storage-categories').innerHTML = Object.entries(storageLabels).map(([key, label]) => `<div class="storage-category"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatBytes(storageCategories[key] || 0))}</strong></div>`).join('');
    const reports = Array.isArray(stats.reports) ? stats.reports : [];
    $('bug-report-list').innerHTML = reports.length ? reports.map((report) => `<article class="bug-report"><b>${escapeHtml(report.name || 'Cliente')} · ${escapeHtml(report.category || 'erro')}</b><time>${escapeHtml(new Date(Number(report.receivedAt) || Date.now()).toLocaleString('pt-BR'))}</time><p>${escapeHtml(report.description || '')}</p><small>${escapeHtml(report.version || 'versão não informada')} · ${escapeHtml(report.id || '')}</small></article>`).join('') : '<div class="empty">Nenhum relatório recebido.</div>';
    const publicAccess = stats.publicAccess || {};
    const accessElement = $('public-access-status');
    accessElement.className = `public-access-status ${publicAccess.status || 'idle'}`;
    accessElement.querySelector('span').textContent = publicAccess.message || 'Acesso automático ainda não verificado.';
    const addresses = [...new Set([...(publicAccess.scope === 'public' && publicAccess.publicUrl ? [publicAccess.publicUrl] : []), ...(latestInfo?.urls || [`http://localhost:${stats.port || 3000}`])])];
    $('urls').innerHTML = addresses.map((url, index) => `<div class="copy-row${url === publicAccess.publicUrl ? ' public-url' : ''}"><code id="host-url-${index}">${escapeHtml(url)}</code><button class="icon-button copy-button" type="button" data-copy-target="host-url-${index}" title="Copiar endereço">⧉</button></div>`).join('');
    const inviteHost = publicAccess.scope === 'public' && publicAccess.publicUrl ? publicAccess.publicUrl : addresses[0];
    if (inviteHost) $('connection-code').textContent = `VU1:${btoa(JSON.stringify({ host: inviteHost }))}`;
    const cluster = stats.cluster || {};
    $('cluster-status').textContent = !cluster.enabled ? 'Desativado' : cluster.state === 'conectado' ? `${cluster.role === 'primary' ? 'Primário' : 'Secundário'} conectado` : `${cluster.role === 'primary' ? 'Primário' : 'Secundário'} · ${cluster.state || 'aguardando'}`;
    $('cluster-status').classList.toggle('cluster-online', cluster.state === 'conectado' || cluster.state === 'failover ativo');
    renderClusterNodes(cluster);
    const runtimeRooms = Array.isArray(stats.roomLayouts) ? stats.roomLayouts : [];
    const runtimeRoomKey = JSON.stringify(runtimeRooms);
    if (runtimeRoomKey !== roomSnapshotKey) { roomSnapshotKey = runtimeRoomKey; renderRooms(runtimeRooms); }
    const roomsReadOnly = cluster.enabled && cluster.role === 'secondary';
    document.querySelector('.room-editor')?.classList.toggle('cluster-readonly', roomsReadOnly);
    ['room-name', 'room-id', 'room-password', 'room-password-clear', 'room-voice-channels', 'room-text-channels', 'save-room', 'clear-room-form'].forEach((id) => { if ($(id)) $(id).disabled = roomsReadOnly; });
    document.querySelectorAll('[data-edit-room],[data-delete-room]').forEach((button) => { button.disabled = roomsReadOnly; });
    if (roomsReadOnly) $('room-editor-title').textContent = 'Estrutura sincronizada pelo host primário';
    const online = Boolean(stats.online);
    document.querySelectorAll('#host-state .status-light, #sidebar-light').forEach((light) => { light.classList.toggle('online', online); light.classList.toggle('offline', !online); });
    const port = Number(stats.port || latestInfo?.port || 3000);
    $('host-state').querySelector('span:last-child').textContent = online ? `Online · porta ${port}` : 'Servidor desligado';
    $('sidebar-state').textContent = online ? 'Servidor online' : 'Servidor desligado';
    $('sidebar-detail').textContent = online ? `${stats.participants || 0} conexões · porta ${port}` : 'Painel ainda disponível';
    $('hero-title').textContent = online ? 'Servidor pronto para conexões' : 'Servidor desligado';
    $('hero-copy').textContent = online ? 'Compartilhe um endereço ou código para receber participantes.' : 'Use Iniciar para aceitar novas conexões sem fechar este painel.';
    const logs = Array.isArray(stats.logs) ? stats.logs : [];
    $('logs').innerHTML = logs.length ? logs.map((log) => `<div class="log"><time>${escapeHtml(log.time || '')}</time><b>${escapeHtml(String(log.level || 'info').toUpperCase())}</b><span>${escapeHtml(log.message || '')}</span></div>`).join('') : '<div class="empty">Nenhum evento ainda.</div>';
    renderMembers(stats);
    renderAccessControl(stats);
    renderPlugins(stats);
    renderWebrtcDiagnostics(stats);
    history.push({ ...stats, signals, inboundKbps: Number(stats.bandwidth?.inboundKbps || 0), outboundKbps: Number(stats.bandwidth?.outboundKbps || 0) });
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
      latestInfo = info;
      const urls = info.urls?.length ? info.urls : [`http://localhost:${info.port || 3000}`];
      $('urls').innerHTML = urls.map((url, index) => `<div class="copy-row"><code id="host-url-${index}">${escapeHtml(url)}</code><button class="icon-button copy-button" type="button" data-copy-target="host-url-${index}" title="Copiar endereço">⧉</button></div>`).join('');
      $('connection-code').textContent = info.connectionCode || '';
      $('plugin-folder').textContent = info.pluginFolder || 'Indisponível';
      $('music-folder').textContent = info.musicFolder || 'Indisponível';
      const serverVersion = info.version || '1.1.2';
      releaseNotesVersion = serverVersion;
      $('app-version').textContent = serverVersion;
      const settings = await window.voiceupServer.settings();
      $('host-close-behavior').value = settings.closeBehavior || 'ask';
      $('host-theme').value = settings.theme || 'ocean';
      updateHardwareAccelerationUi(settings);
      hostServerIcon = settings.serverIcon || '';
      renderHostServerIconPreview();
      $('chat-retention-days').value = Number(settings.storage?.retentionDays ?? 30);
      $('chat-max-per-room').value = Number(settings.storage?.maxPerRoom ?? 300);
      $('chat-cooldown-seconds').value = Number(settings.chatPolicy?.cooldownSeconds ?? 0);
      $('plugin-message-max-length').value = Number(settings.chatPolicy?.pluginMessageMaxLength ?? 2000);
      $('attachments-enabled').checked = settings.chatPolicy?.attachmentsEnabled === true;
      $('attachment-max-mb').value = Number(settings.chatPolicy?.attachmentMaxMB || 5);
      $('public-access-automatic').checked = settings.publicAccess?.automatic === true;
      publicAccessAcknowledged = $('public-access-automatic').checked && Number(settings.publicAccess?.consentVersion || 0) >= 1;
      setTheme($('host-theme').value);
      renderRooms(await window.voiceupServer.rooms());
      clearRoomForm();
      clearRoleForm();
      if (window.voiceupServer.backupStatus) renderBackupMetadata(await window.voiceupServer.backupStatus());
      const cluster = await window.voiceupServer.clusterSettings();
      $('cluster-mode').value = cluster.enabled ? cluster.role : 'off';
      $('cluster-primary-url').value = cluster.primaryUrl || '';
      $('cluster-public-url').value = cluster.publicUrl || '';
      $('cluster-secret').value = cluster.secret || '';
      $('cluster-node-id').value = cluster.nodeId || '';
      $('cluster-capacity').value = Number(cluster.capacity || 100);
      $('cluster-weight').value = Number(cluster.weight || 1);
      $('cluster-failover').checked = cluster.failover !== false;
      $('cluster-smart-distribution').checked = cluster.smartDistribution !== false;
      $('cluster-primary-row').classList.toggle('hidden', $('cluster-mode').value !== 'secondary');
      if (localStorage.getItem('voiceup-server-release-notes-seen-v1') !== releaseNotesVersion) {
        window.setTimeout(async () => {
          await showServerReleaseNotes(releaseNotesVersion);
          localStorage.setItem('voiceup-server-release-notes-seen-v1', releaseNotesVersion);
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
    const handleChannelEditor = (event) => {
      const card = event.target.closest('.channel-editor-card'); if (!card) return;
      const type = card.dataset.channelType; const list = type === 'voice' ? voiceChannelDraft : textChannelDraft; const index = Number(card.dataset.channelIndex); const channel = list[index]; if (!channel) return;
      const action = event.target.closest('[data-channel-action]')?.dataset.channelAction;
      if (action) {
        if (action === 'delete') list.splice(index, 1);
        if (action === 'up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
        if (action === 'down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
        list.forEach((item, position) => { item.position = position; }); renderChannelEditors(); return;
      }
      const input = event.target.closest('[data-channel-field]'); if (!input) return;
      const key = input.dataset.channelField;
      channel[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' || ['userLimit', 'slowModeSeconds', 'bitrateKbps'].includes(key) ? Number(input.value) : input.value;
      if (key === 'kind') { renderChannelEditors(); return; }
      syncLegacyChannelFields();
    };
    ['voice-channel-editor', 'text-channel-editor'].forEach((id) => { $(id).addEventListener('input', handleChannelEditor); $(id).addEventListener('change', handleChannelEditor); $(id).addEventListener('click', handleChannelEditor); });
    document.querySelectorAll('[data-add-channel]').forEach((button) => { button.onclick = () => { const type = button.dataset.addChannel; const list = type === 'voice' ? voiceChannelDraft : textChannelDraft; list.push(defaultChannel(type === 'voice' ? `Nova call ${list.length + 1}` : `novo-chat-${list.length + 1}`, type, list.length)); renderChannelEditors(); }; });
    $('apply-room-template').onclick = () => {
      const template = roomTemplates[$('room-template').value] || roomTemplates.community;
      if (!$('room-name').value.trim()) $('room-name').value = template.name;
      setRoomDraft({ voiceChannels: template.voice, textChannels: template.text });
      showNotice('Modelo aplicado ao editor. Revise e salve a sala.');
    };
    $('import-discord-template').onclick = async () => {
      const source = $('discord-template-source').value.trim(); if (!source) return showNotice('Cole um código, link ou JSON do Discord.', 'error');
      $('import-discord-template').disabled = true;
      const result = await window.voiceupServer.importDiscordTemplate(source, $('room-id').value, $('room-name').value);
      $('import-discord-template').disabled = false; showNotice(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { if (!$('room-name').value.trim()) $('room-name').value = result.room.name; if (!$('room-id').value.trim()) $('room-id').value = result.room.id; setRoomDraft(result.room); }
    };
    $('export-discord-template').onclick = async () => {
      const categories = [...new Set([...categoryDraft.map((category) => category.name), ...voiceChannelDraft, ...textChannelDraft].map((entry) => typeof entry === 'string' ? entry : entry.category).filter(Boolean))];
      const categoryIds = new Map(categories.map((name, index) => [name, categoryDraft.find((category) => category.name === name)?.id || `category-${index + 1}`]));
      const channels = [
        ...categories.map((name, position) => ({ id: categoryIds.get(name), type: 4, name, position })),
        ...textChannelDraft.map((channel, position) => ({ id: channel.id, type: 0, name: channel.name, position, parent_id: categoryIds.get(channel.category) || null, topic: channel.topic || null, rate_limit_per_user: Number(channel.slowModeSeconds || 0) })),
        ...voiceChannelDraft.map((channel, position) => ({ id: channel.id, type: 2, name: channel.name, position, parent_id: categoryIds.get(channel.category) || null, user_limit: Number(channel.userLimit || 0), bitrate: Number(channel.bitrateKbps || 64) * 1000, rtc_region: channel.region === 'auto' ? null : channel.region }))
      ];
      const payload = JSON.stringify({ name: $('room-name').value || 'VoiceUP', channels }, null, 2);
      try { await navigator.clipboard.writeText(payload); showNotice('JSON compatível copiado.'); } catch { showNotice('Não foi possível copiar o JSON.', 'error'); }
    };
    $('clear-room-form').onclick = clearRoomForm;
    $('clear-role-form').onclick = clearRoleForm;
    $('role-color').oninput = () => { $('role-color-value').textContent = $('role-color').value; };
    $('save-role').onclick = async () => {
      const name = $('role-name').value.trim();
      if (!name) return showNotice('Informe o nome do cargo.', 'error');
      const permissions = [...$('permission-editor').querySelectorAll('input:checked')].map((input) => input.value);
      $('save-role').disabled = true;
      const result = await window.voiceupServer.saveRole({ previousId: $('role-previous-id').value, name, color: $('role-color').value, position: Number($('role-position').value), permissions });
      $('save-role').disabled = false; showNotice(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { clearRoleForm(); accessSnapshotKey = ''; await refresh(); }
    };
    $('delete-role').onclick = async () => {
      const roleId = $('role-previous-id').value; if (!roleId) return;
      const accepted = await showDialog({ title: 'Excluir cargo?', message: `Remover o cargo ${$('role-name').value || roleId}?`, detail: 'As pessoas atribuídas voltarão ao cargo Membro quando não tiverem outro cargo.', tone: 'danger', icon: '×', actions: [{ value: 'confirm', label: 'Excluir cargo', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
      if (accepted !== 'confirm') return;
      const result = await window.voiceupServer.deleteRole(roleId); showNotice(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { clearRoleForm(); accessSnapshotKey = ''; await refresh(); }
    };
    $('clear-security-audit').onclick = async () => {
      const accepted = await showDialog({ title: 'Limpar registro de segurança?', message: 'As entradas atuais da auditoria serão removidas do disco.', detail: 'Cargos, permissões, salas e configurações não serão alterados.', tone: 'danger', icon: '×', actions: [{ value: 'confirm', label: 'Limpar registro', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
      if (accepted !== 'confirm') return;
      const result = await window.voiceupServer.clearSecurityAudit(); showNotice(`${result.removed || 0} registro(s) removido(s).`); accessSnapshotKey = ''; await refresh();
    };
    $('save-room').onclick = async () => {
      const room = {
        previousId: $('room-previous-id').value,
        id: $('room-id').value,
        name: $('room-name').value,
        password: $('room-password').value,
        clearPassword: $('room-password-clear').checked,
        voiceChannels: voiceChannelDraft.map((channel) => channel.name),
        textChannels: textChannelDraft.map((channel) => channel.name),
        voiceChannelSettings: voiceChannelDraft,
        textChannelSettings: textChannelDraft,
        categories: [...new Set([...categoryDraft.map((category) => category.name), ...voiceChannelDraft.map((channel) => channel.category), ...textChannelDraft.map((channel) => channel.category)].filter(Boolean))],
        categorySettings: categoryDraft
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
      const result = await window.voiceupServer.saveCluster({ enabled: mode !== 'off', role: mode === 'secondary' ? 'secondary' : 'primary', primaryUrl: $('cluster-primary-url').value, publicUrl: $('cluster-public-url').value, secret: $('cluster-secret').value, capacity: Number($('cluster-capacity').value), weight: Number($('cluster-weight').value), failover: $('cluster-failover').checked, smartDistribution: $('cluster-smart-distribution').checked });
      $('apply-cluster').disabled = false;
      showNotice(result.message, result.ok ? 'success' : 'error');
      refresh();
    };
    const saveHostSettings = async (notify = false) => {
      const settings = await window.voiceupServer.saveSettings({ closeBehavior: $('host-close-behavior').value, theme: $('host-theme').value, serverIcon: hostServerIcon, hardwareAcceleration: $('host-hardware-acceleration').checked, publicAccess: { automatic: $('public-access-automatic').checked, confirmed: publicAccessAcknowledged }, storage: { retentionDays: Number($('chat-retention-days').value), maxPerRoom: Number($('chat-max-per-room').value) }, chatPolicy: { cooldownSeconds: Number($('chat-cooldown-seconds').value), pluginMessageMaxLength: Number($('plugin-message-max-length').value), attachmentsEnabled: $('attachments-enabled').checked, attachmentMaxMB: Number($('attachment-max-mb').value) } });
      $('host-close-behavior').value = settings.closeBehavior || 'ask';
      setTheme(settings.theme);
      updateHardwareAccelerationUi(settings);
      $('chat-cooldown-seconds').value = Number(settings.chatPolicy?.cooldownSeconds ?? 0);
      $('plugin-message-max-length').value = Number(settings.chatPolicy?.pluginMessageMaxLength ?? 2000);
      if (notify) showNotice('Configurações do ServerHost salvas.');
    };
    const scheduleHostSettingsSave = () => { clearTimeout(settingsSaveTimer); settingsSaveTimer = window.setTimeout(() => void saveHostSettings(false), 220); };
    $('host-theme').onchange = () => { setTheme($('host-theme').value); drawChart(); scheduleHostSettingsSave(); };
    $('host-close-behavior').onchange = scheduleHostSettingsSave;
    $('host-hardware-acceleration').onchange = scheduleHostSettingsSave;
    $('chat-retention-days').onchange = scheduleHostSettingsSave;
    $('chat-max-per-room').onchange = scheduleHostSettingsSave;
    $('chat-cooldown-seconds').onchange = scheduleHostSettingsSave;
    $('plugin-message-max-length').onchange = scheduleHostSettingsSave;
    $('attachments-enabled').onchange = scheduleHostSettingsSave;
    $('attachment-max-mb').onchange = scheduleHostSettingsSave;
    $('public-access-automatic').onchange = async () => {
      if (!$('public-access-automatic').checked) {
        publicAccessAcknowledged = false;
        await saveHostSettings(false);
        showNotice('Acesso público automático desativado.');
        return;
      }
      const accepted = await showDialog({
        title: 'Expor o ServerHost à internet?',
        message: 'O VoiceUP tentará abrir a porta do servidor no roteador usando UPnP ou NAT-PMP.',
        detail: 'Isso pode permitir conexões externas. Proteja salas privadas com senhas fortes, mantenha o Windows e o VoiceUP atualizados e desative esta opção quando não precisar de acesso pela internet.',
        tone: 'danger', icon: '!',
        actions: [{ value: 'confirm', label: 'Entendi e quero ativar', style: 'danger' }, { value: 'cancel', label: 'Manter desativado', style: 'secondary' }]
      });
      publicAccessAcknowledged = accepted === 'confirm';
      $('public-access-automatic').checked = publicAccessAcknowledged;
      await saveHostSettings(false);
      showNotice(publicAccessAcknowledged ? 'Acesso público automático ativado com sua confirmação.' : 'Acesso público automático permanece desativado.', publicAccessAcknowledged ? 'success' : 'error');
    };
    $('host-server-icon').onchange = async () => {
      try {
        hostServerIcon = await imageData($('host-server-icon').files?.[0]);
        renderHostServerIconPreview();
        await saveHostSettings(false);
        showNotice('Imagem do servidor atualizada.');
      } catch (error) { showNotice(error.message || 'Não foi possível usar esta imagem.', 'error'); }
      finally { $('host-server-icon').value = ''; }
    };
    $('host-server-icon-clear').onclick = async () => {
      hostServerIcon = '';
      renderHostServerIconPreview();
      await saveHostSettings(false);
      showNotice('Ícone padrão restaurado.');
    };
    $('host-hardware-restart-button').onclick = async () => {
      const accepted = await showDialog({ title: 'Reiniciar o ServerHost?', message: 'A aceleração de hardware será alterada na próxima abertura.', detail: 'As pessoas conectadas serão desconectadas, mas as configurações, salas e plugins já estão salvos.', icon: '↻', actions: [{ value: 'confirm', label: 'Reiniciar agora', style: 'primary' }, { value: 'cancel', label: 'Reiniciar depois', style: 'secondary' }] });
      if (accepted === 'confirm') await window.voiceupServer.restartApplication();
    };
    $('create-server-backup').onclick = async () => {
      const button = $('create-server-backup');
      button.disabled = true;
      setBackupStatus('Criando backup verificado…', 'As gravações pendentes estão sendo concluídas antes de montar o arquivo.');
      try {
        const result = await window.voiceupServer.createBackup({ includePlugins: $('backup-include-plugins').checked, includeMusic: $('backup-include-music').checked });
        if (result.canceled) { setBackupStatus('Backup cancelado', 'Nenhum arquivo ou dado do servidor foi alterado.'); return; }
        if (!result.ok) { setBackupStatus('Não foi possível criar o backup', result.message, 'error'); showNotice(result.message, 'error'); return; }
        const content = `${result.fileCount} arquivos · ${formatBytes(result.totalBytes)} de dados · ${formatBytes(result.archiveBytes)} compactados`;
        setBackupStatus(result.fileName || 'Backup criado', content, 'success');
        showNotice('Backup completo criado e verificado.');
      } catch (error) {
        setBackupStatus('Falha ao criar o backup', error?.message || 'Erro inesperado.', 'error');
        showNotice(error?.message || 'Não foi possível criar o backup.', 'error');
      } finally { button.disabled = false; }
    };
    $('restore-server-backup').onclick = async () => {
      const button = $('restore-server-backup');
      button.disabled = true;
      try {
        const selected = await window.voiceupServer.chooseBackup();
        if (selected.canceled) return;
        if (!selected.ok) { setBackupStatus('Backup recusado', selected.message, 'error'); showNotice(selected.message, 'error'); return; }
        const details = [
          `Criado em ${new Date(selected.createdAt).toLocaleString('pt-BR')} pelo VoiceUP ${selected.sourceVersion}.`,
          `${selected.fileCount} arquivos e ${formatBytes(selected.totalBytes)} de dados verificados.`,
          selected.includes?.plugins ? `${selected.pluginFileCount} arquivo(s) de plugin serão restaurados.` : 'Os plugins instalados neste PC serão preservados.',
          selected.includes?.music ? `${selected.musicFileCount} arquivo(s) de música serão restaurados.` : 'As músicas existentes neste PC serão preservadas.',
          'Antes de substituir qualquer dado, o estado atual será salvo automaticamente na pasta Backups.'
        ].join('\n\n');
        const accepted = await showDialog({
          title: 'Restaurar este servidor?',
          message: selected.fileName,
          detail: details,
          tone: 'danger', icon: '↺', wide: true,
          actions: [{ value: 'confirm', label: 'Restaurar e reiniciar', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }]
        });
        if (accepted !== 'confirm') return;
        setBackupStatus('Restaurando o servidor…', 'Participantes serão desconectados e o ServerHost reiniciará automaticamente.', 'warning');
        const result = await window.voiceupServer.restoreBackup(selected.token);
        if (!result.ok) { setBackupStatus('A restauração falhou com segurança', result.message, 'error'); showNotice(result.message, 'error'); return; }
        setBackupStatus('Backup restaurado', result.message, 'success');
        showNotice(result.message);
      } catch (error) {
        setBackupStatus('Falha ao restaurar', error?.message || 'Erro inesperado.', 'error');
        showNotice(error?.message || 'Não foi possível restaurar o backup.', 'error');
      } finally { button.disabled = false; }
    };
    $('open-backup-folder').onclick = async () => {
      const result = await window.voiceupServer.openBackupFolder();
      if (!result.ok) showNotice(result.message, 'error');
    };
    $('cleanup-expired-messages').onclick = async () => {
      const result = await window.voiceupServer.cleanupMessages({ olderThanDays: Number($('chat-retention-days').value) });
      showNotice(result.ok ? `${result.removed || 0} mensagem(ns) expirada(s) removida(s).` : result.message, result.ok ? 'success' : 'error'); refresh();
    };
    $('clear-all-messages').onclick = async () => {
      const accepted = await showDialog({ title: 'Limpar todos os chats?', message: 'O histórico de todas as salas será apagado do disco.', detail: 'Essa ação não pode ser desfeita.', tone: 'danger', icon: '×', actions: [{ value: 'confirm', label: 'Limpar chats', style: 'danger' }, { value: 'cancel', label: 'Cancelar', style: 'secondary' }] });
      if (accepted !== 'confirm') return;
      const result = await window.voiceupServer.cleanupMessages({ clearAll: true });
      showNotice(result.ok ? `${result.removed || 0} mensagem(ns) removida(s).` : result.message, result.ok ? 'success' : 'error'); refresh();
    };
    $('clear-bug-reports').onclick = async () => {
      const result = await window.voiceupServer.clearReports();
      showNotice(result.ok ? `${result.removed || 0} relatório(s) removido(s).` : result.message, result.ok ? 'success' : 'error'); refresh();
    };
    $('send-host-report').onclick = async () => {
      const description = $('host-report-description').value.trim();
      const status = $('host-report-status');
      if (description.length < 8) { status.textContent = 'Descreva o problema com pelo menos 8 caracteres.'; return; }
      const button = $('send-host-report');
      button.disabled = true; status.textContent = 'Enviando…';
      try {
        const diagnosticsEnabled = $('host-report-diagnostics').checked;
        const info = await window.voiceupServer.getInfo();
        const stats = diagnosticsEnabled ? await window.voiceupServer.getStats() : null;
        const response = await fetch('https://voiceup.shardweb.app/api/bug-reports', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source: 'serverhost', category: $('host-report-category').value,
            description, steps: $('host-report-steps').value.trim(),
            version: info?.version || 'não informada',
            diagnostics: diagnosticsEnabled ? [
              `plataforma=${navigator.platform || 'Windows'}`,
              `cpu=${Number(stats?.cpuPercent || 0).toFixed(1)}%`, `memoria=${Number(stats?.memoryMb || 0)}MB`,
              `participantes=${Number(stats?.participants || 0)}`,
              `acessoPublico=${stats?.publicAccess?.mapped ? 'mapeado' : (stats?.publicAccess?.method || 'indisponível')}`
            ] : undefined
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.message || `Falha HTTP ${response.status}`);
        $('host-report-description').value = ''; $('host-report-steps').value = '';
        status.textContent = 'Relatório enviado. Obrigado por ajudar.';
      } catch (error) { status.textContent = `Não foi possível enviar: ${error?.message || 'erro de conexão'}`; }
      finally { button.disabled = false; }
    };
    $('save-settings').onclick = () => void saveHostSettings(true);
    $('check-update').onclick = async () => { if (pendingUpdate) await confirmPendingServerUpdate(); else await checkServerUpdates(); };
    $('server-release-notes').onclick = () => void showServerReleaseNotes(releaseNotesVersion);
    $('metric-select').onchange = drawChart;
    window.voiceupServer.onUpdateProgress?.(showUpdateProgress);
    $('update-retry').onclick = async () => {
      $('update-retry').disabled = true;
      try { await window.voiceupServer.downloadUpdate(); }
      catch { showUpdateProgress({ phase: 'error', message: 'Falha ao iniciar a atualização. Tente novamente.' }); }
      finally { $('update-retry').disabled = false; }
    };
    window.voiceupServer.updateRecovery?.().then((result) => {
      if (result?.pending) { showUpdateProgress({ phase: 'error', message: result.message }); minimizeUpdateProgress(); }
    }).catch(() => {});
    $('update-progress-minimize').onclick = minimizeUpdateProgress;
    $('update-progress-chip').onclick = () => { $('update-progress-chip').classList.add('hidden'); $('update-progress').classList.remove('hidden'); };
    $('update-progress').addEventListener('click', (event) => { if (event.target === $('update-progress')) minimizeUpdateProgress(); });
    $('app-dialog').addEventListener('click', (event) => { if (event.target === $('app-dialog')) closeDialog('cancel'); });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!$('app-dialog').classList.contains('hidden')) closeDialog('cancel');
      else if (!$('update-progress').classList.contains('hidden')) minimizeUpdateProgress();
    });
    window.voiceupServer.onCloseRequest?.(async () => {
      const choice = await showDialog({
        title: 'Fechar o VoiceUP Server?',
        message: 'Você pode manter o servidor funcionando na bandeja do sistema.',
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
