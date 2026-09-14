'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERMISSION_DEFINITIONS = Object.freeze([
  { id: 'manageServer', label: 'Configurar servidor', description: 'Acesso às opções administrativas gerais.' },
  { id: 'manageRoles', label: 'Gerenciar cargos', description: 'Criar cargos, alterar permissões e atribuir pessoas.' },
  { id: 'manageChannels', label: 'Criar e editar canais', description: 'Adicionar e configurar canais, limites e acesso por cargo.' },
  { id: 'moveMembers', label: 'Mover pessoas entre calls', description: 'Transferir participantes entre canais de voz.' },
  { id: 'moderateMembers', label: 'Expulsar, castigar e banir', description: 'Aplicar ações de moderação a outras pessoas.' },
  { id: 'manageMessages', label: 'Gerenciar mensagens', description: 'Escrever em canais restritos e fixar mensagens.' },
  { id: 'viewAuditLog', label: 'Consultar auditoria', description: 'Consultar registros administrativos permitidos.' }
]);
const PERMISSION_IDS = new Set(PERMISSION_DEFINITIONS.map((permission) => permission.id));
const PROTECTED_ROLE_IDS = new Set(['admin', 'moderator', 'member']);
const DEFAULT_ROLES = Object.freeze([
  Object.freeze({ id: 'admin', name: 'Administrador', color: '#ff7188', position: 100, permissions: Object.freeze([...PERMISSION_IDS]), protected: true }),
  Object.freeze({ id: 'moderator', name: 'Moderador', color: '#a879ff', position: 50, permissions: Object.freeze(['moveMembers', 'moderateMembers', 'manageMessages', 'viewAuditLog']), protected: true }),
  Object.freeze({ id: 'member', name: 'Membro', color: '#8792a8', position: 0, permissions: Object.freeze([]), protected: true })
]);

