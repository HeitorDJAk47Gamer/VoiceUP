'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { startSignalingServer, normalizeRoomLayout } = require('../signaling-server');
const { normalizeAccessControl, assignRoles, upsertRole, accessForClient } = require('../server-access-control');

const once = (socket, event, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Tempo esgotado aguardando ${event}`)); }, timeoutMs);
  const handler = (value) => { clearTimeout(timer); resolve(value); };
  socket.once(event, handler);
});
const emitAck = (socket, event, payload, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tempo esgotado aguardando resposta de ${event}`)), timeoutMs);
  socket.emit(event, payload, (value) => { clearTimeout(timer); resolve(value); });
});
const connected = async (url) => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000 });
  await once(socket, 'connect');
  return socket;
};
const legacyJoin = async (socket, clientId, name, voiceChannel = '__lobby__') => {
  const joined = once(socket, 'room-joined');
  socket.emit('join-room', { roomId: 'equipe', voiceChannel, name, clientId });
  return joined;
};
const protectedJoin = async (socket, clientId, name, voiceChannel = '__lobby__') => {
  const challengeEvent = once(socket, 'identity-challenge');
  socket.emit('identity-challenge-request');
  const { challenge } = await challengeEvent;
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = keys.publicKey.export({ format: 'jwk' });
  const proof = crypto.sign('sha256', Buffer.from(`voiceup-identity-v1\n${challenge}\n${socket.id}\nequipe\n${clientId}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const joined = once(socket, 'room-joined');
  const serverAccess = once(socket, 'server-access');
  socket.emit('join-room', { roomId: 'equipe', voiceChannel, name, clientId, capabilities: ['identity-proof-v1', 'server-access-v1'], identityChallenge: challenge, identityPublicKey: publicKey, identityProof: proof });
  await joined;
  return serverAccess;
};

(async () => {
  let model = normalizeAccessControl();
  model = assignRoles(model, 'admin-profile', ['admin'], 'Admin').accessControl;
  model = assignRoles(model, 'admin-peer-profile', ['admin'], 'Outro admin').accessControl;
  assert.ok(accessForClient(model, 'admin-profile').permissions.includes('manageRoles'));
  const custom = upsertRole(model, { name: 'Organizador', color: '#12abef', permissions: ['manageChannels', 'invalid-permission'], position: 25 });
  assert.equal(custom.ok, true);
  assert.deepEqual(custom.role.permissions, ['manageChannels']);
  model = custom.accessControl;
  const managerRole = upsertRole(model, { name: 'Gerente', color: '#f0a842', permissions: ['manageRoles', 'moveMembers'], position: 60 });
  assert.equal(managerRole.ok, true);
  model = assignRoles(managerRole.accessControl, 'manager-profile', [managerRole.role.id], 'Gerente').accessControl;

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-access-'));
  const auditFile = path.join(temporaryDirectory, 'security-audit.json');
  let persistedAccess = null;
  let persistedLayouts = null;
  let persistedChatPolicy = { cooldownSeconds: 0, pluginMessageMaxLength: 2000 };
  const signaling = await startSignalingServer(0, {
    identityFile: path.join(temporaryDirectory, 'identities.json'),
    historyFile: path.join(temporaryDirectory, 'chat.json'),
    reportsFile: path.join(temporaryDirectory, 'reports.json'),
    auditFile,
    accessControl: model,
    roomLayouts: [normalizeRoomLayout({ id: 'equipe', name: 'Equipe', voiceChannels: ['Geral'], textChannels: ['geral'] })],
    pluginDirectories: [], musicDirectory: path.join(temporaryDirectory, 'music'),
    onAccessControlChange: (next) => { persistedAccess = next; },
    onRoomLayoutsChange: (next) => { persistedLayouts = next; },
    chatCooldownSeconds: () => persistedChatPolicy.cooldownSeconds,
    pluginMessageMaxLength: () => persistedChatPolicy.pluginMessageMaxLength,
    onChatPolicyChange: (next) => { persistedChatPolicy = { ...next }; return persistedChatPolicy; }
  });
  const url = `http://127.0.0.1:${signaling.server.address().port}`;
  const sockets = [];
  try {
    const admin = await connected(url); sockets.push(admin);
    const adminAccess = await protectedJoin(admin, 'admin-profile', 'Admin');
    assert.equal(adminAccess.identityVerified, true);
    assert.ok(adminAccess.permissions.includes('manageChannels'));
    assert.equal(adminAccess.capabilities.manageChatPolicy, true);
    assert.deepEqual(adminAccess.serverSettings.chatPolicy, persistedChatPolicy);
    const settingsRefresh = once(admin, 'server-access');
    const configured = await emitAck(admin, 'admin:update-server-settings', { chatPolicy: { cooldownSeconds: 15, pluginMessageMaxLength: 4096 } });
    assert.equal(configured.ok, true);
    assert.deepEqual(persistedChatPolicy, { cooldownSeconds: 15, pluginMessageMaxLength: 4096 });
    assert.deepEqual((await settingsRefresh).serverSettings.chatPolicy, persistedChatPolicy);

    const peerAdmin = await connected(url); sockets.push(peerAdmin);
    const peerAdminAccess = await protectedJoin(peerAdmin, 'admin-peer-profile', 'Outro admin');
    assert.ok(peerAdminAccess.roleIds.includes('admin'));
    const blockedPeerRoleChange = await emitAck(admin, 'admin:assign-roles', { targetId: peerAdmin.id, roleIds: [] });
    assert.equal(blockedPeerRoleChange.ok, false, 'Um Administrador conseguiu remover cargos de outro Administrador equivalente.');
    assert.match(blockedPeerRoleChange.message, /hierarquia/i);
    const blockedPeerMove = await emitAck(admin, 'admin:move-member', { targetId: peerAdmin.id, voiceChannel: 'Geral' });
    assert.equal(blockedPeerMove.ok, false, 'Um Administrador conseguiu mover outro Administrador equivalente.');
    assert.match(blockedPeerMove.message, /hierarquia/i);
    const blockedPeerModeration = await emitAck(admin, 'admin:moderate', { targetId: peerAdmin.id, action: 'punish', durationMinutes: 60, reason: 'Não deve aplicar' });
    assert.equal(blockedPeerModeration.ok, false, 'Um Administrador conseguiu punir outro Administrador equivalente.');
    assert.match(blockedPeerModeration.message, /hierarquia/i);
    const blockedEqualRoleEdit = await emitAck(admin, 'admin:save-role', { previousId: 'admin', name: 'Administrador', color: '#ffffff', position: 100, permissions: ['manageRoles'] });
    assert.equal(blockedEqualRoleEdit.ok, false, 'Um Administrador conseguiu editar um cargo da própria posição.');
    assert.match(blockedEqualRoleEdit.message, /hierarquia/i);

    const legacy = await connected(url); sockets.push(legacy);
    await legacyJoin(legacy, 'legacy-profile', 'Cliente antigo');
    assert.equal(legacy.connected, true, 'Cliente antigo deixou de conseguir entrar.');
    const denied = await emitAck(legacy, 'admin:create-channel', { type: 'voice', name: 'Privado' });
    assert.equal(denied.ok, false);

    const legacyRestrictedLayout = once(legacy, 'room-layout');
    const created = await emitAck(admin, 'admin:create-channel', { type: 'voice', name: 'Equipe', category: 'Staff', position: 0, userLimit: 6, bitrateKbps: 128, region: 'brazil', locked: false, visibleRoleIds: ['moderator'] });
    assert.equal(created.ok, true);
    assert.ok(persistedLayouts?.[0]?.voiceChannels.includes('Equipe'));
    const createdSettings = persistedLayouts[0].voiceChannelSettings.find((channel) => channel.name === 'Equipe');
    assert.deepEqual({ userLimit: createdSettings.userLimit, bitrateKbps: createdSettings.bitrateKbps, region: createdSettings.region, visibleRoleIds: createdSettings.visibleRoleIds }, { userLimit: 6, bitrateKbps: 128, region: 'brazil', visibleRoleIds: ['moderator'] });
    assert.equal((await legacyRestrictedLayout).voiceChannels.includes('Equipe'), false, 'Cargo Membro conseguiu listar um canal restrito a Moderador.');
    const adminEnteredRestricted = once(admin, 'room-joined');
    const redactedPresence = once(legacy, 'room-presence');
    admin.emit('switch-voice-channel', { voiceChannel: 'Equipe' });
    assert.equal((await adminEnteredRestricted).voiceChannel, 'Equipe');
    const redactedAdmin = (await redactedPresence).members.find((entry) => entry.id === admin.id);
    assert.equal(redactedAdmin.voiceChannel, '', 'A presença revelou o nome de uma call restrita.');
    assert.equal(redactedAdmin.hiddenVoiceChannel, true);

    const member = await connected(url); sockets.push(member);
    const memberAccess = await protectedJoin(member, 'member-profile', 'Membro');
    assert.deepEqual(memberAccess.permissions, []);
    const accessRefresh = once(member, 'server-access');
    const moderatorLayoutRefresh = once(member, 'room-layout');
    const assigned = await emitAck(admin, 'admin:assign-roles', { targetId: member.id, roleIds: ['moderator'] });
    assert.equal(assigned.ok, true);
    const refreshed = await accessRefresh;
    assert.ok(refreshed.roleIds.includes('moderator'));
    assert.equal((await moderatorLayoutRefresh).voiceChannels.includes('Equipe'), true, 'O novo cargo não liberou o canal correspondente.');
    assert.ok(persistedAccess.assignments.some((entry) => entry.clientId === 'member-profile'));

    const memberRestrictedAgain = once(member, 'room-layout');
    const updated = await emitAck(admin, 'admin:update-channel', { type: 'voice', channelId: createdSettings.id, category: 'Equipe interna', position: 1, userLimit: 4, bitrateKbps: 96, region: 'auto', locked: true, visibleRoleIds: ['admin'] });
    assert.equal(updated.ok, true);
    const updatedSettings = persistedLayouts[0].voiceChannelSettings.find((channel) => channel.name === 'Equipe');
    assert.deepEqual({ category: updatedSettings.category, position: updatedSettings.position, userLimit: updatedSettings.userLimit, bitrateKbps: updatedSettings.bitrateKbps, locked: updatedSettings.locked, visibleRoleIds: updatedSettings.visibleRoleIds }, { category: 'Equipe interna', position: 1, userLimit: 4, bitrateKbps: 96, locked: true, visibleRoleIds: ['admin'] });
    assert.equal((await memberRestrictedAgain).voiceChannels.includes('Equipe'), false, 'A alteração de acesso do canal não foi reaplicada ao Client conectado.');
    const hiddenVoiceError = once(member, 'app-error');
    member.emit('switch-voice-channel', { voiceChannel: 'Equipe' });
    assert.match(await hiddenVoiceError, /cargo não permite/i);

    const secretText = await emitAck(admin, 'admin:create-channel', { type: 'text', name: 'staff-chat', category: 'Staff', topic: 'Decisões internas', slowModeSeconds: 30, readOnly: true, visibleRoleIds: ['admin'] });
    assert.equal(secretText.ok, true);
    const secretSettings = persistedLayouts[0].textChannelSettings.find((channel) => channel.name === 'staff-chat');
    assert.deepEqual({ topic: secretSettings.topic, slowModeSeconds: secretSettings.slowModeSeconds, readOnly: secretSettings.readOnly, visibleRoleIds: secretSettings.visibleRoleIds }, { topic: 'Decisões internas', slowModeSeconds: 30, readOnly: true, visibleRoleIds: ['admin'] });
    let leakedSecretMessage = false;
    legacy.once('text-message', (packet) => { if (packet?.textChannel === 'staff-chat') leakedSecretMessage = true; });
    const privateMessage = once(admin, 'text-message');
    admin.emit('text-message', { text: 'decisão reservada', textChannel: 'staff-chat' });
    assert.equal((await privateMessage).textChannel, 'staff-chat');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(leakedSecretMessage, false, 'Uma mensagem de canal restrito vazou para outro cargo.');
    const historyOutsider = await connected(url); sockets.push(historyOutsider);
    const outsiderHistory = once(historyOutsider, 'chat-history');
    await legacyJoin(historyOutsider, 'history-outsider', 'Histórico externo');
    assert.equal((await outsiderHistory).messages.some((message) => message.textChannel === 'staff-chat'), false, 'O histórico revelou mensagens de canal restrito.');
    const hiddenTextError = once(member, 'app-error');
    member.emit('text-message', { text: 'tentativa privada', textChannel: 'staff-chat' });
    assert.match(await hiddenTextError, /cargo não permite/i);

    const manager = await connected(url); sockets.push(manager);
    const managerAccess = await protectedJoin(manager, 'manager-profile', 'Gerente');
    assert.ok(managerAccess.permissions.includes('manageRoles'));
    const blockedPromotion = await emitAck(manager, 'admin:assign-roles', { targetId: member.id, roleIds: ['admin'] });
    assert.equal(blockedPromotion.ok, false, 'Um cargo inferior conseguiu atribuir Administrador.');
    assert.match(blockedPromotion.message, /hierarquia/i);
    const blockedAdminEdit = await emitAck(manager, 'admin:save-role', { previousId: 'admin', name: 'Administrador', color: '#ffffff', position: 100, permissions: ['manageRoles'] });
    assert.equal(blockedAdminEdit.ok, false, 'Um cargo inferior conseguiu editar Administrador.');
    const auditView = await emitAck(admin, 'admin:get-audit', {});
    assert.equal(auditView.ok, true);
    assert.ok(auditView.entries.some((entry) => entry.outcome === 'denied' && entry.details?.reason === 'role-hierarchy'));
    const deniedAuditView = await emitAck(manager, 'admin:get-audit', {});
    assert.equal(deniedAuditView.ok, false, 'Um cargo sem viewAuditLog conseguiu consultar a auditoria.');

    const forbiddenCreate = await emitAck(member, 'admin:create-channel', { type: 'text', name: 'segredo' });
    assert.equal(forbiddenCreate.ok, false, 'Moderador recebeu uma permissão que não possui.');
    const moved = once(legacy, 'server-member-moved');
    const moveResult = await emitAck(member, 'admin:move-member', { targetId: legacy.id, voiceChannel: 'Geral' });
    assert.equal(moveResult.ok, true);
    assert.equal((await moved).voiceChannel, 'Geral');

    const moderatorChannel = await emitAck(admin, 'admin:create-channel', { type: 'voice', name: 'Moderadores', visibleRoleIds: ['moderator'] });
    assert.equal(moderatorChannel.ok, true);
    const moderatorJoined = once(member, 'room-joined');
    member.emit('switch-voice-channel', { voiceChannel: 'Moderadores' });
    assert.equal((await moderatorJoined).voiceChannel, 'Moderadores');
    const removedFromRestricted = once(member, 'server-member-moved');
    const revoked = await emitAck(admin, 'admin:assign-roles', { targetId: member.id, roleIds: [] });
    assert.equal(revoked.ok, true);
    assert.equal((await removedFromRestricted).voiceChannel, '', 'Perder o cargo não retirou a pessoa da call restrita.');

    const stats = signaling.getStats();
    assert.ok(stats.securityAudit.some((entry) => entry.action === 'channel.created' && entry.outcome === 'allowed'));
    assert.ok(stats.securityAudit.some((entry) => entry.action === 'channel.updated' && entry.outcome === 'allowed'));
    assert.ok(stats.securityAudit.some((entry) => entry.action === 'channel.create' && entry.outcome === 'denied'));
    assert.ok(stats.securityAudit.some((entry) => entry.action === 'member.moved'));
    assert.ok(stats.securityAudit.some((entry) => entry.action === 'server.settings.changed'));
    const persistedAudit = fs.readFileSync(auditFile, 'utf8');
    assert.doesNotMatch(persistedAudit, /identityProof|privateKey|roomPassword|mensagem-isolada/i);
    assert.ok(stats.securityAudit.some((entry) => entry.outcome === 'denied' && entry.details?.reason === 'role-hierarchy'));
    console.log(JSON.stringify({ ok: true, legacyCompatible: true, serverEnforced: true, hierarchyEnforced: true, equalAdminsIsolated: true, rolesPersisted: true, serverConfigured: true, channelCreated: true, channelConfigured: true, roleVisibilityEnforced: true, memberMoved: true, auditPersisted: true }));
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => signaling.io.close(() => resolve()));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
