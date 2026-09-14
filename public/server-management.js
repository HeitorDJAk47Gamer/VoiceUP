(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[letter]));
  let access = window.voiceupCurrentServerAccess || { roles: [], permissions: [], permissionDefinitions: [] };
  let selectedRoleId = '';
  let decorateQueued = false;
  let draggedMemberIds = [];
  const selectedMemberIds = new Set();
  let bulkMovePending = false;
  let memberMenuTargetId = '';
  let memberDirectoryTargetId = '';
  let selectedSettingsSection = 'overview';
  let suppressMemberClickUntil = 0;
  let editedChannel = null;
  const LOBBY_CHANNEL = '__lobby__';

  document.body.insertAdjacentHTML('beforeend', `
    <div id="server-management-modal" class="server-management-modal hidden" role="dialog" aria-modal="true" aria-labelledby="server-management-title">
      <section class="server-management-card">
        <header><div><p class="eyebrow">CONFIGURAÇÕES DO SERVIDOR</p><h2 id="server-management-title">Configurar servidor</h2><p>Cada área fica separada. O gerenciamento de pessoas possui uma tela própria.</p></div><button id="server-management-close" type="button" aria-label="Fechar">×</button></header>
        <div class="server-management-shell">
          <nav id="server-management-nav" class="server-management-nav" aria-label="Áreas das configurações">
            <div id="server-access-summary" class="server-access-summary"></div>
            <button type="button" data-server-settings-view="overview"><i aria-hidden="true">⌂</i><span><b>Visão geral</b><small>Políticas do servidor</small></span></button>
            <button type="button" data-server-settings-view="channels"><i aria-hidden="true">#</i><span><b>Canais</b><small>Voz, texto e acesso</small></span></button>
            <button type="button" data-server-settings-view="roles"><i aria-hidden="true">♢</i><span><b>Cargos</b><small>Cores e permissões</small></span></button>
            <button type="button" data-server-settings-view="audit"><i aria-hidden="true">◷</i><span><b>Auditoria</b><small>Histórico de segurança</small></span></button>
          </nav>
          <div class="server-management-grid">
            <article id="server-config-tools" data-server-settings-panel="overview" class="server-management-tool hidden"><div class="server-settings-section-heading"><span aria-hidden="true">⌂</span><div><p class="eyebrow">VISÃO GERAL</p><h3>Políticas do servidor</h3><p>Ajustes que valem para todas as salas hospedadas.</p></div></div><label>Cooldown entre mensagens (segundos)<input id="admin-server-cooldown" type="number" min="0" max="21600" value="0"></label><label>Limite das mensagens de plugins<input id="admin-server-plugin-limit" type="number" min="500" max="10000" value="2000"></label><button id="admin-save-server-settings" type="button">Salvar configurações</button></article>
            <article id="server-channel-tools" data-server-settings-panel="channels" class="server-management-tool hidden"><div class="server-management-tool-heading"><div><p class="eyebrow">CANAIS</p><h3>Canais da sala</h3><p>Crie e configure voz, palco, fórum ou calls dinâmicas sem misturar ações de membros.</p></div><span class="admin-channel-create-actions"><button id="admin-add-voice-channel" type="button">+ Voz</button><button id="admin-add-stage-channel" type="button">+ Palco</button><button id="admin-add-dynamic-channel" type="button">+ Dinâmico</button><button id="admin-add-text-channel" type="button">+ Texto</button><button id="admin-add-forum-channel" type="button">+ Fórum</button></span></div><div id="admin-channel-list" class="admin-channel-list"></div></article>
            <article id="server-role-tools" data-server-settings-panel="roles" class="server-management-tool hidden"><div class="server-settings-section-heading"><span aria-hidden="true">♢</span><div><p class="eyebrow">CARGOS E PERMISSÕES</p><h3>Editar cargos</h3><p>Crie a hierarquia. A atribuição a pessoas fica na tela Membros.</p></div></div><label>Cargo<select id="admin-role-select"></select></label><div class="admin-role-fields"><label>Nome<input id="admin-role-name" maxlength="32"></label><label>Cor<input id="admin-role-color" type="color" value="#56e2cf"></label><label>Posição<input id="admin-role-position" type="number" min="-999" max="999" value="10"></label></div><label class="admin-role-separate-toggle"><input id="admin-role-display-separately" type="checkbox"><span><b>Exibir membros separadamente</b><small>Cria um cabeçalho deste cargo nas listas de pessoas da call, como no Discord.</small></span></label><div id="admin-permission-choices" class="admin-permission-choices"></div><div class="admin-role-actions"><button id="admin-delete-role" class="danger hidden" type="button">Excluir cargo</button><button id="admin-save-role" type="button">Salvar cargo</button></div></article>
            <article id="server-audit-tools" data-server-settings-panel="audit" class="server-management-tool hidden"><div class="server-management-tool-heading"><div><p class="eyebrow">SEGURANÇA</p><h3>Auditoria</h3><p>Ações administrativas e tentativas negadas registradas pelo ServerHost.</p></div><button id="admin-refresh-audit" type="button">Atualizar</button></div><div id="admin-audit-list" class="admin-audit-list"><small>Carregando registros…</small></div></article>
          </div>
        </div>
        <footer><span>🔒 Alterações validadas no ServerHost e registradas na auditoria local.</span></footer>
      </section>
    </div>
    <div id="channel-editor-modal" class="channel-editor-modal hidden" role="dialog" aria-modal="true" aria-labelledby="channel-editor-title">
      <section class="channel-editor-dialog">
        <header><div><p class="eyebrow" id="channel-editor-kind">CANAL DE VOZ</p><h2 id="channel-editor-title">Criar canal</h2><p id="channel-editor-description">A configuração será validada e salva pelo ServerHost.</p></div><button id="channel-editor-close" type="button" aria-label="Fechar">×</button></header>
        <div class="channel-editor-body">
          <div class="channel-editor-common">
            <label>Nome<input id="admin-channel-name" maxlength="24" placeholder="Ex.: Equipe"></label>
            <label>Categoria<input id="admin-channel-category" maxlength="36" placeholder="Opcional"></label>
            <label>Posição<select id="admin-channel-position"></select></label>
            <label id="admin-channel-kind-label">Formato<select id="admin-channel-kind"></select></label>
          </div>
          <section id="admin-channel-voice-fields" class="channel-specific-fields">
            <label>Quantidade de membros<input id="admin-channel-user-limit" type="number" min="0" max="99" value="0"><small>0 usa o limite global do servidor.</small></label>
            <label>Bitrate<select id="admin-channel-bitrate">${[32,48,64,96,128,192,256,384,510].map((value) => `<option value="${value}"${value === 64 ? ' selected' : ''}>${value} Kbps</option>`).join('')}</select></label>
            <label>Região<select id="admin-channel-region"><option value="auto">Automática</option><option value="brazil">Brasil</option><option value="us-east">EUA Leste</option><option value="eu-central">Europa Central</option></select></label>
            <label class="channel-editor-toggle"><input id="admin-channel-locked" type="checkbox"><span><b>Canal fechado</b><small>Impede novas entradas até ser reaberto.</small></span></label>
            <p id="admin-channel-dynamic-note" class="channel-editor-type-note hidden">Ao entrar neste canal, o ServerHost cria uma call temporária com o nome da pessoa e usa este limite. A call é apagada somente depois que a última pessoa sai.</p>
          </section>
          <section id="admin-channel-text-fields" class="channel-specific-fields hidden">
            <label class="channel-editor-topic">Tópico<input id="admin-channel-topic" maxlength="240" placeholder="Descrição do canal"></label>
            <label>Cooldown (segundos)<input id="admin-channel-slow-mode" type="number" min="0" max="21600" value="0"><small>0 desativa o cooldown específico.</small></label>
            <label class="channel-editor-toggle"><input id="admin-channel-read-only" type="checkbox"><span><b>Somente leitura</b><small>Apenas cargos com gerenciar mensagens poderão escrever.</small></span></label>
            <label id="admin-channel-forum-tags-label" class="channel-editor-topic hidden">Tags do fórum<input id="admin-channel-forum-tags" maxlength="240" placeholder="Ex.: ajuda, anúncio, jogo"><small>Separe as tags por vírgula. Elas organizam os tópicos, como nos fóruns do Discord.</small></label>
            <label id="admin-channel-forum-sort-label" class="hidden">Ordenar tópicos<select id="admin-channel-forum-sort"><option value="recent">Atividade recente</option><option value="newest">Mais novos</option></select></label>
          </section>
          <section class="channel-visibility-editor"><header><span><b>Quem pode ver</b><small>Sem seleção, o canal fica visível para todos.</small></span><button id="admin-channel-everyone" type="button">Todos</button></header><div id="admin-channel-role-choices" class="admin-role-choices"></div></section>
        </div>
        <footer><button id="admin-delete-channel" class="danger hidden" type="button">Excluir canal</button><span class="channel-editor-autosave">Alterações são salvas automaticamente no ServerHost.</span><button id="channel-editor-cancel" type="button">Cancelar</button><button id="admin-save-channel" type="button">Criar canal</button></footer>
      </section>
    </div>`);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="server-members-modal" class="server-members-modal hidden" role="dialog" aria-modal="true" aria-labelledby="server-members-title">
      <section class="server-members-card">
        <header><div><p class="eyebrow">GERENCIAMENTO DE PESSOAS</p><h2 id="server-members-title">Membros do servidor</h2><p>Cargos, call e moderação ficam reunidos por pessoa, longe das configurações gerais.</p></div><button id="server-members-close" type="button" aria-label="Fechar">×</button></header>
        <div class="server-members-layout">
          <aside class="server-members-directory">
            <label class="server-members-search"><span>Buscar membro</span><input id="server-members-search" type="search" maxlength="64" autocomplete="off" placeholder="Nome ou cargo"></label>
            <div id="server-members-list" class="server-members-list" role="listbox" aria-label="Membros conectados"></div>
          </aside>
          <main class="server-member-detail">
            <div id="server-member-detail-empty" class="server-member-detail-empty"><span aria-hidden="true">👤</span><strong>Selecione um membro</strong><small>Escolha uma pessoa ao lado para ver somente as ações permitidas ao seu cargo.</small></div>
            <div id="server-member-detail-content" class="server-member-detail-content hidden">
              <header><span id="server-member-detail-avatar" class="server-member-detail-avatar"></span><span><small>MEMBRO SELECIONADO</small><strong id="server-member-detail-name"></strong><em id="server-member-detail-role"></em><b id="server-member-detail-channel"></b></span></header>
              <div id="server-member-detail-notice" class="server-member-detail-notice hidden"></div>
              <div class="server-member-detail-tools">
                <article id="member-detail-move" class="member-detail-tool hidden"><div><span aria-hidden="true">↔</span><p><b>Mover de call</b><small>Escolha outro canal de voz ou deixe fora da call.</small></p></div><label>Destino<select id="member-detail-move-channel"></select></label><button id="member-detail-move-submit" type="button">Mover membro</button></article>
                <article id="member-detail-roles" class="member-detail-tool hidden"><div><span aria-hidden="true">♢</span><p><b>Cargos</b><small>Marque ou desmarque cargos abaixo da sua posição. A alteração é imediata.</small></p></div><div id="member-detail-role-choices" class="admin-role-choices"></div><p id="member-detail-role-status" class="member-role-autosave-status" aria-live="polite"></p></article>
                <article id="member-detail-moderation" class="member-detail-tool danger hidden"><div><span aria-hidden="true">!</span><p><b>Moderação</b><small>Castigue o chat, expulse ou bana esta pessoa.</small></p></div><label>Ação<select id="member-detail-moderation-action"><option value="punish">Castigar no chat</option><option value="kick">Expulsar do servidor</option><option value="ban">Banir do servidor</option></select></label><label>Duração<select id="member-detail-moderation-duration"><option value="60">1 hora</option><option value="1440">1 dia</option><option value="10080">7 dias</option><option value="0">Permanente</option></select></label><label>Motivo<input id="member-detail-moderation-reason" maxlength="160" placeholder="Opcional"></label><button id="member-detail-moderation-submit" type="button">Confirmar moderação</button></article>
              </div>
            </div>
          </main>
        </div>
        <footer>🔒 O ServerHost confere permissão e hierarquia novamente antes de cada ação.</footer>
      </section>
    </div>
    <aside id="member-management-popover" class="member-management-popover hidden" role="dialog" aria-modal="false" aria-labelledby="member-management-name">
      <header><span id="member-management-avatar" class="member-management-avatar"></span><span><small>GERENCIAR PESSOA</small><strong id="member-management-name"></strong><em id="member-management-role"></em></span><button id="member-management-close" type="button" aria-label="Fechar">×</button></header>
      <div id="member-management-actions" class="member-management-actions"></div>
      <footer>As ações são feitas pelo seu Client e validadas automaticamente pelo servidor.</footer>
    </aside>
    <section id="member-multi-select-toolbar" class="member-multi-select-toolbar hidden" role="region" aria-label="Membros selecionados" aria-live="polite">
      <span class="member-multi-select-icon" aria-hidden="true">✓</span>
      <span class="member-multi-select-copy"><strong id="member-multi-select-count">0 membros selecionados</strong><small id="member-multi-select-names">Ctrl + clique para adicionar ou remover</small></span>
      <label><span>Destino</span><select id="member-multi-select-destination" aria-label="Canal de destino"></select></label>
      <button id="member-multi-select-move" class="member-multi-select-move" type="button">Mover</button>
      <button id="member-multi-select-clear" class="member-multi-select-clear" type="button" aria-label="Limpar seleção" title="Limpar seleção">×</button>
    </section>`);

  const serverAdminActions = document.createElement('span');
  serverAdminActions.className = 'server-admin-actions';
  const membersButton = document.createElement('button');
  membersButton.id = 'server-members-button';
  membersButton.type = 'button';
  membersButton.className = 'server-members-button hidden';
  membersButton.innerHTML = '<span aria-hidden="true">◉</span> Membros';
  const manageButton = document.createElement('button');
  manageButton.id = 'server-manage-button';
  manageButton.type = 'button';
  manageButton.className = 'server-manage-button hidden';
  manageButton.innerHTML = '<span aria-hidden="true">⚙</span> Configurar';
  serverAdminActions.append(membersButton, manageButton);
  document.querySelector('.content > header')?.appendChild(serverAdminActions);

  const roles = () => Array.isArray(access.availableRoles) && access.availableRoles.length ? access.availableRoles : Array.isArray(access.roles) ? access.roles : [];
  const permissions = () => new Set(Array.isArray(access.permissions) ? access.permissions : []);
  const allowed = (permission) => permissions().has(permission);
  const roleById = (id) => roles().find((role) => role.id === id);
  const ownRolePosition = () => Math.max(0, ...(access.roles || []).map((role) => Number(role.position) || 0));
  const memberRolePosition = (member) => Math.max(0, Number(member?.primaryRole?.position) || 0, ...(Array.isArray(member?.roles) ? member.roles : []).map((role) => Number(role?.position) || 0));
  const manageableRole = (role) => Number(role?.position || 0) < ownRolePosition();
  const manageableMember = (member) => memberRolePosition(member) < ownRolePosition();
  const badge = (role) => `<span class="server-role-badge" style="--role-color:${escapeHtml(role?.color || '#56e2cf')}"><i></i>${escapeHtml(role?.name || 'Membro')}</span>`;
  const currentMembers = () => {
    try { return [...serverMembers.values()].filter((member) => member && member.id && !member.isBot).sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')); }
    catch { return []; }
  };
  const memberById = (id) => {
    try { return serverMembers.get(String(id || '')) || currentMembers().find((member) => member.id === id); }
    catch { return null; }
  };
  const canDragMember = (id) => {
    const member = memberById(id);
    return currentMode === 'hosted'
      && Boolean(hostedSocket?.connected)
      && allowed('moveMembers')
      && Boolean(member)
      && !member.isBot
      && member.id !== hostedSocket?.id
      && manageableMember(member);
  };
  const availableMemberActions = (member) => {
    if (currentMode !== 'hosted' || !hostedSocket?.connected || !member || member.isBot || member.id === hostedSocket.id || !manageableMember(member)) return [];
    return [
      allowed('moveMembers') ? { id: 'move', label: 'Mover de call', detail: 'Escolher outro canal ou deixar fora da call', icon: '↔' } : null,
      allowed('manageRoles') ? { id: 'roles', label: 'Adicionar ou remover cargos', detail: member.identityVerified === true ? 'Alterar cargos e permissões desta pessoa' : 'Requer o Client atual com identidade protegida', icon: '♢', disabled: member.identityVerified !== true } : null,
      allowed('moderateMembers') ? { id: 'moderate', label: 'Aplicar punição', detail: 'Castigar no chat, expulsar ou banir', icon: '!' , danger: true } : null
    ].filter(Boolean);
  };
  const canManageMemberFromClient = (id) => availableMemberActions(memberById(id)).some((action) => !action.disabled);
  const socketRequest = (event, payload) => new Promise((resolve) => {
    if (!hostedSocket?.connected) { resolve({ ok: false, message: 'O servidor não está conectado.' }); return; }
    let completed = false;
    const timer = window.setTimeout(() => { if (!completed) { completed = true; resolve({ ok: false, message: 'O ServerHost não respondeu a tempo.' }); } }, 8000);
    hostedSocket.emit(event, payload, (result = {}) => { if (completed) return; completed = true; clearTimeout(timer); resolve(result); });
  });
  const runAction = async (button, event, payload) => {
    button.disabled = true;
    const result = await socketRequest(event, payload);
    button.disabled = false;
    toast(result.message || (result.ok ? 'Alteração aplicada.' : 'Não foi possível aplicar a alteração.'));
    return result;
  };
  const auditActionLabel = (action) => ({
    'session.joined': 'Entrou no servidor', 'session.left': 'Saiu do servidor', 'server.settings.changed': 'Alterou configurações do servidor',
    'server.settings.change': 'Tentou alterar configurações do servidor', 'channel.created': 'Criou canal', 'channel.updated': 'Configurou canal',
    'channel.create': 'Tentou criar canal', 'channel.update': 'Tentou configurar canal', 'member.moved': 'Moveu participante', 'member.move': 'Tentou mover participante',
    'member.roles.changed': 'Alterou cargos', 'member.roles.change': 'Tentou alterar cargos', 'role.saved': 'Salvou cargo',
    'role.save': 'Tentou salvar cargo', 'role.deleted': 'Removeu cargo', 'role.delete': 'Tentou remover cargo',
    'moderation.kick': 'Expulsou participante', 'moderation.ban': 'Baniu participante', 'moderation.punish': 'Aplicou castigo',
    'moderation.remote': 'Tentou moderar participante', 'audit.view': 'Tentou consultar auditoria'
  }[action] || String(action || 'Ação do servidor'));
  const refreshAudit = async () => {
    if (!allowed('viewAuditLog')) return;
    $('admin-refresh-audit').disabled = true;
    const result = await socketRequest('admin:get-audit', {});
    $('admin-refresh-audit').disabled = false;
    if (!result.ok) { $('admin-audit-list').innerHTML = `<small>${escapeHtml(result.message || 'Não foi possível consultar a auditoria.')}</small>`; return; }
    const entries = Array.isArray(result.entries) ? result.entries : [];
    $('admin-audit-list').innerHTML = entries.length ? entries.map((entry) => {
      const target = entry.target?.name || entry.target?.channel || entry.target?.roomId || entry.target?.roleId || '';
      return `<article class="${escapeHtml(entry.outcome || 'allowed')}"><i></i><span><b>${escapeHtml(auditActionLabel(entry.action))}${target ? ` · ${escapeHtml(target)}` : ''}</b><small>${escapeHtml(entry.actor?.name || 'ServerHost')} · ${escapeHtml(new Date(entry.at || Date.now()).toLocaleString('pt-BR'))}</small></span><em>${entry.outcome === 'denied' ? 'Negada' : entry.outcome === 'failed' ? 'Falhou' : 'Permitida'}</em></article>`;
    }).join('') : '<small>Nenhuma ação registrada ainda.</small>';
  };

  const voiceOptions = () => ['<option value="__lobby__">Fora da call</option>', ...(ROOM_CHANNELS?.voice || []).map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`)].join('');
  const roomChannelSettings = (type) => {
    const names = type === 'voice' ? (ROOM_CHANNELS?.voice || []) : (ROOM_CHANNELS?.text || []);
    const settings = type === 'voice' ? (ROOM_CHANNEL_LAYOUT?.voice || []) : (ROOM_CHANNEL_LAYOUT?.text || []);
    return names.map((name, position) => ({
      name,
      type,
      position,
      category: '',
      visibleRoleIds: [],
      ...(type === 'voice' ? { userLimit: 0, bitrateKbps: 64, region: 'auto', locked: false } : { topic: '', slowModeSeconds: 0, readOnly: false }),
      ...(settings.find((channel) => channel.name === name) || {})
    }));
  };
  const channelVisibilityLabel = (channel) => {
    const selected = Array.isArray(channel.visibleRoleIds) ? channel.visibleRoleIds : [];
    if (!selected.length) return 'Todos os cargos';
    const names = selected.map((id) => roleById(id)?.name || id);
    return names.length <= 2 ? names.join(' e ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  };
  const channelKindLabel = (channel) => ({ stage: 'palco', dynamic: 'dinâmico', forum: 'fórum' }[channel?.kind] || '');
  const channelDetailLabel = (channel) => channel.type === 'voice'
    ? `${channelKindLabel(channel) ? `${channelKindLabel(channel)} · ` : ''}${Number(channel.userLimit || 0) ? `${Number(channel.userLimit)} membros` : 'limite global'} · ${Number(channel.bitrateKbps || 64)} Kbps · ${channel.locked ? 'fechado' : 'aberto'}`
    : `${channelKindLabel(channel) ? `${channelKindLabel(channel)} · ` : ''}${channel.kind === 'forum' ? `${Array.isArray(channel.forumTags) && channel.forumTags.length ? `${channel.forumTags.length} tags` : 'sem tags'} · tópicos` : `${Number(channel.slowModeSeconds || 0) ? `cooldown ${Number(channel.slowModeSeconds)}s` : 'sem cooldown'} · ${channel.readOnly ? 'somente leitura' : 'conversa liberada'}`}`;
  const renderChannelManager = () => {
    if (!$('admin-channel-list')) return;
    const sections = [
      { type: 'voice', title: 'Voz', icon: '◖' },
      { type: 'text', title: 'Texto', icon: '#' }
    ];
    $('admin-channel-list').innerHTML = sections.map(({ type, title, icon }) => {
      const channels = roomChannelSettings(type).filter((channel) => !channel.ephemeral);
      return `<section><h4>${title}<small>${channels.length}</small></h4>${channels.length ? channels.map((channel) => `<article><span class="admin-channel-icon">${icon}</span><span class="admin-channel-identity"><b>${escapeHtml(channel.name)}</b><small>${escapeHtml(channelDetailLabel(channel))}</small><em>${escapeHtml(channel.category ? `${channel.category} · ${channelVisibilityLabel(channel)}` : channelVisibilityLabel(channel))}</em></span><button type="button" data-configure-channel="${escapeHtml(channel.id || channel.name)}" data-channel-name="${escapeHtml(channel.name)}" data-channel-type="${type}">Configurar</button></article>`).join('') : '<small>Nenhum canal visível.</small>'}</section>`;
    }).join('');
  };
  const closeChannelEditor = () => {
    editedChannel = null;
    $('channel-editor-modal').classList.add('hidden');
  };
  const renderChannelRoleChoices = (selectedIds = []) => {
    const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    $('admin-channel-role-choices').innerHTML = roles().map((role) => `<label><input type="checkbox" value="${escapeHtml(role.id)}"${selected.has(role.id) ? ' checked' : ''}>${badge(role)}</label>`).join('') || '<small>Nenhum cargo configurado neste servidor.</small>';
  };
  const openChannelEditor = (type, channel = null, requestedKind = '') => {
    if (!allowed('manageChannels')) return;
    const normalizedType = type === 'text' ? 'text' : 'voice';
    const settings = roomChannelSettings(normalizedType);
    const kind = channel?.kind || requestedKind || (normalizedType === 'voice' ? 'voice' : 'text');
    editedChannel = channel ? { type: normalizedType, id: channel.id || '', name: channel.name, kind } : { type: normalizedType, id: '', name: '', kind };
    const kindOptions = normalizedType === 'voice'
      ? [['voice', 'Canal de voz'], ['stage', 'Canal de Palco'], ['dynamic', 'Canal dinâmico']]
      : [['text', 'Canal de texto'], ['forum', 'Fórum']];
    $('admin-channel-kind').innerHTML = kindOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    $('admin-channel-kind').value = kind;
    const syncKindUi = () => {
      const currentKind = $('admin-channel-kind').value;
      const title = { voice: 'CANAL DE VOZ', stage: 'CANAL DE PALCO', dynamic: 'CANAL DINÂMICO', text: 'CANAL DE TEXTO', forum: 'FÓRUM' }[currentKind] || 'CANAL';
      $('channel-editor-kind').textContent = title;
      $('admin-channel-dynamic-note').classList.toggle('hidden', currentKind !== 'dynamic');
      $('admin-channel-forum-tags-label').classList.toggle('hidden', currentKind !== 'forum');
      $('admin-channel-forum-sort-label').classList.toggle('hidden', currentKind !== 'forum');
      if (!channel) $('channel-editor-title').textContent = `Criar ${title.toLocaleLowerCase('pt-BR')}`;
    };
    $('admin-channel-kind').disabled = Boolean(channel);
    $('admin-channel-kind').onchange = syncKindUi;
    syncKindUi();
    $('channel-editor-title').textContent = channel ? `Configurar ${channel.name}` : $('channel-editor-title').textContent;
    $('channel-editor-description').textContent = channel ? 'O nome é preservado para não quebrar conversas e chamadas em andamento.' : 'A configuração será validada e salva pelo ServerHost.';
    $('admin-channel-name').value = channel?.name || '';
    $('admin-channel-name').disabled = Boolean(channel);
    $('admin-channel-category').value = channel?.category || '';
    const positions = Array.from({ length: settings.length + (channel ? 0 : 1) }, (_, index) => `<option value="${index}">${index + 1}ª posição</option>`).join('');
    $('admin-channel-position').innerHTML = positions;
    $('admin-channel-position').value = String(Math.max(0, Math.min(settings.length, Number(channel?.position ?? settings.length))));
    $('admin-channel-voice-fields').classList.toggle('hidden', normalizedType !== 'voice');
    $('admin-channel-text-fields').classList.toggle('hidden', normalizedType !== 'text');
    $('admin-channel-user-limit').value = Number(channel?.userLimit || 0);
    $('admin-channel-bitrate').value = String(Number(channel?.bitrateKbps || 64));
    $('admin-channel-region').value = channel?.region || 'auto';
    $('admin-channel-locked').checked = channel?.locked === true;
    $('admin-channel-topic').value = channel?.topic || '';
    $('admin-channel-slow-mode').value = Number(channel?.slowModeSeconds || 0);
    $('admin-channel-read-only').checked = channel?.readOnly === true;
    $('admin-channel-forum-tags').value = Array.isArray(channel?.forumTags) ? channel.forumTags.join(', ') : '';
    $('admin-channel-forum-sort').value = channel?.forumSort === 'newest' ? 'newest' : 'recent';
    renderChannelRoleChoices(channel?.visibleRoleIds || []);
    $('admin-save-channel').textContent = channel ? 'Salvar canal' : 'Criar canal';
    $('admin-delete-channel').classList.toggle('hidden', !channel);
    $('admin-delete-channel').dataset.confirming = '';
    $('admin-delete-channel').textContent = 'Excluir canal';
    $('channel-editor-modal').classList.remove('hidden');
    window.setTimeout(() => $('admin-channel-name').disabled ? $('admin-channel-category').focus() : $('admin-channel-name').focus(), 40);
  };
  const channelEditorPayload = () => ({
    type: editedChannel?.type,
    channelId: editedChannel?.id || '',
    channelName: editedChannel?.name || '',
    name: $('admin-channel-name').value.trim(),
    category: $('admin-channel-category').value.trim(),
    position: Number($('admin-channel-position').value),
    visibleRoleIds: [...$('admin-channel-role-choices').querySelectorAll('input:checked')].map((input) => input.value),
    ...(editedChannel?.type === 'voice'
      ? { kind: $('admin-channel-kind').value, userLimit: Number($('admin-channel-user-limit').value), bitrateKbps: Number($('admin-channel-bitrate').value), region: $('admin-channel-region').value, locked: $('admin-channel-locked').checked }
      : { kind: $('admin-channel-kind').value, topic: $('admin-channel-topic').value.trim(), slowModeSeconds: Number($('admin-channel-slow-mode').value), readOnly: $('admin-channel-read-only').checked, forumTags: $('admin-channel-forum-tags').value.split(',').map((value) => value.trim()).filter(Boolean), forumSort: $('admin-channel-forum-sort').value })
  });
  const loadRoleForm = (id = '') => {
    selectedRoleId = id;
    const role = roleById(id);
    $('admin-role-name').value = role?.name || '';
    $('admin-role-color').value = role?.color || '#56e2cf';
    $('admin-role-position').value = Number(role?.position ?? 10);
    $('admin-role-display-separately').checked = role?.displaySeparately === true;
    $('admin-role-position').max = String(Math.max(-999, ownRolePosition() - 1));
    const selected = new Set(role?.permissions || []);
    $('admin-permission-choices').innerHTML = (access.permissionDefinitions || []).map((permission) => `<label><input type="checkbox" value="${escapeHtml(permission.id)}"${selected.has(permission.id) ? ' checked' : ''}><span><b>${escapeHtml(permission.label)}</b><small>${escapeHtml(permission.description)}</small></span></label>`).join('');
    $('admin-delete-role').classList.toggle('hidden', !role || role.protected === true);
  };
  const applySettingsSection = (section = selectedSettingsSection) => {
    const buttons = [...document.querySelectorAll('[data-server-settings-view]')].filter((button) => !button.classList.contains('hidden'));
    if (!buttons.some((button) => button.dataset.serverSettingsView === section)) section = buttons[0]?.dataset.serverSettingsView || '';
    selectedSettingsSection = section;
    document.querySelectorAll('[data-server-settings-view]').forEach((button) => {
      const active = button.dataset.serverSettingsView === section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-server-settings-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.serverSettingsPanel !== section || panel.dataset.serverSettingsAuthorized !== 'true');
    });
    if (section === 'channels') renderChannelManager();
    if (section === 'audit') void refreshAudit();
  };
  const refreshModal = () => {
    const ownRoles = (access.roles || []).length ? access.roles : (access.roleIds || []).map(roleById).filter(Boolean);
    $('server-access-summary').innerHTML = `<span><b>Seus cargos</b>${ownRoles.length ? ownRoles.map(badge).join('') : badge(roleById('member'))}</span><span><b>Permissões liberadas</b><small>${permissions().size ? [...permissions()].map((id) => access.permissionDefinitions?.find((entry) => entry.id === id)?.label || id).join(' · ') : 'Nenhuma permissão administrativa'}</small></span>`;
    const canConfigureServer = allowed('manageServer') && access.capabilities?.manageChatPolicy === true;
    const sectionAccess = { overview: canConfigureServer, channels: allowed('manageChannels'), roles: allowed('manageRoles'), audit: allowed('viewAuditLog') };
    for (const [section, enabled] of Object.entries(sectionAccess)) {
      document.querySelector(`[data-server-settings-view="${section}"]`)?.classList.toggle('hidden', !enabled);
      const panel = document.querySelector(`[data-server-settings-panel="${section}"]`);
      if (panel) panel.dataset.serverSettingsAuthorized = enabled ? 'true' : 'false';
    }
    if (canConfigureServer) {
      $('admin-server-cooldown').value = Number(access.serverSettings?.chatPolicy?.cooldownSeconds ?? 0);
      $('admin-server-plugin-limit').value = Number(access.serverSettings?.chatPolicy?.pluginMessageMaxLength ?? 2000);
    }
    const editable = roles().filter(manageableRole);
    $('admin-role-select').innerHTML = `<option value="">+ Novo cargo</option>${editable.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('')}`;
    if (selectedRoleId && !editable.some((role) => role.id === selectedRoleId)) selectedRoleId = '';
    $('admin-role-select').value = selectedRoleId;
    loadRoleForm(selectedRoleId);
    applySettingsSection(selectedSettingsSection);
  };
  const refreshManageButton = () => {
    const hosted = currentMode === 'hosted';
    const configVisible = hosted && ((allowed('manageServer') && access.capabilities?.manageChatPolicy === true) || ['manageRoles', 'manageChannels', 'viewAuditLog'].some(allowed));
    const membersVisible = hosted && ['manageRoles', 'moveMembers', 'moderateMembers'].some(allowed);
    manageButton.classList.toggle('hidden', !configVisible);
    membersButton.classList.toggle('hidden', !membersVisible);
    serverAdminActions.classList.toggle('hidden', !configVisible && !membersVisible);
    if (!configVisible) $('server-management-modal').classList.add('hidden');
    if (!membersVisible) closeMemberDirectory();
  };
  const memberDirectoryMembers = () => currentMembers().filter((member) => member.id !== hostedSocket?.id && !member.isBot);
  const safeMemberColor = (member) => /^#[a-f0-9]{6}$/i.test(String(member?.color || '')) ? member.color : '#56e2cf';
  const memberAvatar = (member, className) => {
    const image = typeof safeAvatar === 'function' ? safeAvatar(member?.avatar) : '';
    const initial = String(member?.name || '?').trim().slice(0, 1).toUpperCase();
    return `<span class="${className}" style="background-color:${safeMemberColor(member)}${image ? `;background-image:url('${image}');background-size:cover;background-position:center` : ''}">${image ? '' : escapeHtml(initial)}</span>`;
  };
  const memberRoleIds = (member) => new Set(Array.isArray(member?.roleIds) ? member.roleIds : (member?.roles || []).map((role) => role.id));
  let memberRoleAutosaveToken = 0;
  const setMemberRoleAutosaveStatus = (text, state = '') => {
    const status = $('member-detail-role-status');
    if (!status) return;
    status.className = `member-role-autosave-status${state ? ` ${state}` : ''}`;
    if (!text) { status.textContent = ''; return; }
    status.innerHTML = `<span aria-hidden="true">${state === 'saving' ? '↻' : state === 'error' ? '!' : '●'}</span> ${escapeHtml(text)}`;
  };
  const saveMemberRolesImmediately = async () => {
    const member = memberById(memberDirectoryTargetId);
    if (!member || !availableMemberActions(member).some((action) => action.id === 'roles' && !action.disabled)) return;
    const targetId = member.id;
    const choices = [...$('member-detail-role-choices').querySelectorAll('input[type="checkbox"]')];
    const previousRoleIds = [...memberRoleIds(member)].filter((roleId) => roleId !== 'member');
    const roleIds = choices.filter((input) => input.checked).map((input) => input.value);
    const token = ++memberRoleAutosaveToken;
    choices.forEach((input) => { input.disabled = true; });
    $('member-detail-roles').setAttribute('aria-busy', 'true');
    setMemberRoleAutosaveStatus('Salvando cargos…', 'saving');
    const result = await socketRequest('admin:assign-roles', { targetId, roleIds });
    if (token !== memberRoleAutosaveToken || targetId !== memberDirectoryTargetId) return;
    $('member-detail-roles').removeAttribute('aria-busy');
    if (!result.ok) {
      const previous = new Set(previousRoleIds);
      choices.forEach((input) => { input.checked = previous.has(input.value); input.disabled = false; });
      setMemberRoleAutosaveStatus(result.message || 'Não foi possível salvar.', 'error');
      toast(result.message || 'Não foi possível alterar os cargos.');
      return;
    }
    member.roleIds = roleIds;
    member.roles = roles().filter((role) => role.id === 'member' || roleIds.includes(role.id));
    member.primaryRole = member.roles.filter((role) => role.id !== 'member').sort((left, right) => Number(right.position || 0) - Number(left.position || 0))[0] || roleById('member');
    hostedSocket?.emit?.('request-room-presence');
    renderMemberDirectory();
    setMemberRoleAutosaveStatus('');
  };
  const closeMemberDirectory = () => $('server-members-modal').classList.add('hidden');
  const paintMemberDetailAvatar = (member) => {
    const target = $('server-member-detail-avatar');
    const image = typeof safeAvatar === 'function' ? safeAvatar(member?.avatar) : '';
    target.textContent = image ? '' : String(member?.name || '?').trim().slice(0, 1).toUpperCase();
    target.style.backgroundColor = safeMemberColor(member);
    target.style.backgroundImage = image ? `url('${image}')` : '';
  };
  const renderMemberDetail = (preferredAction = '') => {
    const member = memberById(memberDirectoryTargetId);
    $('server-member-detail-empty').classList.toggle('hidden', Boolean(member));
    $('server-member-detail-content').classList.toggle('hidden', !member);
    if (!member) return;
    paintMemberDetailAvatar(member);
    $('server-member-detail-name').textContent = member.name || 'Participante';
    $('server-member-detail-role').textContent = member.primaryRole?.name || 'Membro';
    $('server-member-detail-role').style.color = member.primaryRole?.color || 'var(--muted)';
    $('server-member-detail-channel').textContent = member.voiceChannel ? `Na call · ${member.voiceChannel}` : 'Fora da call';
    const actions = availableMemberActions(member);
    const moveAction = actions.find((action) => action.id === 'move' && !action.disabled);
    const roleAction = actions.find((action) => action.id === 'roles');
    const moderationAction = actions.find((action) => action.id === 'moderate' && !action.disabled);
    $('member-detail-move').classList.toggle('hidden', !moveAction);
    $('member-detail-roles').classList.toggle('hidden', !roleAction || roleAction.disabled);
    $('member-detail-moderation').classList.toggle('hidden', !moderationAction);
    const notices = [];
    if (!actions.some((action) => !action.disabled)) notices.push('Seu cargo pode ver esta pessoa, mas não pode gerenciá-la por causa da hierarquia ou das permissões atuais.');
    if (roleAction?.disabled) notices.push('Este Client ainda não possui identidade protegida; cargos persistentes não podem ser atribuídos.');
    const notice = $('server-member-detail-notice');
    notice.textContent = notices.join(' ');
    notice.classList.toggle('hidden', !notices.length);
    if (moveAction) {
      const select = $('member-detail-move-channel');
      select.innerHTML = voiceOptions();
      const current = member.voiceChannel || LOBBY_CHANNEL;
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    }
    if (roleAction && !roleAction.disabled) {
      const selected = memberRoleIds(member);
      const assignable = roles().filter((role) => role.id !== 'member' && manageableRole(role));
      $('member-detail-role-choices').innerHTML = assignable.map((role) => `<label><input type="checkbox" value="${escapeHtml(role.id)}"${selected.has(role.id) ? ' checked' : ''}>${badge(role)}</label>`).join('') || '<small>Não há cargos abaixo do seu nível para atribuir.</small>';
      $('member-detail-role-choices').querySelectorAll('input[type="checkbox"]').forEach((input) => { input.onchange = () => void saveMemberRolesImmediately(); });
      setMemberRoleAutosaveStatus('');
    }
    document.querySelectorAll('.member-detail-tool').forEach((tool) => tool.classList.remove('member-detail-context-focus'));
    const preferred = { move: 'member-detail-move', roles: 'member-detail-roles', moderate: 'member-detail-moderation' }[preferredAction];
    if (preferred && !$(preferred).classList.contains('hidden')) {
      $(preferred).classList.add('member-detail-context-focus');
      window.setTimeout(() => $(preferred)?.classList.remove('member-detail-context-focus'), 1500);
    }
  };
  const renderMemberDirectory = (preferredAction = '') => {
    const query = String($('server-members-search').value || '').trim().toLocaleLowerCase('pt-BR');
    const allMembers = memberDirectoryMembers();
    const visibleMembers = allMembers.filter((member) => !query || `${member.name || ''} ${member.primaryRole?.name || ''} ${member.voiceChannel || ''}`.toLocaleLowerCase('pt-BR').includes(query));
    if (!visibleMembers.some((member) => member.id === memberDirectoryTargetId)) memberDirectoryTargetId = visibleMembers.find((member) => canManageMemberFromClient(member.id))?.id || visibleMembers[0]?.id || '';
    $('server-members-list').innerHTML = visibleMembers.length ? visibleMembers.map((member) => {
      const primary = member.primaryRole || (member.roles || []).find((role) => role.id !== 'member') || roleById('member');
      const actionable = canManageMemberFromClient(member.id);
      const selected = member.id === memberDirectoryTargetId;
      return `<button type="button" role="option" data-member-directory-id="${escapeHtml(member.id)}" class="server-member-directory-row${selected ? ' active' : ''}${actionable ? '' : ' restricted'}" aria-selected="${selected ? 'true' : 'false'}">${memberAvatar(member, 'server-member-directory-avatar')}<span><strong>${escapeHtml(member.name || 'Participante')}</strong><small>${escapeHtml(member.voiceChannel ? `Na call · ${member.voiceChannel}` : 'Fora da call')}</small></span><em style="--role-color:${escapeHtml(primary?.color || '#8792a8')}"><i></i>${escapeHtml(primary?.name || 'Membro')}</em>${actionable ? '<b aria-hidden="true">›</b>' : '<b class="lock" aria-label="Sem permissão">•</b>'}</button>`;
    }).join('') : '<div class="server-members-list-empty">Nenhum membro encontrado.</div>';
    renderMemberDetail(preferredAction);
  };
  const openMemberDirectory = (memberId = '', preferredAction = '') => {
    if (currentMode !== 'hosted' || !hostedSocket?.connected || !['manageRoles', 'moveMembers', 'moderateMembers'].some(allowed)) return;
    const requested = memberById(memberId);
    if (requested && requested.id !== hostedSocket?.id && !requested.isBot) memberDirectoryTargetId = requested.id;
    closeMemberManagement();
    $('server-management-modal').classList.add('hidden');
    $('server-members-modal').classList.remove('hidden');
    renderMemberDirectory(preferredAction);
    const focusTarget = { move: 'member-detail-move-channel', roles: 'member-detail-role-choices', moderate: 'member-detail-moderation-action' }[preferredAction];
    window.setTimeout(() => (focusTarget ? $(focusTarget) : $('server-members-search'))?.focus?.({ preventScroll: true }), 80);
  };
  const scheduleDecorate = () => {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => { decorateQueued = false; decorateMemberRoles(); decorateMemberDragging(); decorateMemberManagement(); renderMemberSelection(); refreshManageButton(); });
  };
  const decorateOne = (container, memberId, nameElement) => {
    const member = memberId === 'self' ? currentMembers().find((entry) => entry.id === hostedSocket?.id) : serverMembers.get(memberId);
    const ownRole = memberId === 'self' ? (access.roles || []).find((role) => role.id !== 'member') : null;
    const primary = member?.primaryRole || (member?.roles || []).find((role) => role.id !== 'member') || ownRole;
    const key = primary?.id || '';
    if (container.dataset.voiceupRole === key) return;
    container.dataset.voiceupRole = key;
    container.querySelector('.voiceup-role-stack')?.remove();
    nameElement?.style.removeProperty('color');
    if (!primary || primary.id === 'member') return;
    if (nameElement) nameElement.style.color = primary.color;
    nameElement?.insertAdjacentHTML('beforeend', `<span class="voiceup-role-stack" title="Cargo: ${escapeHtml(primary.name)}"><i style="--role-color:${escapeHtml(primary.color)}"></i></span>`);
  };
  const decorateMemberRoles = () => {
    try {
      document.querySelectorAll('.channel-member[data-member-id]').forEach((element) => decorateOne(element, element.dataset.memberId, element.querySelector('.channel-member-name')));
      document.querySelectorAll('.server-member[data-member-id]').forEach((element) => decorateOne(element, element.dataset.memberId, element.querySelector('strong')));
      document.querySelectorAll('.call-member[data-call-member]').forEach((element) => decorateOne(element, element.dataset.callMember, element.querySelector('.call-member-caption strong')));
    } catch { /* servidores antigos continuam sem decoração de cargos */ }
  };

  const dragSources = () => document.querySelectorAll('.channel-member[data-member-id], .server-member[data-member-id]');
  const dropTargets = () => document.querySelectorAll('#room-channels .voice-channel[data-voice-channel], #room-channels [data-voice-drop-channel]');
  const sourceMemberId = (element) => String(element?.dataset?.memberId || '');
  const targetVoiceChannel = (element) => String(element?.dataset?.voiceDropChannel || element?.dataset?.voiceChannel || '');
  const selectedMovableMemberIds = () => [...selectedMemberIds].filter(canDragMember);
  const renderMemberSelection = () => {
    for (const id of [...selectedMemberIds]) if (!canDragMember(id)) selectedMemberIds.delete(id);
    const ids = selectedMovableMemberIds();
    const chosen = new Set(ids);
    dragSources().forEach((element) => {
      const selected = chosen.has(sourceMemberId(element));
      element.classList.toggle('voiceup-member-selected', selected);
      if (canDragMember(sourceMemberId(element))) element.setAttribute('aria-selected', selected ? 'true' : 'false');
      else element.removeAttribute('aria-selected');
    });
    const toolbar = $('member-multi-select-toolbar');
    toolbar.classList.toggle('hidden', ids.length === 0);
    document.body.classList.toggle('voiceup-member-selection-active', ids.length > 0);
    if (!ids.length) return;
    const members = ids.map(memberById).filter(Boolean);
    $('member-multi-select-count').textContent = `${ids.length} ${ids.length === 1 ? 'membro selecionado' : 'membros selecionados'}`;
    const names = members.map((member) => member.name || 'Participante');
    $('member-multi-select-names').textContent = `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` · +${names.length - 3}` : ''}`;
    const options = voiceOptions();
    const destination = $('member-multi-select-destination');
    if (destination.innerHTML !== options) {
      const previous = destination.value;
      destination.innerHTML = options;
      if ([...destination.options].some((option) => option.value === previous)) destination.value = previous;
    }
    destination.disabled = bulkMovePending;
    $('member-multi-select-move').disabled = bulkMovePending;
    $('member-multi-select-clear').disabled = bulkMovePending;
    toolbar.setAttribute('aria-busy', bulkMovePending ? 'true' : 'false');
  };
  const clearMemberSelection = () => {
    selectedMemberIds.clear();
    renderMemberSelection();
  };
  const toggleMemberSelection = (memberId) => {
    if (bulkMovePending || !canDragMember(memberId)) return false;
    if (selectedMemberIds.has(memberId)) selectedMemberIds.delete(memberId);
    else selectedMemberIds.add(memberId);
    renderMemberSelection();
    return true;
  };
  const ensureLobbyDropTarget = () => {
    const panel = $('room-channels');
    const existing = panel?.querySelector('[data-voice-drop-channel]');
    const enabled = currentMode === 'hosted' && Boolean(hostedSocket?.connected) && allowed('moveMembers');
    if (!enabled) { existing?.remove(); return; }
    if (!panel || existing) return;
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'voiceup-lobby-drop-target';
    target.dataset.voiceDropChannel = LOBBY_CHANNEL;
    target.innerHTML = '<span aria-hidden="true">↙</span><b>Fora da call</b><small>Solte aqui para remover da chamada</small>';
    const textHeading = panel.querySelectorAll(':scope > h3')[1];
    panel.insertBefore(target, textHeading || null);
  };
  const clearDragState = () => {
    draggedMemberIds = [];
    delete document.body.dataset.voiceupDragCount;
    document.body.classList.remove('voiceup-member-drag-active');
    document.querySelectorAll('.voiceup-member-dragging').forEach((element) => element.classList.remove('voiceup-member-dragging'));
    dropTargets().forEach((element) => {
      element.classList.remove('voiceup-drop-target', 'voiceup-drop-over', 'voiceup-drop-unavailable');
      element.removeAttribute('aria-dropeffect');
      delete element.dataset.voiceupDropCount;
    });
  };
  const isValidDrop = (target, memberIds = draggedMemberIds) => {
    const ids = (Array.isArray(memberIds) ? memberIds : [memberIds]).filter(canDragMember);
    if (!target || !ids.length) return false;
    const channel = targetVoiceChannel(target);
    if (channel !== LOBBY_CHANNEL && !ROOM_CHANNELS.voice.includes(channel)) return false;
    const normalizedChannel = channel === LOBBY_CHANNEL ? '' : channel;
    return ids.some((memberId) => String(memberById(memberId)?.voiceChannel || '') !== normalizedChannel);
  };
  const decorateMemberDragging = () => {
    ensureLobbyDropTarget();
    dragSources().forEach((element) => {
      const enabled = canDragMember(sourceMemberId(element));
      element.draggable = enabled;
      element.classList.toggle('voiceup-member-draggable', enabled);
      if (enabled) {
        if (!Object.prototype.hasOwnProperty.call(element.dataset, 'voiceupOriginalTitle')) element.dataset.voiceupOriginalTitle = element.getAttribute('title') || '';
        const original = element.dataset.voiceupOriginalTitle;
        element.title = `${original ? `${original} · ` : ''}Arraste para mover · Ctrl + clique para selecionar vários`;
        element.setAttribute('aria-roledescription', 'participante arrastável');
      } else {
        if (Object.prototype.hasOwnProperty.call(element.dataset, 'voiceupOriginalTitle')) {
          const original = element.dataset.voiceupOriginalTitle;
          if (original) element.title = original; else element.removeAttribute('title');
          delete element.dataset.voiceupOriginalTitle;
        }
        element.removeAttribute('aria-roledescription');
      }
    });
    if (draggedMemberIds.length && !draggedMemberIds.some(canDragMember)) clearDragState();
  };

  const memberManagementSources = () => document.querySelectorAll('.channel-member[data-member-id], .server-member[data-member-id]');
  const closeMemberManagement = () => {
    memberMenuTargetId = '';
    $('member-management-popover').classList.add('hidden');
  };
  const paintMemberManagementAvatar = (member) => {
    const target = $('member-management-avatar');
    const image = typeof safeAvatar === 'function' ? safeAvatar(member.avatar) : '';
    target.textContent = image ? '' : String(member.name || '?').trim().slice(0, 1).toUpperCase();
    target.style.backgroundColor = /^#[a-f0-9]{6}$/i.test(String(member.color || '')) ? member.color : '#56e2cf';
    target.style.backgroundImage = image ? `url('${image}')` : '';
  };
  const positionMemberManagement = (anchor) => {
    const popover = $('member-management-popover');
    const box = anchor.getBoundingClientRect();
    popover.classList.remove('hidden');
    const width = popover.offsetWidth || 310;
    const height = popover.offsetHeight || 230;
    let left = box.right + 9;
    let top = box.top + box.height / 2 - height / 2;
    if (left + width > innerWidth - 10) left = box.left - width - 9;
    if (left < 10) left = box.left + box.width / 2 - width / 2;
    left = Math.max(10, Math.min(innerWidth - width - 10, left));
    top = Math.max(10, Math.min(innerHeight - height - 10, top));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };
  const openMemberManagement = (memberId, anchor) => {
    const member = memberById(memberId);
    const actions = availableMemberActions(member);
    if (!member || !actions.length || !actions.some((action) => !action.disabled)) return false;
    memberMenuTargetId = member.id;
    paintMemberManagementAvatar(member);
    $('member-management-name').textContent = member.name || 'Participante';
    $('member-management-role').textContent = member.primaryRole?.name || 'Membro';
    $('member-management-role').style.color = member.primaryRole?.color || 'var(--muted)';
    $('member-management-actions').innerHTML = actions.map((action) => `<button type="button" data-member-management-action="${action.id}" class="${action.danger ? 'danger' : ''}"${action.disabled ? ' disabled aria-disabled="true"' : ''}><i aria-hidden="true">${action.icon}</i><span><b>${escapeHtml(action.label)}</b><small>${escapeHtml(action.detail)}</small></span><em>›</em></button>`).join('');
    positionMemberManagement(anchor);
    $('member-management-actions').querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    return true;
  };
  const decorateMemberManagement = () => {
    memberManagementSources().forEach((element) => {
      const enabled = canManageMemberFromClient(sourceMemberId(element));
      element.classList.toggle('voiceup-member-manageable', enabled);
      if (enabled) {
        element.setAttribute('aria-haspopup', 'dialog');
        if (!element.matches('button,[tabindex]')) element.tabIndex = 0;
      } else {
        element.removeAttribute('aria-haspopup');
        if (!element.matches('button') && element.getAttribute('tabindex') === '0') element.removeAttribute('tabindex');
      }
    });
    if (memberMenuTargetId && !canManageMemberFromClient(memberMenuTargetId)) closeMemberManagement();
  };
  const openMemberTool = (action, memberId) => {
    const member = memberById(memberId);
    const permitted = availableMemberActions(member).find((item) => item.id === action && !item.disabled);
    if (!permitted) return;
    openMemberDirectory(memberId, action);
  };

  const moveMembersToChannel = async (memberIds, channel, pendingTarget = null) => {
    if (bulkMovePending) return { ok: false, moved: 0, failed: [] };
    const normalizedChannel = channel === LOBBY_CHANNEL ? '' : channel;
    const uniqueIds = [...new Set(Array.isArray(memberIds) ? memberIds : [memberIds])].filter(canDragMember);
    const alreadyThere = uniqueIds.filter((memberId) => String(memberById(memberId)?.voiceChannel || '') === normalizedChannel);
    const candidates = uniqueIds.filter((memberId) => !alreadyThere.includes(memberId));
    if (!candidates.length) {
      alreadyThere.forEach((memberId) => selectedMemberIds.delete(memberId));
      renderMemberSelection();
      toast(uniqueIds.length > 1 ? 'As pessoas selecionadas já estão nesse destino.' : 'Essa pessoa já está nesse destino.');
      return { ok: true, moved: 0, failed: [] };
    }
    bulkMovePending = true;
    pendingTarget?.classList.add('voiceup-drop-pending');
    renderMemberSelection();
    const moved = [];
    const failed = [];
    for (const memberId of candidates) {
      const result = await socketRequest('admin:move-member', { targetId: memberId, voiceChannel: channel });
      if (result.ok) moved.push(memberId);
      else failed.push({ memberId, message: result.message || 'Movimentação recusada.' });
    }
    bulkMovePending = false;
    pendingTarget?.classList.remove('voiceup-drop-pending');
    [...moved, ...alreadyThere].forEach((memberId) => selectedMemberIds.delete(memberId));
    renderMemberSelection();
    if (moved.length && hostedSocket?.connected) hostedSocket.emit('request-room-presence');
    if (!failed.length) toast(moved.length === 1 ? 'Participante movido.' : `${moved.length} participantes movidos.`);
    else toast(`${moved.length ? `${moved.length} movido(s) · ` : ''}${failed.length} não puderam ser movidos. ${failed[0].message}`);
    return { ok: failed.length === 0, moved: moved.length, failed };
  };

  document.addEventListener('dragstart', (event) => {
    const source = event.target?.closest?.('.channel-member[data-member-id], .server-member[data-member-id]');
    const memberId = sourceMemberId(source);
    if (bulkMovePending || !source || !canDragMember(memberId)) { event.preventDefault(); return; }
    closeMemberManagement();
    suppressMemberClickUntil = Date.now() + 1000;
    if (!selectedMemberIds.has(memberId) && selectedMemberIds.size) clearMemberSelection();
    draggedMemberIds = selectedMemberIds.has(memberId) ? selectedMovableMemberIds() : [memberId];
    const dragged = new Set(draggedMemberIds);
    dragSources().forEach((element) => element.classList.toggle('voiceup-member-dragging', dragged.has(sourceMemberId(element))));
    document.body.dataset.voiceupDragCount = String(draggedMemberIds.length);
    document.body.classList.add('voiceup-member-drag-active');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-voiceup-members', JSON.stringify(draggedMemberIds));
      event.dataTransfer.setData('application/x-voiceup-member', memberId);
      event.dataTransfer.setData('text/plain', draggedMemberIds.join(','));
    } catch { /* o id confiável permanece somente na memória desta janela */ }
    dropTargets().forEach((target) => {
      const valid = isValidDrop(target, draggedMemberIds);
      target.classList.toggle('voiceup-drop-target', valid);
      target.classList.toggle('voiceup-drop-unavailable', !valid);
      if (valid) {
        target.setAttribute('aria-dropeffect', 'move');
        target.dataset.voiceupDropCount = String(draggedMemberIds.length);
      }
    });
  });
  document.addEventListener('dragover', (event) => {
    const target = event.target?.closest?.('#room-channels .voice-channel[data-voice-channel], #room-channels [data-voice-drop-channel]');
    if (!isValidDrop(target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTargets().forEach((element) => element.classList.toggle('voiceup-drop-over', element === target));
  });
  document.addEventListener('dragleave', (event) => {
    const target = event.target?.closest?.('#room-channels .voice-channel[data-voice-channel], #room-channels [data-voice-drop-channel]');
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('voiceup-drop-over');
  });
  document.addEventListener('drop', async (event) => {
    const target = event.target?.closest?.('#room-channels .voice-channel[data-voice-channel], #room-channels [data-voice-drop-channel]');
    const memberIds = [...draggedMemberIds];
    if (!isValidDrop(target, memberIds)) return;
    event.preventDefault();
    event.stopPropagation();
    const channel = targetVoiceChannel(target);
    clearDragState();
    await moveMembersToChannel(memberIds, channel, target);
  });
  document.addEventListener('dragend', () => { suppressMemberClickUntil = Date.now() + 250; clearDragState(); });

  document.addEventListener('click', (event) => {
    if (Date.now() < suppressMemberClickUntil || event.target.closest?.('#member-management-popover, #server-management-modal, #server-members-modal')) return;
    if (event.target.closest?.('.hosted-mute, .participant-mute, .media-live-badge, a, input, select, textarea')) return;
    const source = event.target.closest?.('.channel-member[data-member-id], .server-member[data-member-id]');
    const memberId = sourceMemberId(source);
    if (source && (event.ctrlKey || event.metaKey) && canDragMember(memberId)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMemberManagement();
      toggleMemberSelection(memberId);
      return;
    }
    if (!source || !canManageMemberFromClient(memberId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (selectedMemberIds.size) clearMemberSelection();
    try { closeParticipantAudio(); } catch { /* interface de áudio pode não existir em Clients antigos */ }
    if (memberMenuTargetId === memberId && !$('member-management-popover').classList.contains('hidden')) closeMemberManagement();
    else openMemberManagement(memberId, source);
  }, true);
  document.addEventListener('click', (event) => {
    if (!$('member-management-popover').classList.contains('hidden') && !event.target.closest('#member-management-popover')) closeMemberManagement();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedMemberIds.size) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearMemberSelection();
      return;
    }
    if (event.key === 'Escape') closeMemberManagement();
    if (!['Enter', ' '].includes(event.key)) return;
    const source = event.target.closest?.('.channel-member[data-member-id], .server-member[data-member-id]');
    const memberId = sourceMemberId(source);
    if (source && (event.ctrlKey || event.metaKey) && canDragMember(memberId)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMemberManagement();
      toggleMemberSelection(memberId);
      return;
    }
    if (!source || !canManageMemberFromClient(memberId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (selectedMemberIds.size) clearMemberSelection();
    openMemberManagement(memberId, source);
  }, true);
  $('member-management-close').onclick = closeMemberManagement;
  $('member-management-actions').onclick = (event) => {
    const button = event.target.closest('[data-member-management-action]:not(:disabled)');
    if (button && memberMenuTargetId) openMemberTool(button.dataset.memberManagementAction, memberMenuTargetId);
  };
  $('member-multi-select-clear').onclick = clearMemberSelection;
  $('member-multi-select-move').onclick = () => moveMembersToChannel(selectedMovableMemberIds(), $('member-multi-select-destination').value);
  window.addEventListener('resize', closeMemberManagement);

  window.addEventListener('voiceup-server-access', ({ detail } = {}) => {
    access = detail?.packet || {};
    window.voiceupCurrentServerAccess = access;
    refreshManageButton();
    if (!$('server-management-modal').classList.contains('hidden')) refreshModal();
    if (!$('server-members-modal').classList.contains('hidden')) renderMemberDirectory();
    scheduleDecorate();
  });
  window.addEventListener('voiceup-room-layout', () => {
    if (!$('server-management-modal').classList.contains('hidden') && selectedSettingsSection === 'channels') renderChannelManager();
    if (!$('server-members-modal').classList.contains('hidden')) renderMemberDetail();
  });
  window.addEventListener('voiceup-room-presence', () => { if (!$('server-members-modal').classList.contains('hidden')) renderMemberDirectory(); });
  new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });

  manageButton.onclick = () => { closeMemberDirectory(); refreshModal(); $('server-management-modal').classList.remove('hidden'); };
  membersButton.onclick = () => openMemberDirectory();
  $('server-management-close').onclick = () => $('server-management-modal').classList.add('hidden');
  $('server-management-modal').onclick = (event) => { if (event.target === $('server-management-modal')) $('server-management-modal').classList.add('hidden'); };
  $('server-management-nav').onclick = (event) => {
    const button = event.target.closest('[data-server-settings-view]:not(.hidden)');
    if (button) applySettingsSection(button.dataset.serverSettingsView);
  };
  $('server-members-close').onclick = closeMemberDirectory;
  $('server-members-modal').onclick = (event) => { if (event.target === $('server-members-modal')) closeMemberDirectory(); };
  $('server-members-search').oninput = () => renderMemberDirectory();
  $('server-members-list').onclick = (event) => {
    const row = event.target.closest('[data-member-directory-id]');
    if (!row) return;
    memberDirectoryTargetId = row.dataset.memberDirectoryId;
    renderMemberDirectory();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('channel-editor-modal').classList.contains('hidden')) closeChannelEditor();
    else if (!$('server-members-modal').classList.contains('hidden')) closeMemberDirectory();
    else $('server-management-modal').classList.add('hidden');
  });
  $('admin-role-select').onchange = () => loadRoleForm($('admin-role-select').value);
  $('admin-refresh-audit').onclick = refreshAudit;
  $('admin-save-server-settings').onclick = async () => {
    const result = await runAction($('admin-save-server-settings'), 'admin:update-server-settings', { chatPolicy: { cooldownSeconds: Number($('admin-server-cooldown').value), pluginMessageMaxLength: Number($('admin-server-plugin-limit').value) } });
    if (result.ok && result.chatPolicy) access.serverSettings = { ...(access.serverSettings || {}), chatPolicy: result.chatPolicy };
  };
  $('admin-add-voice-channel').onclick = () => openChannelEditor('voice');
  $('admin-add-stage-channel').onclick = () => openChannelEditor('voice', null, 'stage');
  $('admin-add-dynamic-channel').onclick = () => openChannelEditor('voice', null, 'dynamic');
  $('admin-add-text-channel').onclick = () => openChannelEditor('text');
  $('admin-add-forum-channel').onclick = () => openChannelEditor('text', null, 'forum');
  $('admin-channel-list').onclick = (event) => {
    const button = event.target.closest('[data-configure-channel]');
    if (!button) return;
    const channel = roomChannelSettings(button.dataset.channelType).find((item) => item.name === button.dataset.channelName || item.id === button.dataset.configureChannel);
    if (channel) openChannelEditor(button.dataset.channelType, channel);
  };
  $('channel-editor-close').onclick = closeChannelEditor;
  $('channel-editor-cancel').onclick = closeChannelEditor;
  $('channel-editor-modal').onclick = (event) => { if (event.target === $('channel-editor-modal')) closeChannelEditor(); };
  $('admin-channel-everyone').onclick = () => $('admin-channel-role-choices').querySelectorAll('input:checked').forEach((input) => { input.checked = false; });
  $('admin-save-channel').onclick = async () => {
    if (!editedChannel) return;
    const payload = channelEditorPayload();
    if (!editedChannel.name && !payload.name) return toast('Informe o nome do canal.');
    const event = editedChannel.name ? 'admin:update-channel' : 'admin:create-channel';
    const result = await runAction($('admin-save-channel'), event, payload);
    if (!result.ok) return;
    if (result.layout && typeof applyHostedRoomLayout === 'function') applyHostedRoomLayout(result.layout);
    closeChannelEditor();
    renderChannelManager();
  };
  $('admin-delete-channel').onclick = async () => {
    if (!editedChannel?.name) return;
    const button = $('admin-delete-channel');
    if (!button.dataset.confirming) {
      button.dataset.confirming = 'true'; button.textContent = 'Confirmar exclusão';
      return toast('Clique novamente para remover este canal. A mudança será salva automaticamente.');
    }
    const result = await runAction(button, 'admin:delete-channel', { type: editedChannel.type, channelId: editedChannel.id, channelName: editedChannel.name });
    if (!result.ok) { delete button.dataset.confirming; button.textContent = 'Excluir canal'; return; }
    if (result.layout && typeof applyHostedRoomLayout === 'function') applyHostedRoomLayout(result.layout);
    closeChannelEditor(); renderChannelManager();
  };
  $('member-detail-move-submit').onclick = async () => {
    const member = memberById(memberDirectoryTargetId);
    if (!member || !availableMemberActions(member).some((action) => action.id === 'move' && !action.disabled)) return;
    const voiceChannel = $('member-detail-move-channel').value;
    const result = await runAction($('member-detail-move-submit'), 'admin:move-member', { targetId: member.id, voiceChannel });
    if (result.ok) {
      member.voiceChannel = voiceChannel === LOBBY_CHANNEL ? '' : voiceChannel;
      hostedSocket?.emit?.('request-room-presence');
      renderMemberDirectory();
    }
  };
  const syncMemberModerationForm = () => {
    const kick = $('member-detail-moderation-action').value === 'kick';
    $('member-detail-moderation-duration').closest('label').classList.toggle('hidden', kick);
    const button = $('member-detail-moderation-submit');
    delete button.dataset.confirming;
    button.textContent = 'Confirmar moderação';
  };
  $('member-detail-moderation-action').onchange = syncMemberModerationForm;
  $('member-detail-moderation-submit').onclick = async () => {
    const member = memberById(memberDirectoryTargetId);
    if (!member || !availableMemberActions(member).some((item) => item.id === 'moderate' && !item.disabled)) return;
    const button = $('member-detail-moderation-submit');
    const action = $('member-detail-moderation-action').value;
    if (button.dataset.confirming !== action) {
      button.dataset.confirming = action;
      button.textContent = `Confirmar ${action === 'kick' ? 'expulsão' : action === 'ban' ? 'banimento' : 'castigo'}`;
      window.setTimeout(() => { if (button.dataset.confirming === action) syncMemberModerationForm(); }, 4500);
      return;
    }
    delete button.dataset.confirming;
    button.textContent = 'Aplicando…';
    const result = await runAction(button, 'admin:moderate', { targetId: member.id, action, durationMinutes: Number($('member-detail-moderation-duration').value), reason: $('member-detail-moderation-reason').value.trim() });
    button.textContent = 'Confirmar moderação';
    if (result.ok && ['kick', 'ban'].includes(action)) closeMemberDirectory();
  };
  $('admin-save-role').onclick = async () => {
    const name = $('admin-role-name').value.trim(); if (!name) return toast('Informe o nome do cargo.');
    await runAction($('admin-save-role'), 'admin:save-role', { previousId: selectedRoleId, name, color: $('admin-role-color').value, position: Number($('admin-role-position').value), displaySeparately: $('admin-role-display-separately').checked, permissions: [...$('admin-permission-choices').querySelectorAll('input:checked')].map((input) => input.value) });
  };
  $('admin-delete-role').onclick = async () => {
    if (!selectedRoleId) return;
    const result = await runAction($('admin-delete-role'), 'admin:delete-role', { roleId: selectedRoleId });
    if (result.ok) selectedRoleId = '';
  };
  scheduleDecorate();
})();