const safeId = (value, maximum = 80) => {
  const result = String(value || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, maximum);
  return ['__proto__', 'prototype', 'constructor'].includes(result.toLowerCase()) ? '' : result;
};
const safeRoleId = (value) => safeId(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').toLowerCase(), 40);
const safeColor = (value, fallback = '#8792a8') => /^#[a-f0-9]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
const safeText = (value, maximum = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);

function normalizeRole(value = {}, fallback = {}) {
  const id = safeRoleId(value.id || value.name || fallback.id);
  if (!id) return null;
  const permissions = [...new Set((Array.isArray(value.permissions) ? value.permissions : fallback.permissions || [])
    .map(String).filter((permission) => PERMISSION_IDS.has(permission)))];
  return {
    id,
    name: safeText(value.name || fallback.name || id, 32) || id,
    color: safeColor(value.color, fallback.color),
    position: Math.round(Math.min(999, Math.max(-999, Number(value.position ?? fallback.position) || 0))),
    permissions,
    // Discord-like member grouping is opt-in per role. Keeping it false by
    // default preserves the old alphabetical list for existing servers.
    displaySeparately: value.displaySeparately === true || (value.displaySeparately === undefined && fallback.displaySeparately === true),
    protected: PROTECTED_ROLE_IDS.has(id)
  };
}

function normalizeAccessControl(value = {}) {
  const suppliedRoles = Array.isArray(value.roles) ? value.roles : [];
  const suppliedById = new Map(suppliedRoles.map((role) => [safeRoleId(role?.id || role?.name), role]).filter(([id]) => id));
  const roles = [];
  for (const fallback of DEFAULT_ROLES) {
    const role = normalizeRole(suppliedById.get(fallback.id) || fallback, fallback);
    roles.push(role);
    suppliedById.delete(fallback.id);
  }
  for (const supplied of suppliedById.values()) {
    const role = normalizeRole(supplied);
    if (role && !roles.some((entry) => entry.id === role.id) && roles.length < 64) roles.push(role);
  }
  roles.sort((left, right) => right.position - left.position || left.name.localeCompare(right.name, 'pt-BR'));
  const roleIds = new Set(roles.map((role) => role.id));
  const assignments = (Array.isArray(value.assignments) ? value.assignments : []).slice(0, 100000).reduce((result, entry) => {
    const clientId = safeId(entry?.clientId);
    if (!clientId || result.some((item) => item.clientId === clientId)) return result;
    const assigned = [...new Set((Array.isArray(entry.roleIds) ? entry.roleIds : []).map(safeRoleId).filter((id) => roleIds.has(id) && id !== 'member'))].slice(0, 16);
    if (!assigned.length) return result;
    result.push({ clientId, roleIds: assigned, lastName: safeText(entry.lastName || '', 24), updatedAt: safeText(entry.updatedAt || new Date().toISOString(), 40) });
    return result;
  }, []);
  return { version: 1, roles, assignments };
}

function publicRole(role) {
  return { id: role.id, name: role.name, color: role.color, position: role.position, permissions: [...role.permissions], displaySeparately: role.displaySeparately === true, protected: Boolean(role.protected) };
}

function accessForClient(value, clientId) {
  const access = normalizeAccessControl(value);
  const identity = safeId(clientId);
  const assignment = access.assignments.find((entry) => entry.clientId === identity);
  const assignedIds = assignment?.roleIds?.length ? assignment.roleIds : ['member'];
  const roles = assignedIds.map((id) => access.roles.find((role) => role.id === id)).filter(Boolean);
  if (!roles.length) roles.push(access.roles.find((role) => role.id === 'member'));
  roles.sort((left, right) => right.position - left.position);
  return {
    roleIds: roles.map((role) => role.id),
    roles: roles.map(publicRole),
    permissions: [...new Set(roles.flatMap((role) => role.permissions))],
    primaryRole: publicRole(roles[0])
  };
}

function upsertRole(value, input = {}) {
  const access = normalizeAccessControl(value);
  const requestedId = safeRoleId(input.id || input.previousId || input.name);
  const previousId = safeRoleId(input.previousId || requestedId);
  const previous = access.roles.find((role) => role.id === previousId);
  const id = previous?.protected ? previous.id : requestedId;
  const role = normalizeRole({ ...input, id }, previous || {});
  if (!role) return { ok: false, message: 'Informe um nome válido para o cargo.', accessControl: access };
  if (access.roles.some((entry) => entry.id === role.id && entry.id !== previousId)) return { ok: false, message: 'Já existe um cargo com esse identificador.', accessControl: access };
  if (!previous && access.roles.length >= 64) return { ok: false, message: 'O limite de 64 cargos foi atingido.', accessControl: access };
  const roles = access.roles.filter((entry) => entry.id !== previousId);
  roles.push(role);
  const assignments = access.assignments.map((entry) => ({ ...entry, roleIds: entry.roleIds.map((entryId) => entryId === previousId ? role.id : entryId) }));
  return { ok: true, message: previous ? 'Cargo atualizado.' : 'Cargo criado.', role: publicRole(role), accessControl: normalizeAccessControl({ roles, assignments }) };
}

function deleteRole(value, roleId) {
  const access = normalizeAccessControl(value);
  const id = safeRoleId(roleId);
  if (PROTECTED_ROLE_IDS.has(id)) return { ok: false, message: 'Os cargos padrão podem ser editados, mas não removidos.', accessControl: access };
  if (!access.roles.some((role) => role.id === id)) return { ok: false, message: 'Cargo não encontrado.', accessControl: access };
  return {
    ok: true,
    message: 'Cargo removido.',
    accessControl: normalizeAccessControl({ roles: access.roles.filter((role) => role.id !== id), assignments: access.assignments.map((entry) => ({ ...entry, roleIds: entry.roleIds.filter((entryId) => entryId !== id) })) })
  };
}

function assignRoles(value, clientId, roleIds, lastName = '') {
  const access = normalizeAccessControl(value);
  const identity = safeId(clientId);
  if (!identity) return { ok: false, message: 'Este perfil não possui uma identidade persistente válida.', accessControl: access };
  const available = new Set(access.roles.map((role) => role.id));
  const selected = [...new Set((Array.isArray(roleIds) ? roleIds : []).map(safeRoleId).filter((id) => available.has(id) && id !== 'member'))].slice(0, 16);
  const assignments = access.assignments.filter((entry) => entry.clientId !== identity);
  if (selected.length) assignments.push({ clientId: identity, roleIds: selected, lastName: safeText(lastName, 24), updatedAt: new Date().toISOString() });
  return { ok: true, message: selected.length ? 'Cargos do perfil atualizados.' : 'O perfil voltou ao cargo Membro.', accessControl: normalizeAccessControl({ roles: access.roles, assignments }) };
}

function createSecurityAuditStore({ filePath = '', maxEntries = 2000 } = {}) {
  const target = String(filePath || '');
  const maximum = Math.min(10000, Math.max(100, Number(maxEntries) || 2000));
  let entries = [];
  try {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (Array.isArray(saved)) entries = saved.slice(0, maximum);
  } catch { /* first start or invalid optional audit file */ }
  const persist = () => {
    if (!target) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(entries, null, 2), 'utf8');
  };
  const cleanObject = (value = {}, limits = {}) => Object.fromEntries(Object.entries(value || {}).slice(0, 24).map(([key, item]) => {
    const safeKey = safeText(key, 40);
    if (typeof item === 'boolean' || Number.isFinite(item)) return [safeKey, item];
    if (Array.isArray(item)) return [safeKey, item.slice(0, 24).map((entry) => safeText(entry, limits.array || 48))];
    return [safeKey, safeText(item, limits.text || 180)];
  }).filter(([key]) => key));
  return {
    record(action, actor = {}, targetInfo = {}, details = {}, outcome = 'allowed') {
      const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        action: safeText(action, 64),
        outcome: ['allowed', 'denied', 'failed'].includes(outcome) ? outcome : 'allowed',
        actor: cleanObject(actor),
        target: cleanObject(targetInfo),
        details: cleanObject(details)
      };
      entries.unshift(entry);
      if (entries.length > maximum) entries.length = maximum;
      try { persist(); } catch { /* runtime logs report functional failures separately */ }
      return entry;
    },
    list(limit = 100) { return entries.slice(0, Math.min(500, Math.max(1, Number(limit) || 100))).map((entry) => JSON.parse(JSON.stringify(entry))); },
    clear() { const removed = entries.length; entries = []; try { persist(); } catch { /* optional store */ } return removed; },
    stats() { let bytes = 0; try { bytes = fs.statSync(target).size; } catch { /* optional store */ } return { entries: entries.length, bytes, filePath: target }; }
  };
}

module.exports = {
  PERMISSION_DEFINITIONS,
  DEFAULT_ROLES,
  normalizeAccessControl,
  publicRole,
  accessForClient,
  upsertRole,
  deleteRole,
  assignRoles,
  createSecurityAuditStore,
  safeId,
  safeRoleId
};
