'use strict';

/* Hidden Electron smoke test: no network, camera, microphone or real profile. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-access-ui-'));
const rendererErrors = [];
let window;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (code) => window.webContents.executeJavaScript(code);

app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
setTimeout(() => { console.error(`Access UI timeout. Renderer errors: ${JSON.stringify(rendererErrors)}`); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, partition: 'access-ui-test' }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') rendererErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  await runtimeReady;

  await evaluate(`(() => {
    document.querySelector('#welcome').classList.add('hidden');
    document.querySelector('#app').classList.remove('hidden');
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    document.body.classList.remove('beta-welcome-open');
    currentMode = 'hosted'; activeVoiceChannel = 'Geral'; myName = 'Dona';
    applyHostedRoomLayout({
      id: 'equipe', name: 'Equipe',
      voiceChannels: ['Geral', 'Jogando', 'Ausente'],
      textChannels: ['geral', 'conversa', 'avisos'],
      voiceChannelSettings: [
        { id: 'geral', name: 'Geral', type: 'voice', position: 0, category: 'Comunidade', userLimit: 0, bitrateKbps: 64, region: 'auto', locked: false, visibleRoleIds: [] },
        { id: 'jogando', name: 'Jogando', type: 'voice', position: 1, category: 'Comunidade', userLimit: 8, bitrateKbps: 96, region: 'brazil', locked: false, visibleRoleIds: [] },
        { id: 'ausente', name: 'Ausente', type: 'voice', position: 2, category: '', userLimit: 12, bitrateKbps: 64, region: 'auto', locked: false, visibleRoleIds: [] }
      ],
      textChannelSettings: [
        { id: 'geral', name: 'geral', type: 'text', position: 0, category: 'Comunidade', topic: '', slowModeSeconds: 0, readOnly: false, visibleRoleIds: [] },
        { id: 'conversa', name: 'conversa', type: 'text', position: 1, category: 'Comunidade', topic: '', slowModeSeconds: 0, readOnly: false, visibleRoleIds: [] },
        { id: 'avisos', name: 'avisos', type: 'text', position: 2, category: '', topic: 'Novidades', slowModeSeconds: 10, readOnly: true, visibleRoleIds: ['admin'] }
      ]
    });
    window.adminPackets = [];
    hostedSocket = { id: 'access-self', connected: true, on() {}, emit(event, payload, callback) {
      window.adminPackets.push({ event, payload });
      if (event === 'admin:get-audit') callback?.({ ok: true, entries: [{ id: 'audit-1', at: new Date().toISOString(), action: 'channel.created', outcome: 'allowed', actor: { name: 'Dona' }, target: { channel: 'Equipe' } }] });
      else if (event === 'admin:update-server-settings') callback?.({ ok: true, message: 'Configurações atualizadas.', chatPolicy: payload.chatPolicy });
      else if (event === 'admin:move-member') {
        const member = serverMembers.get(payload.targetId);
        if (member) member.voiceChannel = payload.voiceChannel === '__lobby__' ? '' : payload.voiceChannel;
        callback?.({ ok: true, message: 'Alteração aplicada.' });
      }
      else callback?.({ ok: true, message: 'Alteração aplicada.' });
    } };
    serverMembers.clear();
    serverMembers.set('access-self', { id: 'access-self', clientId: 'owner', name: 'Dona', identityVerified: true, voiceChannel: 'Geral', primaryRole: { id: 'admin', name: 'Administrador', color: '#ff7188', position: 100 }, roles: [{ id: 'admin', name: 'Administrador', color: '#ff7188', position: 100 }] });
    serverMembers.set('admin-target', { id: 'admin-target', clientId: 'admin-2', name: 'Outro admin', identityVerified: true, voiceChannel: 'Geral', primaryRole: { id: 'admin', name: 'Administrador', color: '#ff7188', position: 100 }, roles: [{ id: 'admin', name: 'Administrador', color: '#ff7188', position: 100 }] });
    serverMembers.set('member-target', { id: 'member-target', clientId: 'member-1', name: 'Pessoa', identityVerified: true, voiceChannel: 'Geral', primaryRole: { id: 'organizer', name: 'Organizador', color: '#12abef', position: 25 }, roles: [{ id: 'organizer', name: 'Organizador', color: '#12abef', position: 25 }] });
    serverMembers.set('member-target-2', { id: 'member-target-2', clientId: 'member-2', name: 'Outra pessoa', identityVerified: true, voiceChannel: 'Jogando', primaryRole: { id: 'member', name: 'Membro', color: '#8792a8', position: 0 }, roles: [{ id: 'member', name: 'Membro', color: '#8792a8', position: 0 }] });
    renderRoomChannels(); renderCentralCallMembers?.();
    const definitions = [
      { id: 'manageServer', label: 'Configurar servidor', description: 'Editar configurações.' },
      { id: 'manageRoles', label: 'Gerenciar cargos', description: 'Editar cargos.' },
      { id: 'manageChannels', label: 'Criar canais', description: 'Criar canais.' },
      { id: 'moveMembers', label: 'Mover pessoas', description: 'Mover pessoas.' },
      { id: 'moderateMembers', label: 'Moderar', description: 'Moderar pessoas.' },
      { id: 'viewAuditLog', label: 'Ver auditoria', description: 'Consultar registros.' }
    ];
    const availableRoles = [
      { id: 'admin', name: 'Administrador', color: '#ff7188', position: 100, protected: true, permissions: definitions.map((item) => item.id) },
      { id: 'manager', name: 'Gerente', color: '#f0a842', position: 60, permissions: ['manageRoles', 'moveMembers'] },
      { id: 'organizer', name: 'Organizador', color: '#12abef', position: 25, permissions: ['manageChannels'] },
      { id: 'member', name: 'Membro', color: '#8792a8', position: 0, protected: true, permissions: [] }
    ];
    window.accessUiFixture = { definitions, availableRoles };
    window.dispatchEvent(new CustomEvent('voiceup-server-access', { detail: { packet: { roleIds: ['admin'], roles: [availableRoles[0]], permissions: definitions.map((item) => item.id), availableRoles, permissionDefinitions: definitions, capabilities: { manageChatPolicy: true }, serverSettings: { chatPolicy: { cooldownSeconds: 5, pluginMessageMaxLength: 3000 } } } } }));
  })()`);
  await pause(350);
  assert.deepEqual(rendererErrors, []);

  let state = await evaluate(`(() => {
    const button = document.querySelector('#server-manage-button');
    return {
      buttonVisible: !button.classList.contains('hidden'),
      roleDot: document.querySelectorAll('.voiceup-role-stack').length,
      memberDraggable: document.querySelector('.channel-member[data-member-id="member-target"]')?.draggable,
      peerAdminDraggable: document.querySelector('.channel-member[data-member-id="admin-target"]')?.draggable,
      peerAdminManageable: document.querySelector('.channel-member[data-member-id="admin-target"]')?.classList.contains('voiceup-member-manageable'),
      lobbyDropTarget: Boolean(document.querySelector('[data-voice-drop-channel="__lobby__"]')),
      voiceDropTargets: document.querySelectorAll('.voice-channel[data-voice-channel]').length
    };
  })()`);
  await pause(250);
  assert.equal(state.buttonVisible, true);
  assert.ok(state.roleDot >= 1, 'Role color was not rendered beside a member name.');
  assert.equal(state.memberDraggable, true, 'Um administrador precisa poder arrastar um membro permitido.');
  assert.equal(state.peerAdminDraggable, false, 'Administradores equivalentes não podem arrastar um ao outro.');
  assert.equal(state.peerAdminManageable, false, 'Administradores equivalentes não podem abrir ações um do outro.');
  assert.equal(state.lobbyDropTarget, true, 'A interface precisa preparar o destino Fora da call.');
  assert.equal(state.voiceDropTargets, 3, 'Todos os canais de voz precisam aceitar soltura quando autorizada.');

  await evaluate(`document.querySelector('.channel-member[data-member-id="member-target"]').click()`);
  await pause(120);
  state = await evaluate(`(() => ({
    popover: !document.querySelector('#member-management-popover').classList.contains('hidden'),
    targetName: document.querySelector('#member-management-name').textContent,
    actions: [...document.querySelectorAll('[data-member-management-action]')].map((button) => ({ id: button.dataset.memberManagementAction, disabled: button.disabled }))
  }))()`);
  assert.equal(state.popover, true, 'Clicar em uma pessoa gerenciável precisa abrir as ações no Client.');
  assert.equal(state.targetName, 'Pessoa');
  assert.deepEqual(state.actions, [{ id: 'move', disabled: false }, { id: 'roles', disabled: false }, { id: 'moderate', disabled: false }]);
  if (process.env.VOICEUP_CAPTURE_ACCESS_UI === '1') {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'member-management-beta3.png'), image.toPNG());
  }
  await evaluate(`document.querySelector('[data-member-management-action="roles"]').click()`);
  await pause(120);
  state = await evaluate(`(() => ({
    membersModal: !document.querySelector('#server-members-modal').classList.contains('hidden'),
    settingsModal: !document.querySelector('#server-management-modal').classList.contains('hidden'),
    selectedMember: document.querySelector('#server-member-detail-name').textContent,
    selectedRow: document.querySelector('.server-member-directory-row.active')?.dataset.memberDirectoryId,
    visibleTools: [...document.querySelectorAll('.member-detail-tool:not(.hidden)')].map((item) => item.id).sort(),
    directoryCount: document.querySelectorAll('.server-member-directory-row').length,
    contextFocused: document.querySelector('#member-detail-roles').classList.contains('member-detail-context-focus'),
    peerAdminRestricted: document.querySelector('[data-member-directory-id="admin-target"]')?.classList.contains('restricted'),
    assignableRoles: [...document.querySelectorAll('#member-detail-role-choices input')].map((item) => item.value)
  }))()`);
  assert.equal(state.membersModal, true, 'A ação sobre uma pessoa precisa abrir a tela exclusiva de membros.');
  assert.equal(state.settingsModal, false, 'Gerenciar uma pessoa não pode abrir as configurações gerais.');
  assert.equal(state.selectedMember, 'Pessoa');
  assert.equal(state.selectedRow, 'member-target', 'A área de membros precisa abrir com a pessoa clicada selecionada.');
  assert.deepEqual(state.visibleTools, ['member-detail-moderation', 'member-detail-move', 'member-detail-roles']);
  assert.equal(state.directoryCount, 3, 'A tela precisa listar os demais membros conectados.');
  assert.equal(state.contextFocused, true, 'A ferramenta escolhida precisa ficar destacada para a pessoa autorizada.');
  assert.equal(state.peerAdminRestricted, true, 'Um Administrador equivalente precisa aparecer bloqueado no diretório.');
  assert.equal(state.assignableRoles.includes('admin'), false, 'O Client não pode oferecer um cargo da mesma posição do operador.');
  if (process.env.VOICEUP_CAPTURE_ACCESS_UI === '1') {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'member-directory-beta7.png'), image.toPNG());
  }
  await evaluate(`(() => {
    const input = document.querySelector('#member-detail-role-choices input[value="organizer"]');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await pause(100);
  state = await evaluate(`({ packet: window.adminPackets.find((item) => item.event === 'admin:assign-roles'), saveButton: Boolean(document.querySelector('#member-detail-role-submit')), status: document.querySelector('#member-detail-role-status')?.textContent.trim() })`);
  assert.deepEqual(state.packet.payload, { targetId: 'member-target', roleIds: [] });
  assert.equal(state.saveButton, false, 'A atribuição de cargos não deve depender de botão Salvar.');
  assert.equal(state.status, '', 'O Client não deve manter uma legenda de autosave depois que a alteração termina.');

  await evaluate(`(() => {
    document.querySelector('#server-members-close').click();
    document.querySelector('#server-manage-button').click();
  })()`);
  await pause(100);
  state = await evaluate(`(() => ({
    settingsModal: !document.querySelector('#server-management-modal').classList.contains('hidden'),
    membersModal: !document.querySelector('#server-members-modal').classList.contains('hidden'),
    nav: [...document.querySelectorAll('[data-server-settings-view]:not(.hidden)')].map((item) => item.dataset.serverSettingsView),
    active: document.querySelector('[data-server-settings-view].active')?.dataset.serverSettingsView,
    visibleTools: [...document.querySelectorAll('[data-server-settings-panel]:not(.hidden)')].map((item) => item.id),
    roleOptions: [...document.querySelector('#admin-role-select').options].map((item) => item.value),
    maxPosition: document.querySelector('#admin-role-position').max
  }))()`);
  assert.equal(state.settingsModal, true);
  assert.equal(state.membersModal, false, 'Configurar servidor e gerenciar membros precisam ser superfícies separadas.');
  assert.deepEqual(state.nav, ['overview', 'channels', 'roles', 'audit']);
  assert.equal(state.active, 'overview');
  assert.deepEqual(state.visibleTools, ['server-config-tools']);
  assert.ok(!state.roleOptions.includes('admin'), 'Nem Administradores podem editar um cargo da própria posição.');
  assert.equal(state.maxPosition, '99', 'Um novo cargo precisa ficar estritamente abaixo do maior cargo do operador.');
  if (process.env.VOICEUP_CAPTURE_ACCESS_UI === '1') {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'server-settings-beta7.png'), image.toPNG());
  }
  await evaluate(`(() => { document.querySelector('#admin-server-cooldown').value = '20'; document.querySelector('#admin-server-plugin-limit').value = '4096'; document.querySelector('#admin-save-server-settings').click(); })()`);
  await pause(100);
  state = await evaluate(`window.adminPackets.find((packet) => packet.event === 'admin:update-server-settings')`);
  assert.deepEqual(state.payload, { chatPolicy: { cooldownSeconds: 20, pluginMessageMaxLength: 4096 } });

  await evaluate(`(() => { document.querySelector('[data-server-settings-view="channels"]').click(); document.querySelector('#admin-add-voice-channel').click(); })()`);
  await pause(80);
  state = await evaluate(`(() => ({
    modal: !document.querySelector('#channel-editor-modal').classList.contains('hidden'),
    editorDisplay: getComputedStyle(document.querySelector('#channel-editor-modal')).display,
    editorWidth: Math.round(document.querySelector('.channel-editor-dialog').getBoundingClientRect().width),
    voiceVisible: !document.querySelector('#admin-channel-voice-fields').classList.contains('hidden'),
    textHidden: document.querySelector('#admin-channel-text-fields').classList.contains('hidden'),
    roleChoices: [...document.querySelectorAll('#admin-channel-role-choices input')].map((input) => input.value),
    positionOptions: document.querySelector('#admin-channel-position').options.length,
    channelRows: document.querySelectorAll('#admin-channel-list article').length
  }))()`);
  assert.equal(state.modal, true, 'O botão + Voz precisa abrir o editor de canal.');
  assert.equal(state.editorDisplay, 'grid', 'O editor aberto precisa sobrepor a administração.');
  assert.ok(state.editorWidth >= 600, 'O editor precisa ter espaço suficiente para os campos específicos.');
  assert.equal(state.voiceVisible, true);
  assert.equal(state.textHidden, true);
  assert.deepEqual(state.roleChoices, ['admin', 'manager', 'organizer', 'member']);
  assert.equal(state.positionOptions, 4);
  assert.equal(state.channelRows, 6, 'A administração precisa listar voz e texto existentes.');
  if (process.env.VOICEUP_CAPTURE_ACCESS_UI === '1') {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'channel-management-beta4.png'), image.toPNG());
  }
  await evaluate(`(() => {
    document.querySelector('#admin-channel-name').value = 'Reunião';
    document.querySelector('#admin-channel-category').value = 'Equipe';
    document.querySelector('#admin-channel-position').value = '1';
    document.querySelector('#admin-channel-user-limit').value = '6';
    document.querySelector('#admin-channel-bitrate').value = '128';
    document.querySelector('#admin-channel-region').value = 'brazil';
    document.querySelector('#admin-channel-locked').checked = true;
    document.querySelector('#admin-channel-role-choices input[value="organizer"]').checked = true;
    document.querySelector('#admin-save-channel').click();
  })()`);
  await pause(100);
  state = await evaluate(`window.adminPackets.find((packet) => packet.event === 'admin:create-channel')`);
  assert.deepEqual(state.payload, { type: 'voice', channelId: '', channelName: '', name: 'Reunião', category: 'Equipe', position: 1, visibleRoleIds: ['organizer'], kind: 'voice', userLimit: 6, bitrateKbps: 128, region: 'brazil', locked: true });

  await evaluate(`(() => {
    document.querySelector('#admin-channel-list [data-channel-name="avisos"]').click();
    document.querySelector('#admin-channel-topic').value = 'Comunicados oficiais';
    document.querySelector('#admin-channel-slow-mode').value = '45';
    document.querySelector('#admin-channel-read-only').checked = true;
    document.querySelector('#admin-channel-role-choices input[value="admin"]').checked = true;
    document.querySelector('#admin-save-channel').click();
  })()`);
  await pause(100);
  state = await evaluate(`window.adminPackets.find((packet) => packet.event === 'admin:update-channel')`);
  assert.equal(state.payload.channelId, 'avisos');
  assert.equal(state.payload.channelName, 'avisos');
  assert.equal(state.payload.name, 'avisos');
  assert.equal(state.payload.topic, 'Comunicados oficiais');
  assert.equal(state.payload.slowModeSeconds, 45);
  assert.equal(state.payload.readOnly, true);
  assert.deepEqual(state.payload.visibleRoleIds, ['admin']);

  await evaluate(`(() => {
    document.querySelector('#server-management-close').click();
    const source = document.querySelector('.channel-member[data-member-id="member-target"]');
    const target = document.querySelector('.voice-channel[data-voice-channel="Jogando"]');
    const stored = new Map();
    const dataTransfer = {
      effectAllowed: '', dropEffect: '',
      setData(type, value) { stored.set(type, String(value)); },
      getData(type) { return stored.get(type) || ''; }
    };
    const dispatch = (element, type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      element.dispatchEvent(event);
    };
    dispatch(source, 'dragstart');
    dispatch(target, 'dragover');
    dispatch(target, 'drop');
    dispatch(source, 'dragend');
  })()`);
  await pause(320);
  state = await evaluate(`window.adminPackets.find((packet) => packet.event === 'admin:move-member' && packet.payload?.targetId === 'member-target')`);
  assert.deepEqual(state.payload, { targetId: 'member-target', voiceChannel: 'Jogando' });

  await evaluate(`(() => {
    window.adminPackets = [];
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    for (const id of ['member-target', 'member-target-2']) {
      const source = document.querySelector('.channel-member[data-member-id="' + id + '"]');
      source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    }
  })()`);
  await pause(100);
  state = await evaluate(`(() => ({
    toolbar: !document.querySelector('#member-multi-select-toolbar').classList.contains('hidden'),
    count: document.querySelector('#member-multi-select-count').textContent,
    selectedIds: [...new Set([...document.querySelectorAll('.voiceup-member-selected')].map((item) => item.dataset.memberId))].sort(),
    destinationCount: document.querySelector('#member-multi-select-destination').options.length
  }))()`);
  assert.equal(state.toolbar, true, 'Ctrl + clique precisa abrir a barra de seleção múltipla.');
  assert.equal(state.count, '2 membros selecionados');
  assert.deepEqual(state.selectedIds, ['member-target', 'member-target-2']);
  assert.equal(state.destinationCount, 4, 'A seleção múltipla precisa listar Fora da call e todos os canais de voz.');
  if (process.env.VOICEUP_CAPTURE_ACCESS_UI === '1') {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'member-multi-select-beta6-final.png'), image.toPNG());
  }
  await evaluate(`(() => {
    const source = document.querySelector('.channel-member[data-member-id="member-target"]');
    const target = document.querySelector('.voice-channel[data-voice-channel="Ausente"]');
    const stored = new Map();
    const dataTransfer = {
      effectAllowed: '', dropEffect: '',
      setData(type, value) { stored.set(type, String(value)); },
      getData(type) { return stored.get(type) || ''; }
    };
    const dispatch = (element, type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      element.dispatchEvent(event);
    };
    dispatch(source, 'dragstart');
    dispatch(target, 'dragover');
    dispatch(target, 'drop');
    dispatch(source, 'dragend');
  })()`);
  await pause(320);
  state = await evaluate(`(() => ({
    moves: window.adminPackets.filter((packet) => packet.event === 'admin:move-member').map((packet) => packet.payload).sort((a, b) => a.targetId.localeCompare(b.targetId)),
    toolbarHidden: document.querySelector('#member-multi-select-toolbar').classList.contains('hidden'),
    selectedCount: document.querySelectorAll('.voiceup-member-selected').length
  }))()`);
  assert.deepEqual(state.moves, [
    { targetId: 'member-target', voiceChannel: 'Ausente' },
    { targetId: 'member-target-2', voiceChannel: 'Ausente' }
  ], 'Arrastar uma pessoa selecionada precisa mover todo o grupo selecionado.');
  assert.equal(state.toolbarHidden, true, 'Uma movimentação concluída precisa limpar a seleção.');
  assert.equal(state.selectedCount, 0);

  await evaluate(`(() => {
    window.adminPackets = [];
    for (const id of ['member-target', 'member-target-2']) {
      document.querySelector('.channel-member[data-member-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    }
    document.querySelector('#member-multi-select-destination').value = 'Geral';
    document.querySelector('#member-multi-select-move').click();
  })()`);
  await pause(180);
  state = await evaluate(`window.adminPackets.filter((packet) => packet.event === 'admin:move-member').map((packet) => packet.payload).sort((a, b) => a.targetId.localeCompare(b.targetId))`);
  assert.deepEqual(state, [
    { targetId: 'member-target', voiceChannel: 'Geral' },
    { targetId: 'member-target-2', voiceChannel: 'Geral' }
  ], 'O botão Mover da barra precisa aplicar o destino a todas as pessoas selecionadas.');

  await evaluate(`(() => {
    const { definitions, availableRoles } = window.accessUiFixture;
    const manager = availableRoles.find((role) => role.id === 'manager');
    window.dispatchEvent(new CustomEvent('voiceup-server-access', { detail: { packet: { roleIds: ['manager'], roles: [manager], permissions: manager.permissions, availableRoles, permissionDefinitions: definitions } } }));
  })()`);
  await pause(250);
  await evaluate(`document.querySelector('#server-manage-button').click()`);
  await pause(80);
  state = await evaluate(`(() => ({
    roleOptions: [...document.querySelector('#admin-role-select').options].map((item) => item.value),
    maxPosition: document.querySelector('#admin-role-position').max,
    nav: [...document.querySelectorAll('[data-server-settings-view]:not(.hidden)')].map((item) => item.dataset.serverSettingsView),
    visibleTools: [...document.querySelectorAll('[data-server-settings-panel]:not(.hidden)')].map((item) => item.id),
    membersButton: !document.querySelector('#server-members-button').classList.contains('hidden'),
    lowerMemberDraggable: document.querySelector('.channel-member[data-member-id="member-target"]')?.draggable,
    higherMemberDraggable: document.querySelector('.channel-member[data-member-id="admin-target"]')?.draggable
  }))()`);
  assert.ok(!state.roleOptions.includes('admin') && !state.roleOptions.includes('manager'));
  assert.ok(state.roleOptions.includes('organizer'));
  assert.equal(state.maxPosition, '59');
  assert.deepEqual(state.nav, ['roles'], 'Gerente precisa ver somente Cargos nas configurações do servidor.');
  assert.deepEqual(state.visibleTools, ['server-role-tools']);
  assert.equal(state.membersButton, true, 'Gerenciar cargos ou mover pessoas precisa liberar a tela Membros separadamente.');
  assert.equal(state.lowerMemberDraggable, true, 'Gerente pode arrastar somente quem está abaixo na hierarquia.');
  assert.equal(state.higherMemberDraggable, false, 'Gerente não pode arrastar Administrador.');

  await evaluate(`(() => {
    document.querySelector('#server-management-close').click();
    document.querySelector('#server-members-button').click();
  })()`);
  await pause(80);
  state = await evaluate(`(() => ({
    membersModal: !document.querySelector('#server-members-modal').classList.contains('hidden'),
    selectedMember: document.querySelector('.server-member-directory-row.active')?.dataset.memberDirectoryId,
    assignmentTargets: [...document.querySelectorAll('.server-member-directory-row:not(.restricted)')].map((item) => item.dataset.memberDirectoryId).sort(),
    assignableRoles: [...document.querySelectorAll('#member-detail-role-choices input')].map((item) => item.value),
    visibleTools: [...document.querySelectorAll('.member-detail-tool:not(.hidden)')].map((item) => item.id).sort()
  }))()`);
  assert.equal(state.membersModal, true);
  assert.equal(state.selectedMember, 'member-target');
  assert.deepEqual(state.assignmentTargets, ['member-target', 'member-target-2']);
  assert.deepEqual(state.assignableRoles, ['organizer']);
  assert.deepEqual(state.visibleTools, ['member-detail-move', 'member-detail-roles']);

  await evaluate(`document.querySelector('[data-member-directory-id="admin-target"]').click()`);
  await pause(50);
  state = await evaluate(`(() => ({
    selectedMember: document.querySelector('.server-member-directory-row.active')?.dataset.memberDirectoryId,
    visibleTools: document.querySelectorAll('.member-detail-tool:not(.hidden)').length,
    notice: !document.querySelector('#server-member-detail-notice').classList.contains('hidden')
  }))()`);
  assert.equal(state.selectedMember, 'admin-target');
  assert.equal(state.visibleTools, 0, 'Cargo igual ou superior pode aparecer no diretório, mas nunca oferecer ações.');
  assert.equal(state.notice, true);

  await evaluate(`(() => {
    document.querySelector('#server-members-close').click();
    document.querySelector('.channel-member[data-member-id="admin-target"]').click();
  })()`);
  await pause(80);
  state = await evaluate(`(() => ({
    adminManageable: document.querySelector('.channel-member[data-member-id="admin-target"]').classList.contains('voiceup-member-manageable'),
    popover: !document.querySelector('#member-management-popover').classList.contains('hidden')
  }))()`);
  assert.equal(state.adminManageable, false, 'Gerente não pode abrir ações em Administrador.');
  assert.equal(state.popover, false, 'Clicar em cargo superior não pode abrir o gerenciamento.');
  await evaluate(`document.querySelector('.channel-member[data-member-id="member-target"]').click()`);
  await pause(80);
  state = await evaluate(`[...document.querySelectorAll('[data-member-management-action]:not(:disabled)')].map((button) => button.dataset.memberManagementAction)`);
  assert.deepEqual(state, ['move', 'roles'], 'Gerente precisa ver somente as próprias ações permitidas.');
  await evaluate(`document.querySelector('#member-management-close').click()`);

  await evaluate(`(() => {
    const { definitions, availableRoles } = window.accessUiFixture;
    const moderator = { id: 'moderator', name: 'Moderador', color: '#d76cff', position: 50, permissions: ['moderateMembers'] };
    window.dispatchEvent(new CustomEvent('voiceup-server-access', { detail: { packet: { roleIds: ['moderator'], roles: [moderator], permissions: moderator.permissions, availableRoles, permissionDefinitions: definitions } } }));
  })()`);
  await pause(250);
  state = await evaluate(`(() => ({
    settingsButton: !document.querySelector('#server-manage-button').classList.contains('hidden'),
    membersButton: !document.querySelector('#server-members-button').classList.contains('hidden')
  }))()`);
  assert.equal(state.settingsButton, false, 'Moderar pessoas não deve liberar as configurações do servidor.');
  assert.equal(state.membersButton, true, 'Moderadores precisam receber somente a entrada Membros.');
  await evaluate(`(() => {
    window.adminPackets = [];
    document.querySelector('#server-members-button').click();
    document.querySelector('[data-member-directory-id="member-target"]').click();
  })()`);
  await pause(80);
  state = await evaluate(`[...document.querySelectorAll('.member-detail-tool:not(.hidden)')].map((item) => item.id)`);
  assert.deepEqual(state, ['member-detail-moderation']);
  await evaluate(`(() => {
    document.querySelector('#member-detail-moderation-reason').value = 'Teste de segurança';
    document.querySelector('#member-detail-moderation-submit').click();
    document.querySelector('#member-detail-moderation-submit').click();
  })()`);
  await pause(100);
  state = await evaluate(`window.adminPackets.find((packet) => packet.event === 'admin:moderate')`);
  assert.deepEqual(state.payload, { targetId: 'member-target', action: 'punish', durationMinutes: 60, reason: 'Teste de segurança' });

  await evaluate(`(() => {
    const { definitions, availableRoles } = window.accessUiFixture;
    const auditor = { id: 'auditor', name: 'Auditor', color: '#52c8ff', position: 10, permissions: ['viewAuditLog'] };
    window.dispatchEvent(new CustomEvent('voiceup-server-access', { detail: { packet: { roleIds: ['auditor'], roles: [auditor], permissions: auditor.permissions, availableRoles, permissionDefinitions: definitions } } }));
  })()`);
  await pause(250);
  await evaluate(`document.querySelector('#server-manage-button').click()`);
  await pause(80);
  state = await evaluate(`(() => ({
    buttonVisible: !document.querySelector('#server-manage-button').classList.contains('hidden'),
    membersButtonHidden: document.querySelector('#server-members-button').classList.contains('hidden'),
    nav: [...document.querySelectorAll('[data-server-settings-view]:not(.hidden)')].map((item) => item.dataset.serverSettingsView),
    visibleTools: [...document.querySelectorAll('[data-server-settings-panel]:not(.hidden)')].map((item) => item.id),
    auditRows: document.querySelectorAll('#admin-audit-list article').length,
    draggableMembers: document.querySelectorAll('.voiceup-member-draggable').length,
    lobbyDropTarget: Boolean(document.querySelector('[data-voice-drop-channel]'))
  }))()`);
  assert.equal(state.buttonVisible, true, 'Uma pessoa com apenas viewAuditLog precisa conseguir abrir a administração.');
  assert.equal(state.membersButtonHidden, true, 'Auditoria isolada não deve liberar gerenciamento de membros.');
  assert.deepEqual(state.nav, ['audit']);
  assert.deepEqual(state.visibleTools, ['server-audit-tools']);
  assert.equal(state.auditRows, 1);
  assert.equal(state.draggableMembers, 0, 'Sem moveMembers, nenhum participante pode ser arrastado.');
  assert.equal(state.lobbyDropTarget, false, 'Sem moveMembers, o destino de arraste não pode existir.');
  assert.deepEqual(rendererErrors, [], 'The access interface emitted renderer exceptions.');
  console.log('PASS access UI: separate server settings and member directory, permission-scoped moderation, Ctrl multi-selection, secure group drag/drop, role colors, audit-only access and hierarchy filtering.');
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-access-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron may still hold cache files briefly. */ }
  }
  app.exit(process.exitCode || 0);
});
